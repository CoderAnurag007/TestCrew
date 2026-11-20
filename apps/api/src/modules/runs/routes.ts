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
  suppressionSchema,
} from '@auditor/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { assertTokenScope, requireAuth, requireProjectAccess } from '../../middleware/auth.js';
import { assertSafeNavigationTarget, UnsafeTargetError } from '@auditor/shared/ssrf';

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

const runSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  status: z.string(),
  errorMessage: z.string().nullable(),
  baseUrl: z.string(),
  safetyMode: z.string().nullable(),
  qualityScore: z.number().nullable(),
  previousRunId: z.string().nullable(),
  severityCounts: z.record(z.string(), z.number()),
  changeCounts: z.object({ new: z.number(), regressed: z.number(), recurring: z.number(), fixed: z.number() }),
  tests: z.object({ generated: z.number(), passed: z.number(), failed: z.number(), flaky: z.number() }),
  findings: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: z.string(),
      category: z.string(),
      url: z.string().nullable(),
      change: z.string(),
    }),
  ),
  summary: z.string().nullable(),
  completedAt: z.coerce.date().nullable(),
});

async function findRunForRequest(request: FastifyRequest, app: FastifyInstance) {
  const user = await requireAuth(request);
  const { runId } = runIdParamsSchema.parse(request.params);
  const run = await app.prisma.run.findFirst({
    where: { id: runId, organizationId: { in: user.memberships.map((item) => item.organizationId) } },
    select: { id: true, projectId: true, status: true },
  });
  if (!run) {
    throw new HttpError(404, 'Run not found');
  }
  assertTokenScope(request, run.projectId, 'Run not found');
  return run;
}

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
      if (body.replayOfRunId) {
        const source = await app.prisma.run.findFirst({
          where: { id: body.replayOfRunId, projectId: project.id, organizationId: project.organizationId },
          select: { id: true },
        });
        if (!source) {
          throw new HttpError(404, 'Run to replay not found in this project');
        }
      }

      const run = await app.prisma.run.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          environmentId,
          status: 'QUEUED',
          createdById: user.id,
          baseUrlOverride: body.baseUrl ?? null,
          replayOfRunId: body.replayOfRunId ?? null,
          trigger: body.trigger ?? (request.apiToken ? 'ci' : 'manual'),
          device: body.device ?? 'desktop',
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
          states: { orderBy: { createdAt: 'asc' }, take: 400 },
          stateEdges: { orderBy: { createdAt: 'asc' }, take: 400 },
          flows: { orderBy: { createdAt: 'asc' } },
          testCases: { orderBy: { createdAt: 'asc' } },
          testRuns: { orderBy: { createdAt: 'asc' } },
          evidence: { orderBy: { createdAt: 'asc' }, take: 1000 },
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
      assertTokenScope(request, run.projectId, 'Run not found');
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
      if (request.apiToken) {
        const owner = await app.prisma.run.findUnique({ where: { id: evidence.runId }, select: { projectId: true } });
        assertTokenScope(request, owner?.projectId ?? '', 'Evidence not found');
      }
      let body: Buffer;
      try {
        body = await app.storage.get(evidence.storageKey);
      } catch {
        throw new HttpError(404, 'Evidence file is no longer stored');
      }
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
      const dismissing = body.status === 'DISMISSED' || body.status === 'IGNORED';
      if (body.remember && dismissing && finding.signature) {
        await app.prisma.findingSuppression.upsert({
          where: { projectId_signature: { projectId: finding.projectId, signature: finding.signature } },
          create: {
            organizationId: finding.organizationId,
            projectId: finding.projectId,
            signature: finding.signature,
            title: finding.title,
            reason: body.reason ?? null,
            createdById: user.id,
          },
          update: { reason: body.reason ?? undefined },
        });
        await writeAuditLog(app.prisma, request, {
          action: 'finding.suppress',
          resourceType: 'Finding',
          resourceId: finding.id,
          organizationId: finding.organizationId,
          metadata: { signature: finding.signature, reason: body.reason ?? null },
        });
      }
      if (!dismissing && finding.signature) {
        // Re-opening a finding also forgets an earlier "not a bug" decision.
        await app.prisma.findingSuppression.deleteMany({
          where: { projectId: finding.projectId, signature: finding.signature },
        });
      }
      return app.prisma.finding.update({
        where: { id: finding.id },
        data: {
          status: body.status,
          ...(body.remember && dismissing ? { suppressed: true } : {}),
          ...(!dismissing ? { suppressed: false } : {}),
        },
      });
    },
  );

  app.get(
    '/projects/:projectId/suppressions',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Findings remembered as not-a-bug for this project',
        security: [{ cookieAuth: [] }],
        params: projectScopedParamsSchema,
        response: { 200: z.array(suppressionSchema) },
      },
    },
    async (request) => {
      const { projectId } = projectScopedParamsSchema.parse(request.params);
      const { project } = await requireProjectAccess(request, projectId, 'VIEWER');
      return app.prisma.findingSuppression.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' } });
    },
  );

  app.delete(
    '/projects/:projectId/suppressions/:suppressionId',
    {
      schema: {
        tags: ['Runs'],
        security: [{ cookieAuth: [] }],
        params: z.object({ projectId: z.string().min(1), suppressionId: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      const { projectId, suppressionId } = z
        .object({ projectId: z.string().min(1), suppressionId: z.string().min(1) })
        .parse(request.params);
      const { project } = await requireProjectAccess(request, projectId, 'MEMBER');
      const removed = await app.prisma.findingSuppression.deleteMany({ where: { id: suppressionId, projectId: project.id } });
      if (removed.count === 0) {
        throw new HttpError(404, 'Suppression not found');
      }
      return reply.status(204).send();
    },
  );

  app.get(
    '/runs/:runId/export/playwright',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Download the run\'s tests as a Playwright Test spec file',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        params: runIdParamsSchema,
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request);
      const { runId } = runIdParamsSchema.parse(request.params);
      const run = await app.prisma.run.findFirst({
        where: { id: runId, organizationId: { in: user.memberships.map((item) => item.organizationId) } },
        select: { id: true, projectId: true, status: true },
      });
      if (!run) {
        throw new HttpError(404, 'Run not found');
      }
      assertTokenScope(request, run.projectId, 'Run not found');
      let body: Buffer;
      try {
        body = await app.storage.get(`runs/${run.id}/snaghunt.spec.ts`);
      } catch {
        throw new HttpError(404, run.status === 'COMPLETED' ? 'This run has no exported tests' : 'Tests are exported when the run completes');
      }
      return reply
        .header('content-type', 'text/plain; charset=utf-8')
        .header('content-disposition', `attachment; filename="snaghunt-${run.id}.spec.ts"`)
        .send(body);
    },
  );

  app.get(
    '/runs/:runId/live',
    {
      schema: {
        tags: ['Runs'],
        summary: 'What the audit browser is doing right now: action, element box and frame sequence',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        params: runIdParamsSchema,
      },
    },
    async (request, reply) => {
      const run = await findRunForRequest(request, app);
      try {
        const meta = JSON.parse((await app.storage.get(`runs/${run.id}/live/meta.json`)).toString('utf8')) as Record<string, unknown>;
        return reply.header('cache-control', 'no-store').send({ available: true, status: run.status, ...meta });
      } catch {
        return reply.header('cache-control', 'no-store').send({ available: false, status: run.status });
      }
    },
  );

  app.get(
    '/runs/:runId/live/frame',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Latest JPEG frame of the audit browser',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        params: runIdParamsSchema,
      },
    },
    async (request, reply) => {
      const run = await findRunForRequest(request, app);
      let body: Buffer;
      try {
        body = await app.storage.get(`runs/${run.id}/live/frame.jpg`);
      } catch {
        throw new HttpError(404, 'No live frame yet');
      }
      return reply.header('content-type', 'image/jpeg').header('cache-control', 'no-store').send(body);
    },
  );

  app.get(
    '/runs/:runId/report.html',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Self-contained HTML report with embedded screenshots',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        params: runIdParamsSchema,
      },
    },
    async (request, reply) => {
      const run = await findRunForRequest(request, app);
      let body: Buffer;
      try {
        body = await app.storage.get(`runs/${run.id}/report.html`);
      } catch {
        throw new HttpError(404, run.status === 'COMPLETED' ? 'This run has no HTML report' : 'The report is created when the run completes');
      }
      const download = (request.query as { download?: string } | undefined)?.download === '1';
      return reply
        .header('content-type', 'text/html; charset=utf-8')
        .header('content-security-policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:")
        .header('content-disposition', `${download ? 'attachment' : 'inline'}; filename="snaghunt-report-${run.id}.html"`)
        .send(body);
    },
  );

  app.get(
    '/runs/:runId/summary',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Compact run result for CI: status, score and what changed since the previous run',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        params: runIdParamsSchema,
        response: { 200: runSummarySchema },
      },
    },
    async (request) => {
      const user = await requireAuth(request);
      const { runId } = runIdParamsSchema.parse(request.params);
      const run = await app.prisma.run.findFirst({
        where: { id: runId, organizationId: { in: user.memberships.map((item) => item.organizationId) } },
        include: {
          report: true,
          findings: {
            where: { suppressed: false },
            select: { id: true, title: true, severity: true, category: true, url: true, change: true },
            orderBy: { createdAt: 'asc' },
          },
          project: { select: { name: true, baseUrl: true } },
        },
      });
      if (!run) {
        throw new HttpError(404, 'Run not found');
      }
      assertTokenScope(request, run.projectId, 'Run not found');
      const payload = (run.report?.payload ?? {}) as { diff?: { counts?: Record<string, number>; fixed?: unknown[] } };
      const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
      for (const finding of run.findings) counts[finding.severity] += 1;
      return {
        id: run.id,
        projectId: run.projectId,
        projectName: run.project.name,
        status: run.status,
        errorMessage: run.errorMessage,
        baseUrl: run.baseUrlOverride ?? run.project.baseUrl,
        safetyMode: run.effectiveSafetyMode,
        qualityScore: run.qualityScore,
        previousRunId: run.previousRunId,
        severityCounts: counts,
        changeCounts: {
          new: run.findings.filter((item) => item.change === 'NEW').length,
          regressed: run.findings.filter((item) => item.change === 'REGRESSED').length,
          recurring: run.findings.filter((item) => item.change === 'RECURRING').length,
          fixed: payload.diff?.counts?.fixed ?? 0,
        },
        tests: { generated: run.testsGenerated, passed: run.testsPassed, failed: run.testsFailed, flaky: run.testsFlaky },
        findings: run.findings,
        summary: run.report?.summary ?? null,
        completedAt: run.completedAt,
      };
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
      assertTokenScope(request, run.projectId, 'Run not found');
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
        try {
          const body = await app.storage.get(latest.storageKey);
          return reply.header('content-type', 'image/png').header('cache-control', 'no-store').send(body);
        } catch {
          throw new HttpError(404, 'Screenshot not available');
        }
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
