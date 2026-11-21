import { assertCanAddSite, getUsage } from '../../lib/plans.js';
import {
  createProjectBodySchema,
  environmentSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  projectSchema,
  updateProjectBodySchema,
  parseTestPlan,
  type TestPlan,
} from '@auditor/shared';
import { assertSafeNavigationTarget, UnsafeTargetError } from '@auditor/shared/ssrf';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { requireOrgRole, requireProjectAccess } from '../../middleware/auth.js';
import { randomBytes } from 'node:crypto';
import { verificationRecordName, verifyDomainOwnership } from '@auditor/shared/verification';

const projectDetailSchema = projectSchema.extend({
  environments: z.array(environmentSchema),
});

const verificationInstructionsSchema = z.object({
  host: z.string(),
  token: z.string(),
  verified: z.boolean(),
  verifiedAt: z.coerce.date().nullable(),
  dnsRecordName: z.string(),
  dnsRecordValue: z.string(),
  fileUrl: z.string(),
  fileContents: z.string(),
});

/** Hosts proven to belong to this project (the legacy single host plus the list). */
function verifiedHostsOf(project: { verifiedHost: string | null; verifiedAt: Date | null; verifiedHosts: unknown }): string[] {
  const list = Array.isArray(project.verifiedHosts) ? project.verifiedHosts.filter((item): item is string => typeof item === 'string') : [];
  if (project.verifiedHost && project.verifiedAt) list.push(project.verifiedHost);
  return [...new Set(list.map((item) => item.toLowerCase()))];
}

/** The URL to verify: an environment of this project (?environmentId=...) or the project URL. */
async function verificationTarget(
  app: FastifyInstance,
  project: { id: string; baseUrl: string },
  query: unknown,
): Promise<string> {
  const environmentId = (query as { environmentId?: string } | undefined)?.environmentId;
  if (!environmentId) return project.baseUrl;
  const environment = await app.prisma.environment.findFirst({ where: { id: environmentId, projectId: project.id } });
  if (!environment) throw new HttpError(404, 'Environment not found');
  return environment.baseUrl;
}

/** Project responses always carry a complete test plan with defaults filled in. */
function withPlan<T extends { testPlan: unknown }>(project: T): T & { testPlan: TestPlan } {
  return { ...project, testPlan: parseTestPlan(project.testPlan) };
}

function verificationInstructions(baseUrl: string, token: string, verifiedHosts: string[]) {
  const parsed = new URL(baseUrl);
  const host = parsed.host.toLowerCase();
  const verified = verifiedHosts.includes(host);
  return {
    host,
    token,
    verified,
    verifiedAt: null,
    dnsRecordName: verificationRecordName(parsed.hostname),
    dnsRecordValue: `snaghunt-verify=${token}`,
    fileUrl: `${parsed.protocol}//${host}/.well-known/snaghunt-verification.txt`,
    fileContents: token,
  };
}

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
      assertCanAddSite(await getUsage(app.prisma, body.organizationId));
      for (const target of [body.baseUrl, body.resetHookUrl, body.stagingUrl].filter((item): item is string => Boolean(item))) {
        try {
          await assertSafeNavigationTarget(target, { allowPrivate: body.allowPrivateTargets ?? false });
        } catch (error) {
          if (error instanceof UnsafeTargetError) {
            throw new HttpError(400, error.message);
          }
          throw error;
        }
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
            designReview: body.designReview,
            safetyMode: body.safetyMode,
            resetHookUrl: body.resetHookUrl ?? undefined,
            intents: body.intents ?? undefined,
            blockedPathPatterns: body.blockedPathPatterns ?? undefined,
            testPlan: body.testPlan ?? undefined,
          },
        });
        await tx.environment.create({
          data: {
            organizationId: membership.organizationId,
            projectId: created.id,
            name: body.environmentName,
            baseUrl: body.baseUrl,
            kind: 'PRODUCTION',
            safetyMode: body.safetyMode ?? 'READ_ONLY',
          },
        });
        if (body.stagingUrl) {
          await tx.environment.create({
            data: {
              organizationId: membership.organizationId,
              projectId: created.id,
              name: body.environmentName.toLowerCase() === 'staging' ? 'Staging copy' : 'Staging',
              baseUrl: body.stagingUrl,
              kind: 'STAGING',
              safetyMode: body.stagingSafetyMode ?? 'FULL',
            },
          });
        }
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

      return reply.status(201).send(withPlan(project));
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
      const projects = await app.prisma.project.findMany({
        where: { organizationId: query.organizationId },
        orderBy: { createdAt: 'desc' },
      });
      return projects.map(withPlan);
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
      return withPlan(project);
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
      const current = await app.prisma.project.findUniqueOrThrow({ where: { id } });
      for (const target of [body.baseUrl, body.resetHookUrl].filter((item): item is string => Boolean(item))) {
        try {
          await assertSafeNavigationTarget(target, {
            allowPrivate: body.allowPrivateTargets ?? current.allowPrivateTargets,
          });
        } catch (error) {
          if (error instanceof UnsafeTargetError) {
            throw new HttpError(400, error.message);
          }
          throw error;
        }
      }
      // Ownership was proven for a host; a new host needs a new proof.
      const hostChanged = body.baseUrl !== undefined && new URL(body.baseUrl).host !== new URL(current.baseUrl).host;
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
          designReview: body.designReview,
          safetyMode: body.safetyMode,
          resetHookUrl: body.resetHookUrl,
          intents: body.intents ?? undefined,
          blockedPathPatterns: body.blockedPathPatterns ?? undefined,
          testPlan: body.testPlan ?? undefined,
          ...(hostChanged ? { verifiedAt: null, verifiedHost: null } : {}),
        },
      });
      await writeAuditLog(app.prisma, request, {
        action: 'project.update',
        resourceType: 'Project',
        resourceId: id,
        organizationId: project.organizationId,
        metadata: {
          fields: Object.keys(body),
          ...(body.safetyMode ? { safetyMode: body.safetyMode } : {}),
        },
      });
      return withPlan(project);
    },
  );

  app.post(
    '/projects/:id/verification',
    {
      schema: {
        tags: ['Projects'],
        summary: 'Get or create the domain-ownership token for FULL safety mode',
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
        response: { 200: verificationInstructionsSchema },
      },
    },
    async (request) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, id, 'ADMIN');
      const target = await verificationTarget(app, project, request.query);
      const token = project.verificationToken ?? randomBytes(16).toString('hex');
      if (!project.verificationToken) {
        await app.prisma.project.update({ where: { id }, data: { verificationToken: token } });
      }
      return verificationInstructions(target, token, verifiedHostsOf(project));
    },
  );

  app.post(
    '/projects/:id/verification/check',
    {
      schema: {
        tags: ['Projects'],
        summary: 'Check the DNS record or well-known file and mark the domain verified',
        security: [{ cookieAuth: [] }],
        params: projectIdParamsSchema,
        response: { 200: verificationInstructionsSchema.extend({ detail: z.string() }) },
      },
    },
    async (request) => {
      const { id } = projectIdParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, id, 'ADMIN');
      if (!project.verificationToken) {
        throw new HttpError(400, 'Request a verification token first');
      }
      const target = await verificationTarget(app, project, request.query);
      const result = await verifyDomainOwnership({
        baseUrl: target,
        token: project.verificationToken,
        allowPrivate: project.allowPrivateTargets,
      });
      const host = new URL(target).host.toLowerCase();
      const isPrimary = host === new URL(project.baseUrl).host.toLowerCase();
      const updated = result.verified
        ? await app.prisma.project.update({
            where: { id },
            data: {
              verifiedHosts: [...new Set([...verifiedHostsOf(project), host])],
              ...(isPrimary ? { verifiedHost: host, verifiedAt: new Date() } : {}),
            },
          })
        : project;
      await writeAuditLog(app.prisma, request, {
        action: result.verified ? 'project.domain_verified' : 'project.domain_verification_failed',
        resourceType: 'Project',
        resourceId: id,
        organizationId: project.organizationId,
        metadata: { host: result.host, method: result.method ?? null },
      });
      return {
        ...verificationInstructions(target, project.verificationToken, verifiedHostsOf(updated)),
        detail: result.detail,
      };
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
