import {
  aiUsageSchema,
  coverageStatsSchema,
  createRunBodySchema,
  evidenceParamsSchema,
  evidenceSchema,
  findingParamsSchema,
  findingSchema,
  flowSchema,
  isTerminalRunStatus,
  pageSchema,
  projectScopedParamsSchema,
  reportSchema,
  runCostSchema,
  runEventSchema,
  runIdParamsSchema,
  runSchema,
  runStageSchema,
  START_AUDIT_JOB,
  stateEdgeSchema,
  stateSchema,
  testCaseSchema,
  testRunSchema,
  updateFindingBodySchema,
} from '@auditor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { requireAuth, requireProjectAccess } from '../../middleware/auth.js';

const findingDetailSchema = findingSchema.extend({
  steps: z.unknown().optional(),
  evidence: z.array(evidenceSchema).optional(),
});

const runDetailSchema = runSchema.extend({
  stages: z.array(runStageSchema),
  findings: z.array(findingDetailSchema),
  pages: z.array(pageSchema).optional(),
  states: z.array(stateSchema).optional(),
  edges: z.array(stateEdgeSchema).optional(),
  flows: z.array(flowSchema).optional(),
  testCases: z.array(testCaseSchema).optional(),
  testRuns: z.array(testRunSchema).optional(),
  evidence: z.array(evidenceSchema).optional(),
  report: reportSchema.nullable().optional(),
  reportPayload: z.unknown().optional(),
  aiUsages: z.array(aiUsageSchema).optional(),
  coverage: coverageStatsSchema.optional(),
  cost: runCostSchema.optional(),
  events: z.array(runEventSchema).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
  project: z.object({
    id: z.string(),
    name: z.string(),
    baseUrl: z.string(),
  }),
  environment: z
    .object({
      id: z.string(),
      name: z.string(),
      baseUrl: z.string(),
    })
    .nullable(),
});

export async function registerRunRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/projects/:projectId/runs',
    {
      schema: {
        tags: ['Runs'],
        security: [{ cookieAuth: [] }],
        params: projectScopedParamsSchema,
        body: createRunBodySchema,
        response: { 201: runSchema },
      },
    },
    async (request, reply) => {
      const { projectId } = projectScopedParamsSchema.parse(request.params);
      const { user, project } = await requireProjectAccess(request, projectId, 'MEMBER');
      const body = createRunBodySchema.parse(request.body ?? {});

      let environmentId = body.environmentId ?? null;
      if (environmentId) {
        const environment = await app.prisma.environment.findFirst({
          where: {
            id: environmentId,
            projectId: project.id,
            organizationId: project.organizationId,
          },
        });
        if (!environment) {
          throw new HttpError(404, 'Environment not found');
        }
      } else {
        const fallback = await app.prisma.environment.findFirst({
          where: { projectId: project.id, organizationId: project.organizationId },
          orderBy: { createdAt: 'asc' },
        });
        environmentId = fallback?.id ?? null;
      }

      const run = await app.prisma.run.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          environmentId,
          status: 'QUEUED',
          createdById: user.id,
        },
      });

      const job = await app.runQueue.add(
        START_AUDIT_JOB,
        {
          runId: run.id,
          organizationId: project.organizationId,
          projectId: project.id,
        },
        { jobId: run.id, removeOnComplete: 100, removeOnFail: 100 },
      );

      const queued = await app.prisma.run.update({
        where: { id: run.id },
        data: { queueJobId: job.id ?? run.id },
      });

      await app.prisma.runEvent.create({
        data: {
          organizationId: project.organizationId,
          runId: run.id,
          kind: 'stage',
          message: 'Audit queued. Starting the isolated browser session…',
        },
      });

      await writeAuditLog(app.prisma, request, {
        action: 'run.create',
        resourceType: 'Run',
        resourceId: run.id,
        organizationId: project.organizationId,
      });

      return reply.status(201).send(queued);
    },
  );

  app.get(
    '/projects/:projectId/runs',
    {
      schema: {
        tags: ['Runs'],
        security: [{ cookieAuth: [] }],
        params: projectScopedParamsSchema,
        response: { 200: z.array(runSchema) },
      },
    },
    async (request) => {
      const { projectId } = projectScopedParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, projectId, 'VIEWER');
      return app.prisma.run.findMany({
        where: { projectId: project.id, organizationId: project.organizationId },
        orderBy: { createdAt: 'desc' },
      });
    },
  );

  app.get(
    '/runs/:runId',
    {
      schema: {
        tags: ['Runs'],
        security: [{ cookieAuth: [] }],
        params: runIdParamsSchema,
        response: { 200: runDetailSchema },
      },
    },
    async (request) => {
      const user = await requireAuth(request);
      const { runId } = runIdParamsSchema.parse(request.params);
      const orgIds = user.memberships.map((item) => item.organizationId);
      const run = await app.prisma.run.findFirst({
        where: { id: runId, organizationId: { in: orgIds } },
        include: {
          stages: { orderBy: { createdAt: 'asc' } },
          findings: { orderBy: { createdAt: 'desc' }, include: { evidence: true } },
          pages: { orderBy: { createdAt: 'asc' }, take: 200 },
          states: { orderBy: { createdAt: 'asc' }, take: 200 },
          stateEdges: { orderBy: { createdAt: 'asc' }, take: 400 },
          flows: { orderBy: { createdAt: 'asc' } },
          testCases: { orderBy: { createdAt: 'asc' } },
          testRuns: { orderBy: { createdAt: 'asc' } },
          evidence: { orderBy: { createdAt: 'asc' }, take: 300 },
          report: true,
          aiUsages: { orderBy: { createdAt: 'asc' } },
          events: { orderBy: { createdAt: 'desc' }, take: 400 },
          project: { select: { id: true, name: true, baseUrl: true } },
          environment: { select: { id: true, name: true, baseUrl: true } },
        },
      });
      if (!run) {
        throw new HttpError(404, 'Run not found');
      }
      const elapsedMs = (run.completedAt ?? new Date()).getTime() - (run.startedAt ?? run.createdAt).getTime();
      const testedFlowIds = new Set(run.testCases.map((item) => item.flowId).filter(Boolean));
      const failedFlowIds = new Set(
        run.testRuns
          .filter((item) => item.status === 'FAILED' || item.status === 'ERROR')
          .map((item) => run.testCases.find((test) => test.id === item.testCaseId)?.flowId)
          .filter(Boolean),
      );
      const successfulFlowIds = new Set(
        run.testRuns
          .filter((item) => item.status === 'PASSED')
          .map((item) => run.testCases.find((test) => test.id === item.testCaseId)?.flowId)
          .filter(Boolean),
      );
      return {
        ...run,
        edges: run.stateEdges,
        events: [...run.events].reverse(),
        elapsedMs: Math.max(0, elapsedMs),
        reportPayload: run.report?.payload ?? null,
        coverage: {
          discoveredFlows: run.flows.length,
          testedFlows: testedFlowIds.size,
          successfulFlows: successfulFlowIds.size,
          failedFlows: failedFlowIds.size,
          untestedFlows: Math.max(0, run.flows.length - testedFlowIds.size),
        },
        cost: {
          aiCostUsd: run.aiCostUsd,
          browserDurationMs: run.browserDurationMs,
          storageBytesEstimate: run.storageBytesEstimate,
        },
      };
    },
  );

  app.get(
    '/runs/:runId/evidence/:evidenceId',
    {
      schema: {
        tags: ['Runs'],
        security: [{ cookieAuth: [] }],
        params: evidenceParamsSchema,
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request);
      const { runId, evidenceId } = evidenceParamsSchema.parse(request.params);
      const orgIds = user.memberships.map((item) => item.organizationId);
      const evidence = await app.prisma.evidence.findFirst({
        where: { id: evidenceId, runId, organizationId: { in: orgIds } },
      });
      if (!evidence) {
        throw new HttpError(404, 'Evidence not found');
      }
      const body = await app.storage.get(evidence.storageKey);
      return reply
        .header('content-type', evidence.contentType)
        .header('content-disposition', `inline; filename="${evidence.fileName ?? evidence.id}"`)
        .header('cache-control', 'private, max-age=60')
        .send(body);
    },
  );

  app.patch(
    '/runs/:runId/findings/:findingId',
    {
      schema: {
        tags: ['Runs'],
        security: [{ cookieAuth: [] }],
        params: findingParamsSchema,
        body: updateFindingBodySchema,
        response: { 200: findingSchema },
      },
    },
    async (request) => {
      const user = await requireAuth(request);
      const { runId, findingId } = findingParamsSchema.parse(request.params);
      const body = updateFindingBodySchema.parse(request.body);
      const orgIds = user.memberships.map((item) => item.organizationId);
      const finding = await app.prisma.finding.findFirst({
        where: { id: findingId, runId, organizationId: { in: orgIds } },
      });
      if (!finding) {
        throw new HttpError(404, 'Finding not found');
      }
      await requireProjectAccess(request, finding.projectId, 'MEMBER');
      return app.prisma.finding.update({
        where: { id: finding.id },
        data: { status: body.status },
      });
    },
  );

  app.get(
    '/runs/:runId/screenshot',
    {
      schema: {
        tags: ['Runs'],
        security: [{ cookieAuth: [] }],
        params: runIdParamsSchema,
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request);
      const { runId } = runIdParamsSchema.parse(request.params);
      const orgIds = user.memberships.map((item) => item.organizationId);
      const run = await app.prisma.run.findFirst({
        where: { id: runId, organizationId: { in: orgIds } },
      });
      if (!run) {
        throw new HttpError(404, 'Run not found');
      }
      let screenshotKey = run.lastScreenshotKey;
      if (!screenshotKey) {
        const latest = await app.prisma.evidence.findFirst({
          where: { runId, type: 'SCREENSHOT' },
          orderBy: { createdAt: 'desc' },
        });
        screenshotKey = latest?.storageKey ?? null;
      }
      if (!screenshotKey) {
        throw new HttpError(404, 'Screenshot not available');
      }
      try {
        const body = await app.storage.get(screenshotKey);
        return reply.header('content-type', 'image/png').header('cache-control', 'no-store').send(body);
      } catch {
        const latest = await app.prisma.evidence.findFirst({
          where: { runId, type: 'SCREENSHOT', storageKey: { not: screenshotKey } },
          orderBy: { createdAt: 'desc' },
        });
        if (!latest) {
          throw new HttpError(404, 'Screenshot not available');
        }
        const body = await app.storage.get(latest.storageKey);
        return reply.header('content-type', 'image/png').header('cache-control', 'no-store').send(body);
      }
    },
  );

  app.post(
    '/runs/:runId/cancel',
    {
      schema: {
        tags: ['Runs'],
        security: [{ cookieAuth: [] }],
        params: runIdParamsSchema,
        response: { 200: runSchema },
      },
    },
    async (request) => {
      const user = await requireAuth(request);
      const { runId } = runIdParamsSchema.parse(request.params);
      const orgIds = user.memberships.map((item) => item.organizationId);
      const run = await app.prisma.run.findFirst({
        where: { id: runId, organizationId: { in: orgIds } },
      });
      if (!run) {
        throw new HttpError(404, 'Run not found');
      }
      await requireProjectAccess(request, run.projectId, 'MEMBER');
      if (isTerminalRunStatus(run.status)) {
        throw new HttpError(409, `Run is already ${run.status.toLowerCase()}`);
      }

      const cancelled = await app.prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'CANCELLED',
          completedAt: new Date(),
        },
      });

      if (run.queueJobId) {
        const job = await app.runQueue.getJob(run.queueJobId);
        if (job) {
          try {
            await job.remove();
          } catch {
            request.log.warn({ jobId: run.queueJobId }, 'failed to remove queued job');
          }
        }
      }

      await writeAuditLog(app.prisma, request, {
        action: 'run.cancel',
        resourceType: 'Run',
        resourceId: run.id,
        organizationId: run.organizationId,
      });

      return cancelled;
    },
  );

  app.post(
    '/runs/:runId/retry',
    {
      schema: {
        tags: ['Runs'],
        security: [{ cookieAuth: [] }],
        params: runIdParamsSchema,
        response: { 200: runSchema },
      },
    },
    async (request) => {
      const user = await requireAuth(request);
      const { runId } = runIdParamsSchema.parse(request.params);
      const orgIds = user.memberships.map((item) => item.organizationId);
      const run = await app.prisma.run.findFirst({
        where: { id: runId, organizationId: { in: orgIds } },
      });
      if (!run) {
        throw new HttpError(404, 'Run not found');
      }
      await requireProjectAccess(request, run.projectId, 'MEMBER');
      const waitingForAuth =
        run.currentAction === 'authentication-required' ||
        /AUTHENTICATION_REQUIRED|username or password fields were not found|Authentication did not leave/i.test(
          run.errorMessage ?? '',
        );
      if (!waitingForAuth || (run.status !== 'AUTHENTICATING' && run.status !== 'FAILED' && run.status !== 'QUEUED')) {
        throw new HttpError(409, 'This run is not waiting for credentials');
      }

      const retried = await app.prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'QUEUED',
          errorMessage: null,
          currentAction: null,
          completedAt: null,
        },
      });

      await app.prisma.runEvent.create({
        data: {
          organizationId: run.organizationId,
          runId: run.id,
          kind: 'stage',
          message: 'Credentials saved. Retrying the audit…',
          url: run.currentUrl,
        },
      });

      await writeAuditLog(app.prisma, request, {
        action: 'run.retry',
        resourceType: 'Run',
        resourceId: run.id,
        organizationId: run.organizationId,
      });

      return retried;
    },
  );
}
