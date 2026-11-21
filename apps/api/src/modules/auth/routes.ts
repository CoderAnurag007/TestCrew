import { loginBodySchema, registerBodySchema, sessionUserSchema } from '@auditor/shared';
import type { FastifyInstance } from 'fastify';
import { writeAuditLog } from '../../lib/audit.js';
import { SESSION_COOKIE } from '../../lib/constants.js';
import { HttpError } from '../../lib/http-error.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { createSession, destroySession } from '../../lib/session.js';
import { requireAuth } from '../../middleware/auth.js';
import { sendVerificationEmail } from './account.js';

function cookieOptions(app: FastifyInstance) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: app.env.COOKIE_SECURE,
    path: '/',
    domain: app.env.COOKIE_DOMAIN,
    maxAge: app.env.SESSION_TTL_SECONDS,
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/register',
    {
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
      schema: {
        tags: ['Auth'],
        body: registerBodySchema,
        response: { 201: sessionUserSchema },
      },
    },
    async (request, reply) => {
      const body = registerBodySchema.parse(request.body);
      const email = body.email.toLowerCase();
      const existing = await app.prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new HttpError(409, 'An account with this email already exists');
      }

      const user = await app.prisma.user.create({
        data: {
          email,
          name: body.name,
          passwordHash: await hashPassword(body.password),
        },
      });

      const sessionId = await createSession(app.redis, user.id, app.env.SESSION_TTL_SECONDS);
      reply.setCookie(SESSION_COOKIE, sessionId, cookieOptions(app));

      const payload = {
        id: user.id,
        email: user.email,
        name: user.name,
        memberships: [],
        emailVerified: false,
      };
      request.currentUser = payload;

      await writeAuditLog(app.prisma, request, {
        action: 'auth.register',
        resourceType: 'User',
        resourceId: user.id,
      });
      await sendVerificationEmail(app, user);

      return reply.status(201).send(payload);
    },
  );

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
      schema: {
        tags: ['Auth'],
        body: loginBodySchema,
        response: { 200: sessionUserSchema },
      },
    },
    async (request, reply) => {
      const body = loginBodySchema.parse(request.body);
      const email = body.email.toLowerCase();
      const user = await app.prisma.user.findUnique({
        where: { email },
        include: {
          memberships: {
            include: { organization: { select: { id: true, name: true, slug: true } } },
          },
        },
      });

      const valid = user ? await verifyPassword(user.passwordHash, body.password) : false;
      if (!user || !valid) {
        throw new HttpError(401, 'Invalid email or password');
      }

      const sessionId = await createSession(app.redis, user.id, app.env.SESSION_TTL_SECONDS);
      reply.setCookie(SESSION_COOKIE, sessionId, cookieOptions(app));

      const payload = {
        id: user.id,
        email: user.email,
        name: user.name,
        memberships: user.memberships.map((membership) => ({
          id: membership.id,
          organizationId: membership.organizationId,
          role: membership.role,
          organization: membership.organization,
        })),
        emailVerified: Boolean(user.emailVerifiedAt),
      };
      request.currentUser = payload;

      await writeAuditLog(app.prisma, request, {
        action: 'auth.login',
        resourceType: 'User',
        resourceId: user.id,
      });

      return payload;
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: { tags: ['Auth'] },
    },
    async (request, reply) => {
      const sessionId = request.cookies[SESSION_COOKIE];
      if (sessionId) {
        await destroySession(app.redis, sessionId);
      }
      reply.clearCookie(SESSION_COOKIE, {
        path: '/',
        domain: app.env.COOKIE_DOMAIN,
      });
      return reply.status(204).send();
    },
  );

  app.get(
    '/auth/me',
    {
      schema: {
        tags: ['Auth'],
        security: [{ cookieAuth: [] }],
        response: { 200: sessionUserSchema },
      },
    },
    async (request) => {
      const user = await requireAuth(request);
      return user;
    },
  );
}
