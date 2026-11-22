import { createHash, randomBytes } from 'node:crypto';
import {
  DESIGN_AREA_LABELS,
  DESIGN_AREAS,
  FREE_SCAN_PREVIEW_ISSUES,
  isTerminalRunStatus,
  normalizeScanUrl,
  START_AUDIT_JOB,
  startFreeScanBodySchema,
  type DesignReport,
  type FreeScanPhase,
  type FreeScanView,
  type RunStatus,
} from '@auditor/shared';
import { assertSafeNavigationTarget, UnsafeTargetError } from '@auditor/shared/ssrf';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { hashPassword } from '../../lib/password.js';
import { assertCanAddSite, getUsage } from '../../lib/plans.js';
import { requireOrgRole } from '../../middleware/auth.js';

/**
 * Free checks from the landing page: anyone can start one without an account.
 *
 * Each check is a design review plus the quick bug scan (no crawl, no tests),
 * run in a hidden system workspace. Visitors see the progress and a teaser of
 * the results; signing up claims the check, which moves the site and its run
 * into the new workspace with every finding and screenshot intact.
 */

export const FREE_SCAN_WORKSPACE_SLUG = 'snaghunt-free-checks';
const SYSTEM_EMAIL = 'free-checks@system.snaghunt.invalid';
const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
/** A repeat request for the same site from the same visitor within this window reuses the check. */
const REUSE_WINDOW_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const tokenParamsSchema = z.object({ token: z.string().min(16).max(64) });
const claimBodySchema = z.object({ organizationId: z.string().min(1) });

/** Tables whose rows belong to one run; claiming moves them to the new workspace. */
const RUN_SCOPED = [
  'runStage',
  'page',
  'state',
  'stateEdge',
  'action',
  'flow',
  'testCase',
  'testRun',
  'finding',
  'evidence',
  'report',
  'runEvent',
  'aiUsage',
] as const;
/** Of those, the ones that also record the project. */
const PROJECT_SCOPED = new Set<string>(['page', 'flow', 'testCase', 'finding', 'report']);

type SystemWorkspace = { organizationId: string; userId: string };

/** The hidden workspace that owns unclaimed free checks, created on first use. */
async function systemWorkspace(app: FastifyInstance): Promise<SystemWorkspace> {
  const existing = await app.prisma.organization.findUnique({
    where: { slug: FREE_SCAN_WORKSPACE_SLUG },
    select: { id: true, memberships: { select: { userId: true }, take: 1 } },
  });
  if (existing?.memberships[0]) return { organizationId: existing.id, userId: existing.memberships[0].userId };

  const user =
    (await app.prisma.user.findUnique({ where: { email: SYSTEM_EMAIL }, select: { id: true } })) ??
    (await app.prisma.user.create({
      data: {
        email: SYSTEM_EMAIL,
        name: 'Free checks',
        // Nobody knows this password; the account can never sign in.
        passwordHash: await hashPassword(randomBytes(32).toString('hex')),
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    }));
  try {
    const org =
      existing ??
      (await app.prisma.organization.create({
        // Agency limits so the AI budget covers many checks a month.
        data: { name: 'Free checks', slug: FREE_SCAN_WORKSPACE_SLUG, plan: 'AGENCY' },
        select: { id: true },
      }));
    await app.prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      create: { userId: user.id, organizationId: org.id, role: 'OWNER' },
      update: {},
    });
    return { organizationId: org.id, userId: user.id };
  } catch {
    // Two first checks at once: the other request created it.
    return systemWorkspace(app);
  }
}

function visitorHash(app: FastifyInstance, ip: string): string {
  return createHash('sha256').update(`${app.env.SESSION_SECRET}:free-scan:${ip}`).digest('hex').slice(0, 40);
}

function phaseOf(status: RunStatus): FreeScanPhase {
  if (status === 'QUEUED') return 'queued';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED' || status === 'CANCELLED') return 'failed';
  return 'running';
}

function pathOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    return null;
  }
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** The first page screenshot of the design review, shown in the teaser. */
function homepageShot(report: DesignReport | null): string | null {
  return report?.pages?.find((page) => page.desktop)?.desktop ?? null;
}

async function findScan(app: FastifyInstance, token: string) {
  const scan = await app.prisma.freeScan.findUnique({
    where: { token },
    include: {
      run: {
        select: {
          id: true,
          projectId: true,
          organizationId: true,
          status: true,
          errorMessage: true,
          currentAction: true,
          designScore: true,
          designReport: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  });
  if (!scan) throw new HttpError(404, 'This free check was not found. It may have expired.');
  return scan;
}

export async function registerFreeScanRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------ start one */

  app.post(
    '/public/free-scans',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } }, schema: { tags: ['Free checks'], body: startFreeScanBodySchema } },
    async (request, reply) => {
      const body = startFreeScanBodySchema.parse(request.body);
      const url = normalizeScanUrl(body.url);
      if (!url) throw new HttpError(400, 'Enter a website address, like yourshop.com');
      try {
        await assertSafeNavigationTarget(url.toString(), { allowPrivate: false });
      } catch (error) {
        if (error instanceof UnsafeTargetError) {
          throw new HttpError(
            400,
            /resolve/i.test(error.message)
              ? `We couldn't find a website at ${url.host}. Check the address and try again.`
              : 'That address is not a public website we can check.',
          );
        }
        throw error;
      }

      const host = url.host.toLowerCase();
      const ipHash = visitorHash(app, request.ip);
      const now = Date.now();

      // Pressing the button twice, or coming back within the hour, shows the same check.
      const recent = await app.prisma.freeScan.findFirst({
        where: { ipHash, host, createdAt: { gte: new Date(now - REUSE_WINDOW_MS) }, claimedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { run: { select: { status: true } } },
      });
      if (recent && !['FAILED', 'CANCELLED'].includes(recent.run.status)) {
        return reply.status(200).send({ token: recent.token, reused: true });
      }

      const since = new Date(now - DAY_MS);
      const [mine, everyone] = await Promise.all([
        app.prisma.freeScan.count({ where: { ipHash, createdAt: { gte: since } } }),
        app.prisma.freeScan.count({ where: { createdAt: { gte: since } } }),
      ]);
      if (mine >= app.env.FREE_SCAN_PER_VISITOR) {
        throw new HttpError(
          429,
          `You've used your ${app.env.FREE_SCAN_PER_VISITOR} free checks for today. Create a free account to keep auditing.`,
        );
      }
      if (everyone >= app.env.FREE_SCAN_DAILY_LIMIT) {
        throw new HttpError(503, 'Free checks are fully booked today. Create a free account to run an audit right away.');
      }

      const system = await systemWorkspace(app);
      const token = randomBytes(18).toString('base64url');
      const target = url.toString();

      const { run } = await app.prisma.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: {
            organizationId: system.organizationId,
            name: host.replace(/^www\./, ''),
            baseUrl: target,
            designReview: true,
            safetyMode: 'READ_ONLY',
          },
        });
        const environment = await tx.environment.create({
          data: {
            organizationId: system.organizationId,
            projectId: project.id,
            name: 'Production',
            baseUrl: target,
            kind: 'PRODUCTION',
            safetyMode: 'READ_ONLY',
          },
        });
        const created = await tx.run.create({
          data: {
            organizationId: system.organizationId,
            projectId: project.id,
            environmentId: environment.id,
            status: 'QUEUED',
            createdById: system.userId,
            trigger: 'free',
            device: 'desktop',
            bugAudit: false,
            designReview: true,
          },
        });
        await tx.freeScan.create({ data: { token, url: target, host, ipHash, runId: created.id } });
        await tx.runEvent.create({
          data: {
            organizationId: system.organizationId,
            runId: created.id,
            kind: 'stage',
            message: 'Free check queued. Opening a fresh browser…',
          },
        });
        return { run: created };
      });

      const job = await app.runQueue.add(
        START_AUDIT_JOB,
        { runId: run.id, organizationId: run.organizationId, projectId: run.projectId },
        { jobId: run.id, removeOnComplete: 100, removeOnFail: 100 },
      );
      await app.prisma.run.update({ where: { id: run.id }, data: { queueJobId: job.id ?? run.id } });

      return reply.status(201).send({ token, reused: false });
    },
  );

  /* ------------------------------------------------- progress and teaser */

  app.get('/public/free-scans/:token', async (request, reply) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const scan = await findScan(app, token);
    const run = scan.run;
    const phase = phaseOf(run.status as RunStatus);

    let activity: string | null = null;
    if (phase === 'queued' || phase === 'running') {
      const last = await app.prisma.runEvent.findFirst({
        where: { runId: run.id, kind: { in: ['stage', 'info', 'action'] } },
        orderBy: { createdAt: 'desc' },
        select: { message: true },
      });
      activity = run.currentAction ?? last?.message ?? null;
    }

    let result: FreeScanView['result'] = null;
    if (phase === 'completed') {
      const findings = await app.prisma.finding.findMany({
        where: { runId: run.id, suppressed: false, duplicateOfId: null, status: { notIn: ['DISMISSED', 'IGNORED'] } },
        select: { title: true, severity: true, category: true, url: true, description: true, signature: true },
      });
      findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
      const severityCounts: Record<string, number> = {};
      for (const finding of findings) severityCounts[finding.severity] = (severityCounts[finding.severity] ?? 0) + 1;
      const design = (run.designReport ?? null) as DesignReport | null;
      result = {
        designScore: run.designScore,
        areas: design?.areas
          ? DESIGN_AREAS.map((area) => ({
              area,
              label: DESIGN_AREA_LABELS[area],
              score: design.areas[area]?.score ?? 100,
              issues: design.areas[area]?.issues ?? 0,
            }))
          : [],
        totalIssues: findings.length,
        severityCounts,
        bugCount: findings.filter((finding) => !finding.signature?.startsWith('design|')).length,
        preview: findings.slice(0, FREE_SCAN_PREVIEW_ISSUES).map((finding) => ({
          title: finding.title,
          severity: finding.severity,
          category: finding.category,
          path: pathOf(finding.url),
          description: clip(finding.description, 220),
        })),
        screenshot: Boolean(homepageShot(design)),
      };
    }

    const view: FreeScanView = {
      url: scan.url,
      host: scan.host,
      phase,
      activity,
      startedAt: (run.startedAt ?? run.createdAt).toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      error: phase === 'failed' ? (run.errorMessage ?? 'The check could not finish.') : null,
      claimed: Boolean(scan.claimedAt),
      result,
    };
    return reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex').send(view);
  });

  /** The homepage screenshot from the design review, the only image the teaser shows. */
  app.get('/public/free-scans/:token/screenshot', async (request, reply) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const scan = await findScan(app, token);
    const evidenceId = homepageShot((scan.run.designReport ?? null) as DesignReport | null);
    if (scan.run.status !== 'COMPLETED' || !evidenceId) throw new HttpError(404, 'Not found');
    const evidence = await app.prisma.evidence.findFirst({ where: { id: evidenceId, runId: scan.run.id, type: 'SCREENSHOT' } });
    if (!evidence || !evidence.contentType.startsWith('image/')) throw new HttpError(404, 'Not found');
    let body: Buffer;
    try {
      body = await app.storage.get(evidence.storageKey);
    } catch {
      throw new HttpError(404, 'Not found');
    }
    return reply
      .header('content-type', evidence.contentType)
      .header('cache-control', 'private, max-age=300')
      .header('x-robots-tag', 'noindex')
      .send(body);
  });

  /* ------------------------------------------------------------- claiming */

  /** Moves a finished free check into the signed-in user's workspace. */
  app.post('/free-scans/:token/claim', async (request) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const { organizationId } = claimBodySchema.parse(request.body ?? {});
    const { user } = await requireOrgRole(request, organizationId, 'MEMBER');
    const scan = await findScan(app, token);
    const run = scan.run;

    if (scan.claimedOrganizationId === organizationId) return { projectId: run.projectId, runId: run.id, alreadyClaimed: true };
    if (scan.claimedAt) throw new HttpError(409, 'This free check was already saved to another account.');
    if (!isTerminalRunStatus(run.status as RunStatus)) {
      throw new HttpError(409, 'The free check is still running. It can be saved once it finishes.');
    }
    const system = await systemWorkspace(app);
    if (run.organizationId !== system.organizationId) throw new HttpError(409, 'This free check was already saved.');

    // The same site already in the workspace: add the check to it instead of a second copy.
    const sameSite = (await app.prisma.project.findMany({ where: { organizationId }, select: { id: true, baseUrl: true } })).find(
      (project) => {
        try {
          return new URL(project.baseUrl).host.toLowerCase() === scan.host;
        } catch {
          return false;
        }
      },
    );
    if (!sameSite) assertCanAddSite(await getUsage(app.prisma, organizationId));

    const projectId = await app.prisma.$transaction(async (tx) => {
      // Mark it first so two claims at once cannot both move it.
      const marked = await tx.freeScan.updateMany({
        where: { id: scan.id, claimedAt: null },
        data: { claimedAt: new Date(), claimedOrganizationId: organizationId },
      });
      if (marked.count === 0) throw new HttpError(409, 'This free check was already saved.');

      let targetProjectId = run.projectId;
      let environmentId: string | null = null;
      if (sameSite) {
        targetProjectId = sameSite.id;
        environmentId =
          (await tx.environment.findFirst({ where: { projectId: sameSite.id }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ??
          null;
      } else {
        await tx.project.update({ where: { id: run.projectId }, data: { organizationId } });
        await tx.environment.updateMany({ where: { projectId: run.projectId }, data: { organizationId } });
      }

      for (const model of RUN_SCOPED) {
        const data: Record<string, string> = { organizationId };
        if (sameSite && PROJECT_SCOPED.has(model)) data.projectId = targetProjectId;
        await (tx[model] as unknown as { updateMany: (args: object) => Promise<unknown> }).updateMany({
          where: { runId: run.id },
          data,
        });
      }
      await tx.run.update({
        where: { id: run.id },
        data: {
          organizationId,
          createdById: user.id,
          ...(sameSite ? { projectId: targetProjectId, environmentId } : {}),
        },
      });
      // The empty copy of the site in the system workspace.
      if (sameSite) await tx.project.delete({ where: { id: run.projectId } });
      return targetProjectId;
    });

    await writeAuditLog(app.prisma, request, {
      action: 'free_scan.claim',
      resourceType: 'Run',
      resourceId: run.id,
      organizationId,
    });
    return { projectId, runId: run.id, alreadyClaimed: false };
  });
}
