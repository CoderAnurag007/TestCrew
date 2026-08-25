import {
  addMemberBodySchema,
  createOrganizationBodySchema,
  memberParamsSchema,
  membershipRoleSchema,
  organizationIdParamsSchema,
  organizationSchema,
  updateMemberBodySchema,
  updateOrganizationBodySchema,
} from '@auditor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { slugify } from '../../lib/slug.js';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';

const memberResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: membershipRoleSchema,
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
  }),
  createdAt: z.coerce.date(),
});

export async function registerOrganizationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/organizations',
    {
      schema: {
        tags: ['Organizations'],
        security: [{ cookieAuth: [] }],
        body: createOrganizationBodySchema,
        response: { 201: organizationSchema },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request);
      const body = createOrganizationBodySchema.parse(request.body);

      const organization = await app.prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({
          data: {
            name: body.name,
            slug: slugify(body.name),
          },
        });
        await tx.membership.create({
          data: {
            organizationId: created.id,
            userId: user.id,
            role: 'OWNER',
          },
        });
        return created;
      });

      await writeAuditLog(app.prisma, request, {
        action: 'organization.create',
        resourceType: 'Organization',
        resourceId: organization.id,
        organizationId: organization.id,
      });

      return reply.status(201).send(organization);
    },
  );

  app.get(
    '/organizations',
    {
      schema: {
        tags: ['Organizations'],
        security: [{ cookieAuth: [] }],
        response: { 200: z.array(organizationSchema) },
      },
    },
    async (request) => {
      const user = await requireAuth(request);
      const memberships = await app.prisma.membership.findMany({
        where: { userId: user.id },
        include: { organization: true },
        orderBy: { createdAt: 'asc' },
      });
      return memberships.map((membership) => membership.organization);
    },
  );

  app.get(
    '/organizations/:id',
    {
      schema: {
        tags: ['Organizations'],
        security: [{ cookieAuth: [] }],
        params: organizationIdParamsSchema,
        response: { 200: organizationSchema },
      },
    },
    async (request) => {
      const { id } = organizationIdParamsSchema.parse(request.params);
      await requireOrgRole(request, id, 'VIEWER');
      const organization = await app.prisma.organization.findUnique({ where: { id } });
      if (!organization) {
        throw new HttpError(404, 'Organization not found');
      }
      return organization;
    },
  );

  app.patch(
    '/organizations/:id',
    {
      schema: {
        tags: ['Organizations'],
        security: [{ cookieAuth: [] }],
        params: organizationIdParamsSchema,
        body: updateOrganizationBodySchema,
        response: { 200: organizationSchema },
      },
    },
    async (request) => {
      const { id } = organizationIdParamsSchema.parse(request.params);
      await requireOrgRole(request, id, 'ADMIN');
      const body = updateOrganizationBodySchema.parse(request.body);
      const organization = await app.prisma.organization.update({
        where: { id },
        data: { name: body.name },
      });
      await writeAuditLog(app.prisma, request, {
        action: 'organization.update',
        resourceType: 'Organization',
        resourceId: id,
        organizationId: id,
      });
      return organization;
    },
  );

  app.get(
    '/organizations/:id/members',
    {
      schema: {
        tags: ['Organizations'],
        security: [{ cookieAuth: [] }],
        params: organizationIdParamsSchema,
        response: { 200: z.array(memberResponseSchema) },
      },
    },
    async (request) => {
      const { id } = organizationIdParamsSchema.parse(request.params);
      await requireOrgRole(request, id, 'VIEWER');
      return app.prisma.membership.findMany({
        where: { organizationId: id },
        include: { user: { select: { id: true, email: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });
    },
  );

  app.post(
    '/organizations/:id/members',
    {
      schema: {
        tags: ['Organizations'],
        security: [{ cookieAuth: [] }],
        params: organizationIdParamsSchema,
        body: addMemberBodySchema,
        response: { 201: memberResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = organizationIdParamsSchema.parse(request.params);
      await requireOrgRole(request, id, 'OWNER');
      const body = addMemberBodySchema.parse(request.body);
      const target = await app.prisma.user.findUnique({
        where: { email: body.email.toLowerCase() },
      });
      if (!target) {
        throw new HttpError(404, 'User not found');
      }

      try {
        const membership = await app.prisma.membership.create({
          data: {
            organizationId: id,
            userId: target.id,
            role: body.role,
          },
          include: { user: { select: { id: true, email: true, name: true } } },
        });
        await writeAuditLog(app.prisma, request, {
          action: 'membership.create',
          resourceType: 'Membership',
          resourceId: membership.id,
          organizationId: id,
          metadata: { userId: target.id, role: body.role },
        });
        return reply.status(201).send(membership);
      } catch {
        throw new HttpError(409, 'User is already a member of this organization');
      }
    },
  );

  app.patch(
    '/organizations/:id/members/:userId',
    {
      schema: {
        tags: ['Organizations'],
        security: [{ cookieAuth: [] }],
        params: memberParamsSchema,
        body: updateMemberBodySchema,
        response: { 200: memberResponseSchema },
      },
    },
    async (request) => {
      const { id, userId } = memberParamsSchema.parse(request.params);
      await requireOrgRole(request, id, 'OWNER');
      const body = updateMemberBodySchema.parse(request.body);

      if (body.role !== 'OWNER') {
        const owners = await app.prisma.membership.count({
          where: { organizationId: id, role: 'OWNER' },
        });
        const current = await app.prisma.membership.findUnique({
          where: { organizationId_userId: { organizationId: id, userId } },
        });
        if (current?.role === 'OWNER' && owners <= 1) {
          throw new HttpError(409, 'Cannot demote the last owner');
        }
      }

      const membership = await app.prisma.membership.update({
        where: { organizationId_userId: { organizationId: id, userId } },
        data: { role: body.role },
        include: { user: { select: { id: true, email: true, name: true } } },
      });
      await writeAuditLog(app.prisma, request, {
        action: 'membership.update',
        resourceType: 'Membership',
        resourceId: membership.id,
        organizationId: id,
        metadata: { userId, role: body.role },
      });
      return membership;
    },
  );

  app.delete(
    '/organizations/:id/members/:userId',
    {
      schema: {
        tags: ['Organizations'],
        security: [{ cookieAuth: [] }],
        params: memberParamsSchema,
      },
    },
    async (request, reply) => {
      const { id, userId } = memberParamsSchema.parse(request.params);
      await requireOrgRole(request, id, 'OWNER');
      const current = await app.prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: id, userId } },
      });
      if (!current) {
        throw new HttpError(404, 'Member not found');
      }
      if (current.role === 'OWNER') {
        const owners = await app.prisma.membership.count({
          where: { organizationId: id, role: 'OWNER' },
        });
        if (owners <= 1) {
          throw new HttpError(409, 'Cannot remove the last owner');
        }
      }
      await app.prisma.membership.delete({
        where: { organizationId_userId: { organizationId: id, userId } },
      });
      await writeAuditLog(app.prisma, request, {
        action: 'membership.delete',
        resourceType: 'Membership',
        resourceId: current.id,
        organizationId: id,
        metadata: { userId },
      });
      return reply.status(204).send();
    },
  );
}
