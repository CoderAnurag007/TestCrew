import { createHash, randomBytes } from 'node:crypto';
import {
  changePasswordBodySchema,
  deleteAccountBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  verifyEmailBodySchema,
} from '@auditor/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { writeAuditLog } from '../../lib/audit.js';
import { SESSION_COOKIE } from '../../lib/constants.js';
import { HttpError } from '../../lib/http-error.js';
import { actionMail, sendMail } from '../../lib/mailer.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { purgeRunFiles } from '../../lib/purge.js';
import { createSession, destroySession } from '../../lib/session.js';
import { requireAuth } from '../../middleware/auth.js';

const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 3 * 24 * 60 * 60 * 1000;

type Purpose = 'reset' | 'verify';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** A new one-time link token. Earlier unused ones for the same purpose stop working. */
async function issueToken(app: FastifyInstance, userId: string, purpose: Purpose, ttlMs: number): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await app.prisma.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  await app.prisma.authToken.create({
    data: { userId, purpose, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return raw;
}

/** Uses up a token once; returns its user, or null when it is unknown, used or expired. */
async function consumeToken(app: FastifyInstance, raw: string, purpose: Purpose): Promise<string | null> {
  const token = await app.prisma.authToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt < new Date()) return null;
  const claimed = await app.prisma.authToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
  return claimed.count === 1 ? token.userId : null;
}

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

/** Signs this browser in again after every other session was ended. */
async function freshSession(app: FastifyInstance, reply: FastifyReply, userId: string): Promise<void> {
  const sessionId = await createSession(app.redis, userId, app.env.SESSION_TTL_SECONDS);
  reply.setCookie(SESSION_COOKIE, sessionId, cookieOptions(app));
}

/** Emails a link that confirms the address. Never fails the caller: a sign-up must not break on mail trouble. */
export async function sendVerificationEmail(app: FastifyInstance, user: { id: string; email: string; name: string }): Promise<void> {
  try {
    const token = await issueToken(app, user.id, 'verify', VERIFY_TTL_MS);
    await sendMail(
      app,
      actionMail({
        to: user.email,
        subject: 'Confirm your email for Snaghunt',
        intro: `Hi ${user.name.split(' ')[0]}, confirm this is your email address so we can send you audit results and alerts.`,
        action: 'Confirm email',
        url: `${app.env.WEB_ORIGIN}/verify-email?token=${token}`,
        outro: 'The link works for 3 days. If you didn’t sign up for Snaghunt, you can ignore this email.',
      }),
    );
  } catch (error) {
    app.log.error({ err: error, userId: user.id }, 'could not send the verification email');
  }
}

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/forgot-password',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['Auth'], body: forgotPasswordBodySchema } },
    async (request, reply) => {
      const { email } = forgotPasswordBodySchema.parse(request.body);
      const user = await app.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      // The same answer either way, so nobody can find out who has an account.
      if (user) {
        try {
          const token = await issueToken(app, user.id, 'reset', RESET_TTL_MS);
          await sendMail(
            app,
            actionMail({
              to: user.email,
              subject: 'Reset your Snaghunt password',
              intro: 'Someone (hopefully you) asked to reset the password for your Snaghunt account.',
              action: 'Choose a new password',
              url: `${app.env.WEB_ORIGIN}/reset-password?token=${token}`,
              outro: 'The link works for one hour and only once. If you didn’t ask for this, ignore this email: your password stays the same.',
            }),
          );
          await writeAuditLog(app.prisma, request, { action: 'auth.password_reset_requested', resourceType: 'User', resourceId: user.id });
        } catch (error) {
          request.log.error({ err: error }, 'could not send the password reset email');
        }
      }
      return reply.status(202).send({ ok: true });
    },
  );

  app.post(
    '/auth/reset-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['Auth'], body: resetPasswordBodySchema } },
    async (request, reply) => {
      const body = resetPasswordBodySchema.parse(request.body);
      const userId = await consumeToken(app, body.token, 'reset');
      if (!userId) throw new HttpError(400, 'This reset link has expired or was already used. Ask for a new one.');
      const now = new Date();
      const user = await app.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(body.password), sessionsValidAfter: now },
        select: { id: true, emailVerifiedAt: true },
      });
      // Opening the link proved they own the inbox.
      if (!user.emailVerifiedAt) await app.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: now } });
      await writeAuditLog(app.prisma, request, { action: 'auth.password_reset', resourceType: 'User', resourceId: userId });
      return reply.status(204).send();
    },
  );

  app.post(
    '/auth/verify-email',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['Auth'], body: verifyEmailBodySchema } },
    async (request) => {
      const body = verifyEmailBodySchema.parse(request.body);
      const userId = await consumeToken(app, body.token, 'verify');
      if (!userId) throw new HttpError(400, 'This confirmation link has expired or was already used. Sign in and send a new one.');
      await app.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      await writeAuditLog(app.prisma, request, { action: 'auth.email_verified', resourceType: 'User', resourceId: userId });
      return { ok: true };
    },
  );

  app.post(
    '/auth/resend-verification',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } }, schema: { tags: ['Auth'], security: [{ cookieAuth: [] }] } },
    async (request) => {
      const current = await requireAuth(request);
      const user = await app.prisma.user.findUniqueOrThrow({ where: { id: current.id } });
      if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
      await sendVerificationEmail(app, user);
      return { ok: true, alreadyVerified: false };
    },
  );

  app.post(
    '/auth/change-password',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { tags: ['Auth'], security: [{ cookieAuth: [] }], body: changePasswordBodySchema },
    },
    async (request, reply) => {
      const current = await requireAuth(request);
      if (request.apiToken) throw new HttpError(403, 'API tokens cannot change passwords');
      const body = changePasswordBodySchema.parse(request.body);
      const user = await app.prisma.user.findUniqueOrThrow({ where: { id: current.id } });
      if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
        throw new HttpError(400, 'Your current password is not right');
      }
      // Every other browser is signed out; this one gets a new session.
      await app.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword), sessionsValidAfter: new Date() },
      });
      const old = request.cookies[SESSION_COOKIE];
      if (old) await destroySession(app.redis, old);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await freshSession(app, reply, user.id);
      await writeAuditLog(app.prisma, request, { action: 'auth.password_changed', resourceType: 'User', resourceId: user.id });
      return reply.status(204).send();
    },
  );

  app.delete(
    '/auth/account',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { tags: ['Auth'], security: [{ cookieAuth: [] }], body: deleteAccountBodySchema },
    },
    async (request, reply) => {
      const current = await requireAuth(request);
      if (request.apiToken) throw new HttpError(403, 'API tokens cannot delete accounts');
      const body = deleteAccountBodySchema.parse(request.body);
      const user = await app.prisma.user.findUniqueOrThrow({ where: { id: current.id } });
      if (body.confirmEmail.trim().toLowerCase() !== user.email) {
        throw new HttpError(400, 'Type your email address exactly to confirm');
      }
      if (!(await verifyPassword(user.passwordHash, body.password))) {
        throw new HttpError(400, 'Your password is not right');
      }

      const summary = await deleteAccount(app, user.id);
      await writeAuditLog(app.prisma, request, {
        action: 'auth.account_deleted',
        resourceType: 'User',
        resourceId: user.id,
        metadata: summary,
      }).catch(() => undefined);

      const sessionId = request.cookies[SESSION_COOKIE];
      if (sessionId) await destroySession(app.redis, sessionId);
      reply.clearCookie(SESSION_COOKIE, { path: '/', domain: app.env.COOKIE_DOMAIN });
      return reply.status(200).send(summary);
    },
  );
}

/**
 * Deletes a user. Workspaces where they are the only member go with them
 * (sites, audits, findings and all). In shared workspaces the work stays: the
 * longest-standing remaining member becomes owner if needed, and takes over
 * the audits this user started.
 */
export async function deleteAccount(app: FastifyInstance, userId: string): Promise<{ workspacesDeleted: number; workspacesKept: number }> {
  const memberships = await app.prisma.membership.findMany({
    where: { userId },
    include: { organization: { include: { memberships: { orderBy: { createdAt: 'asc' } } } } },
  });
  let workspacesDeleted = 0;
  let workspacesKept = 0;
  const soloOrgIds = memberships
    .filter((membership) => membership.organization.memberships.every((item) => item.userId === userId))
    .map((membership) => membership.organizationId);
  const runsToPurge = await app.prisma.run.findMany({ where: { organizationId: { in: soloOrgIds } }, select: { id: true } });
  await app.prisma.$transaction(async (tx) => {
    for (const membership of memberships) {
      const others = membership.organization.memberships.filter((item) => item.userId !== userId);
      if (!others.length) {
        await tx.organization.delete({ where: { id: membership.organizationId } });
        workspacesDeleted += 1;
        continue;
      }
      workspacesKept += 1;
      const heir = others.find((item) => item.role === 'OWNER') ?? others.find((item) => item.role === 'ADMIN') ?? others[0]!;
      if (heir.role !== 'OWNER' && membership.role === 'OWNER') {
        await tx.membership.update({ where: { id: heir.id }, data: { role: 'OWNER' } });
      }
      await tx.run.updateMany({
        where: { organizationId: membership.organizationId, createdById: userId },
        data: { createdById: heir.userId },
      });
      await tx.apiToken.updateMany({
        where: { organizationId: membership.organizationId, createdById: userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await tx.user.delete({ where: { id: userId } });
  });
  await purgeRunFiles(app, runsToPurge.map((run) => run.id));
  return { workspacesDeleted, workspacesKept };
}
