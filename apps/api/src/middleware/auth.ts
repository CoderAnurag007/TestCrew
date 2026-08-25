import type { MembershipRole } from '@auditor/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../lib/http-error.js';
import { assertAuthenticated, assertMinRole } from '../lib/authorization.js';
import { SESSION_COOKIE } from '../lib/constants.js';
import { readSession } from '../lib/session.js';

const PUBLIC_PREFIXES = [
  '/auth/login',
  '/auth/register',
  '/auth/logout',
  '/health',
  '/docs',
  '/documentation',
];

export async function authPreHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
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
  const membership = user.memberships.find((item) => item.organizationId === project.organizationId);
  assertMinRole(membership?.role, minimum, 'Project not found');
  if (!membership) {
    throw new HttpError(404, 'Project not found');
  }
  return { user, membership, project };
}
