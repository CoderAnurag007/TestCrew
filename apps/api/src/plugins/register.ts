import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from '@fastify/type-provider-zod';
import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE } from '../lib/constants.js';
import { authPreHandler, isPublicPath, requireAuth } from '../middleware/auth.js';
import { originGuard } from '../middleware/origin.js';

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: app.env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    max: 120,
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
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });
}
