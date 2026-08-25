import {
  createProjectBodySchema,
  environmentSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  projectSchema,
  updateProjectBodySchema,
} from '@auditor/shared';
import { assertSafeNavigationTarget, UnsafeTargetError } from '@auditor/shared/ssrf';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { requireOrgRole, requireProjectAccess } from '../../middleware/auth.js';

const projectDetailSchema = projectSchema.extend({
  environments: z.array(environmentSchema),
});

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/projects',
    {
      schema: {
        tags: ['Projects'],
        security: [{ cookieAuth: [] }],
        body: createProjectBodySchema,
        response: { 201: projectDetailSchema },
      },
    },
    async (request, reply) => {
      const body = createProjectBodySchema.parse(request.body);
      const { membership } = await requireOrgRole(request, body.organizationId, 'MEMBER');
      try {
        await assertSafeNavigationTarget(body.baseUrl, { allowPrivate: body.allowPrivateTargets ?? false });
      } catch (error) {
        if (error instanceof UnsafeTargetError) {
          throw new HttpError(400, error.message);
        }
        throw error;
      }

      const project = await app.prisma.$transaction(async (tx) => {
        const created = await tx.project.create({
          data: {
            organizationId: membership.organizationId,
            name: body.name,
            description: body.description,
            baseUrl: body.baseUrl,
            maxPages: body.maxPages,
            maxActions: body.maxActions,
            maxDepth: body.maxDepth,
            maxDurationMs: body.maxDurationMs,
            allowDestructive: body.allowDestructive,
            allowPrivateTargets: body.allowPrivateTargets,
            recordVideo: body.recordVideo,
          },
        });
        await tx.environment.create({
          data: {
            organizationId: membership.organizationId,
            projectId: created.id,
            name: body.environmentName,
            baseUrl: body.baseUrl,
          },
        });
        return tx.project.findUniqueOrThrow({
          where: { id: created.id },
          include: { environments: true },
        });
      });

      await writeAuditLog(app.prisma, request, {
        action: 'project.create',
        resourceType: 'Project',
        resourceId: project.id,
        organizationId: project.organizationId,
      });

      return reply.status(201).send(project);
    },
  );

  app.get(
    '/projects',
    {
      schema: {
        tags: ['Projects'],
        security: [{ cookieAuth: [] }],
        querystring: listProjectsQuerySchema,
        response: { 200: z.array(projectSchema) },
      },
    },
    async (request) => {
      const query = listProjectsQuerySchema.parse(request.query);
      await requireOrgRole(request, query.organizationId, 'VIEWER');
      return app.prisma.project.findMany({
        where: { organizationId: query.organizationId },
        orderBy: { createdAt: 'desc' },
      });
    },
  );

  app.get(
    '/projects/:id',
    {
      schema: {
        tags: ['Projects'],
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
        response: { 200: projectDetailSchema },
      },
    },
    async (request) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      await requireProjectAccess(request, id, 'VIEWER');
      const project = await app.prisma.project.findUnique({
        where: { id },
        include: { environments: { orderBy: { createdAt: 'asc' } } },
      });
      if (!project) {
        throw new HttpError(404, 'Project not found');
      }
      return project;
    },
  );

  app.patch(
    '/projects/:id',
    {
      schema: {
        tags: ['Projects'],
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
        body: updateProjectBodySchema,
        response: { 200: projectSchema },
      },
    },
    async (request) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      await requireProjectAccess(request, id, 'ADMIN');
      const body = updateProjectBodySchema.parse(request.body);
      if (body.baseUrl) {
        const current = await app.prisma.project.findUnique({ where: { id } });
        try {
          await assertSafeNavigationTarget(body.baseUrl, {
            allowPrivate: body.allowPrivateTargets ?? current?.allowPrivateTargets ?? false,
          });
        } catch (error) {
          if (error instanceof UnsafeTargetError) {
            throw new HttpError(400, error.message);
          }
          throw error;
        }
      }
      const project = await app.prisma.project.update({
        where: { id },
        data: {
          name: body.name,
          description: body.description,
          baseUrl: body.baseUrl,
          maxPages: body.maxPages,
          maxActions: body.maxActions,
          maxDepth: body.maxDepth,
          maxDurationMs: body.maxDurationMs,
          allowDestructive: body.allowDestructive,
          allowPrivateTargets: body.allowPrivateTargets,
          recordVideo: body.recordVideo,
        },
      });
      await writeAuditLog(app.prisma, request, {
        action: 'project.update',
        resourceType: 'Project',
        resourceId: id,
        organizationId: project.organizationId,
      });
      return project;
    },
  );

  app.delete(
    '/projects/:id',
    {
      schema: {
        tags: ['Projects'],
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
      },
    },
    async (request, reply) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, id, 'ADMIN');
      await app.prisma.project.delete({ where: { id } });
      await writeAuditLog(app.prisma, request, {
        action: 'project.delete',
        resourceType: 'Project',
        resourceId: id,
        organizationId: project.organizationId,
      });
      return reply.status(204).send();
    },
  );
}
