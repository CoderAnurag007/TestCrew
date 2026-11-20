import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from '@fastify/type-provider-zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from '../lib/constants.js';
import { authPreHandler, isPublicPath, requireAuth } from '../middleware/auth.js';
import { originGuard } from '../middleware/origin.js';
import { HttpError } from '../lib/http-error.js';

/**
 * Rate limiting runs after authentication (preHandler), so the key is a
 * verified user or API token, never a value the client can make up.
 */
function rateLimitIdentity(request: FastifyRequest): { key: string; authenticated: boolean } {
  if (request.apiToken) {
    return { key: `token:${request.apiToken.id}`, authenticated: true };
  }
  if (request.currentUser) {
    return { key: `user:${request.currentUser.id}`, authenticated: true };
  }
  return { key: `ip:${request.ip}`, authenticated: false };
}

/** The only endpoints a project API token may call (CI: start a run, poll it, read results). */
const API_TOKEN_ROUTES: Array<[string, RegExp]> = [
  ['POST', /^\/projects\/[^/]+\/runs$/],
  ['GET', /^\/projects\/[^/]+\/runs$/],
  ['GET', /^\/projects\/[^/]+$/],
  ['GET', /^\/runs\/[^/]+$/],
  ['GET', /^\/runs\/[^/]+\/(summary|export\/playwright|screenshot|report\.html|live|live\/frame)$/],
  ['GET', /^\/runs\/[^/]+\/evidence\/[^/]+$/],
  ['POST', /^\/runs\/[^/]+\/cancel$/],
];

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: app.env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    // Signed-in users (session cookie or API token) are limited per user, with
    // room for the dashboard's polling while an audit runs; anonymous traffic
    // (login attempts, scanners) keeps a tight per-IP budget.
    max: (request) => (rateLimitIdentity(request).authenticated ? 600 : 120),
    keyGenerator: (request) => rateLimitIdentity(request).key,
    hook: 'preHandler',
    timeWindow: '1 minute',
    skipOnError: true,
    ...(app.env.NODE_ENV === 'test' || app.env.REDIS_URL.startsWith('memory:')
      ? {}
      : { redis: app.redis }),
    allowList: (req) => {
      const url = req.url.split('?')[0] ?? req.url;
      return url === '/health' || app.env.NODE_ENV === 'test';
    },
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'AI App Auditor API',
        version: '0.1.0',
        description: 'Control plane API for AI App Auditor.',
      },
      servers: [{ url: `http://localhost:${app.env.API_PORT}` }],
      tags: [
        { name: 'Health' },
        { name: 'Auth' },
        { name: 'Organizations' },
        { name: 'Projects' },
        { name: 'Environments' },
        { name: 'Credentials' },
        { name: 'Runs' },
        { name: 'Dashboard' },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: SESSION_COOKIE,
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'Project API token (tc_...) for CI. Acts as MEMBER on one project.',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  app.addHook('onRequest', authPreHandler);
  app.addHook('onRequest', originGuard);
  app.addHook('onRequest', async (request) => {
    if (isPublicPath(request.url)) {
      return;
    }
    await requireAuth(request);
    if (request.apiToken) {
      const path = request.url.split('?')[0] ?? '';
      const allowed = API_TOKEN_ROUTES.some(([method, pattern]) => method === request.method && pattern.test(path));
      if (!allowed) {
        throw new HttpError(403, 'API tokens can only start runs and read run results');
      }
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });
}
