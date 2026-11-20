import type { MembershipRole } from '@auditor/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../lib/http-error.js';
import { assertAuthenticated, assertMinRole } from '../lib/authorization.js';
import { SESSION_COOKIE } from '../lib/constants.js';
import { readSession } from '../lib/session.js';
import { hashApiToken, TOKEN_PREFIX } from '../lib/api-token.js';

const PUBLIC_PREFIXES = [
  '/auth/login',
  '/auth/register',
  '/auth/logout',
  '/health',
  '/public',
  '/docs',
  '/documentation',
];

export async function authPreHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith(`Bearer ${TOKEN_PREFIX}`)) {
    await authenticateApiToken(request, authorization.slice('Bearer '.length).trim());
    return;
  }
  const sessionId = request.cookies[SESSION_COOKIE];
  if (!sessionId) {
    return;
  }
  const session = await readSession(request.server.redis, sessionId);
  if (!session) {
    return;
  }
  const user = await request.server.prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      memberships: {
        select: {
          id: true,
          organizationId: true,
          role: true,
          organization: {
            select: { id: true, name: true, slug: true },
          },
        },
      },
    },
  });
  if (!user) {
    return;
  }
  request.currentUser = user;
}

async function authenticateApiToken(request: FastifyRequest, raw: string): Promise<void> {
  const token = await request.server.prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(raw) },
    include: { project: { select: { organizationId: true } } },
  });
  if (!token || token.revokedAt) {
    throw new HttpError(401, 'Invalid or revoked API token');
  }
  const organization = await request.server.prisma.organization.findUnique({
    where: { id: token.organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!organization) {
    throw new HttpError(401, 'Invalid API token');
  }
  request.apiToken = { id: token.id, projectId: token.projectId, organizationId: token.organizationId, name: token.name };
  request.currentUser = {
    id: token.createdById,
    email: `api-token+${token.prefix}@snaghunt.local`,
    name: `API token ${token.name}`,
    memberships: [{ id: `token-${token.id}`, organizationId: token.organizationId, role: 'MEMBER', organization }],
  };
  void request.server.prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}

/** API tokens are scoped to one project; anything else looks like it does not exist. */
export function assertTokenScope(request: FastifyRequest, projectId: string, notFound = 'Not found'): void {
  if (request.apiToken && request.apiToken.projectId !== projectId) {
    throw new HttpError(404, notFound);
  }
}

export function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return (
    PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ||
    path.startsWith('/docs') ||
    path.startsWith('/documentation')
  );
}

export async function requireAuth(request: FastifyRequest): Promise<NonNullable<FastifyRequest['currentUser']>> {
  assertAuthenticated(request.currentUser?.id);
  if (!request.currentUser) {
    throw new HttpError(401, 'Authentication required');
  }
  return request.currentUser;
}

export async function requireOrgRole(
  request: FastifyRequest,
  organizationId: string,
  minimum: MembershipRole,
) {
  const user = await requireAuth(request);
  const membership = user.memberships.find((item) => item.organizationId === organizationId);
  assertMinRole(membership?.role, minimum, 'Organization not found');
  if (!membership) {
    throw new HttpError(404, 'Organization not found');
  }
  return { user, membership };
}

export async function requireProjectAccess(
  request: FastifyRequest,
  projectId: string,
  minimum: MembershipRole,
) {
  const user = await requireAuth(request);
  const project = await request.server.prisma.project.findFirst({
    where: {
      id: projectId,
      organizationId: { in: user.memberships.map((item) => item.organizationId) },
    },
  });
  if (!project) {
    throw new HttpError(404, 'Project not found');
  }
  assertTokenScope(request, project.id, 'Project not found');
  const membership = user.memberships.find((item) => item.organizationId === project.organizationId);
  assertMinRole(membership?.role, minimum, 'Project not found');
  if (!membership) {
    throw new HttpError(404, 'Project not found');
  }
  return { user, membership, project };
}
