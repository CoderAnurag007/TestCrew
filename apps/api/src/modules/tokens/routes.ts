import { apiTokenSchema, createApiTokenBodySchema, projectIdParamsSchema } from '@auditor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateApiToken } from '../../lib/api-token.js';
import { writeAuditLog } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { requireProjectAccess } from '../../middleware/auth.js';

const tokenParamsSchema = z.object({ id: z.string().min(1), tokenId: z.string().min(1) });

/**
 * Project API tokens for CI. The plain token is returned once, at creation;
 * afterwards only its prefix is shown. Managing tokens needs a signed-in ADMIN,
 * never another token.
 */
export async function registerTokenRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/projects/:id/tokens',
    {
      schema: {
        tags: ['API tokens'],
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
        response: { 200: z.array(apiTokenSchema) },
      },
    },
    async (request) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      if (request.apiToken) throw new HttpError(403, 'API tokens cannot manage tokens');
      const { project } = await requireProjectAccess(request, id, 'ADMIN');
      return app.prisma.apiToken.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' } });
    },
  );

  app.post(
    '/projects/:id/tokens',
    {
      schema: {
        tags: ['API tokens'],
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
        body: createApiTokenBodySchema,
        response: { 201: apiTokenSchema.extend({ token: z.string() }) },
      },
    },
    async (request, reply) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      if (request.apiToken) throw new HttpError(403, 'API tokens cannot manage tokens');
      const { project, user } = await requireProjectAccess(request, id, 'ADMIN');
      const body = createApiTokenBodySchema.parse(request.body);
      const generated = generateApiToken();
      const row = await app.prisma.apiToken.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          name: body.name,
          tokenHash: generated.hash,
          prefix: generated.prefix,
          createdById: user.id,
        },
      });
      await writeAuditLog(app.prisma, request, {
        action: 'api_token.create',
        resourceType: 'ApiToken',
        resourceId: row.id,
        organizationId: project.organizationId,
        metadata: { name: body.name, prefix: generated.prefix },
      });
      return reply.status(201).send({ ...row, token: generated.token });
    },
  );

  app.delete(
    '/projects/:id/tokens/:tokenId',
    {
      schema: {
        tags: ['API tokens'],
        security: [{ cookieAuth: [] }],
        params: tokenParamsSchema,
      },
    },
    async (request, reply) => {
      const { id, tokenId } = tokenParamsSchema.parse(request.params);
      if (request.apiToken) throw new HttpError(403, 'API tokens cannot manage tokens');
      const { project } = await requireProjectAccess(request, id, 'ADMIN');
      const existing = await app.prisma.apiToken.findFirst({ where: { id: tokenId, projectId: project.id } });
      if (!existing) throw new HttpError(404, 'Token not found');
      await app.prisma.apiToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
      await writeAuditLog(app.prisma, request, {
        action: 'api_token.revoke',
        resourceType: 'ApiToken',
        resourceId: existing.id,
        organizationId: project.organizationId,
      });
      return reply.status(204).send();
    },
  );
}
