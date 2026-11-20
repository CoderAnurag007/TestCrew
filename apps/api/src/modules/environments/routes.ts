import {
  createEnvironmentBodySchema,
  environmentParamsSchema,
  environmentSchema,
  projectIdParamsSchema,
  updateEnvironmentBodySchema,
} from '@auditor/shared';
import { assertSafeNavigationTarget, UnsafeTargetError } from '@auditor/shared/ssrf';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { requireProjectAccess } from '../../middleware/auth.js';

export async function registerEnvironmentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/projects/:id/environments',
    {
      schema: {
        tags: ['Environments'],
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
        response: { 200: z.array(environmentSchema) },
      },
    },
    async (request) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, id, 'VIEWER');
      return app.prisma.environment.findMany({
        where: { projectId: project.id, organizationId: project.organizationId },
        orderBy: { createdAt: 'asc' },
      });
    },
  );

  app.post(
    '/projects/:id/environments',
    {
      schema: {
        tags: ['Environments'],
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
        body: createEnvironmentBodySchema,
        response: { 201: environmentSchema },
      },
    },
    async (request, reply) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, id, 'ADMIN');
      const body = createEnvironmentBodySchema.parse(request.body);
      try {
        await assertSafeNavigationTarget(body.baseUrl, { allowPrivate: project.allowPrivateTargets });
      } catch (error) {
        if (error instanceof UnsafeTargetError) {
          throw new HttpError(400, error.message);
        }
        throw error;
      }
      try {
        const environment = await app.prisma.environment.create({
          data: {
            organizationId: project.organizationId,
            projectId: project.id,
            name: body.name,
            baseUrl: body.baseUrl,
            kind: body.kind,
            safetyMode: body.safetyMode ?? undefined,
          },
        });
        await writeAuditLog(app.prisma, request, {
          action: 'environment.create',
          resourceType: 'Environment',
          resourceId: environment.id,
          organizationId: project.organizationId,
        });
        return reply.status(201).send(environment);
      } catch {
        throw new HttpError(409, 'An environment with this name already exists');
      }
    },
  );

  app.patch(
    '/projects/:id/environments/:environmentId',
    {
      schema: {
        tags: ['Environments'],
        security: [{ cookieAuth: [] }],
        params: environmentParamsSchema,
        body: updateEnvironmentBodySchema,
        response: { 200: environmentSchema },
      },
    },
    async (request) => {
      const { id, environmentId } = environmentParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, id, 'ADMIN');
      const body = updateEnvironmentBodySchema.parse(request.body);
      if (body.baseUrl) {
        try {
          await assertSafeNavigationTarget(body.baseUrl, { allowPrivate: project.allowPrivateTargets });
        } catch (error) {
          if (error instanceof UnsafeTargetError) {
            throw new HttpError(400, error.message);
          }
          throw error;
        }
      }
      const existing = await app.prisma.environment.findFirst({
        where: {
          id: environmentId,
          projectId: project.id,
          organizationId: project.organizationId,
        },
      });
      if (!existing) {
        throw new HttpError(404, 'Environment not found');
      }
      const environment = await app.prisma.environment.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          baseUrl: body.baseUrl,
          kind: body.kind,
          safetyMode: body.safetyMode,
        },
      });
      await writeAuditLog(app.prisma, request, {
        action: 'environment.update',
        resourceType: 'Environment',
        resourceId: environment.id,
        organizationId: project.organizationId,
      });
      return environment;
    },
  );
}
