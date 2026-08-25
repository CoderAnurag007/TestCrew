import {
  createCredentialBodySchema,
  credentialParamsSchema,
  credentialSchema,
  projectIdParamsSchema,
} from '@auditor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { requireProjectAccess } from '../../middleware/auth.js';

export async function registerCredentialRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/projects/:id/credentials',
    {
      schema: {
        tags: ['Credentials'],
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
        response: { 200: z.array(credentialSchema) },
      },
    },
    async (request) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, id, 'MEMBER');
      const credentials = await app.prisma.credential.findMany({
        where: { projectId: project.id, organizationId: project.organizationId },
        orderBy: { createdAt: 'desc' },
      });
      return credentials.map((credential) => ({
        id: credential.id,
        organizationId: credential.organizationId,
        projectId: credential.projectId,
        name: credential.name,
        type: credential.type,
        username: credential.username,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
      }));
    },
  );

  app.post(
    '/projects/:id/credentials',
    {
      schema: {
        tags: ['Credentials'],
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
        body: createCredentialBodySchema,
        response: { 201: credentialSchema },
      },
    },
    async (request, reply) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, id, 'ADMIN');
      const body = createCredentialBodySchema.parse(request.body);
      const secretCiphertext = await app.secrets.encrypt(body.secret);

      const credential = await app.prisma.credential.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          name: body.name,
          type: body.type,
          username: body.username,
          secretCiphertext,
        },
      });

      await writeAuditLog(app.prisma, request, {
        action: 'credential.create',
        resourceType: 'Credential',
        resourceId: credential.id,
        organizationId: project.organizationId,
        metadata: { type: body.type, username: body.username },
      });

      return reply.status(201).send({
        id: credential.id,
        organizationId: credential.organizationId,
        projectId: credential.projectId,
        name: credential.name,
        type: credential.type,
        username: credential.username,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
      });
    },
  );

  app.delete(
    '/projects/:id/credentials/:credentialId',
    {
      schema: {
        tags: ['Credentials'],
        security: [{ cookieAuth: [] }],
        params: credentialParamsSchema,
      },
    },
    async (request, reply) => {
      const { id, credentialId } = credentialParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, id, 'ADMIN');
      const existing = await app.prisma.credential.findFirst({
        where: {
          id: credentialId,
          projectId: project.id,
          organizationId: project.organizationId,
        },
      });
      if (!existing) {
        throw new HttpError(404, 'Credential not found');
      }
      await app.prisma.credential.delete({ where: { id: existing.id } });
      await writeAuditLog(app.prisma, request, {
        action: 'credential.delete',
        resourceType: 'Credential',
        resourceId: existing.id,
        organizationId: project.organizationId,
      });
      return reply.status(204).send();
    },
  );
}
