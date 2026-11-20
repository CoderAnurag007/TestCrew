import { randomBytes } from 'node:crypto';
import {
  brandingBodySchema,
  findingParamsSchema,
  findingSteps,
  integrationBodySchema,
  integrationProviderSchema,
  monitoringBodySchema,
  nextMonitorRun,
  projectIdParamsSchema,
  runIdParamsSchema,
  ticketMarkdown,
  TICKET_PROVIDERS,
  type Integration,
  type PublicReport,
  type TicketFinding,
  type TicketProvider,
} from '@auditor/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { requireAuth, requireOrgRole, requireProjectAccess } from '../../middleware/auth.js';

/** Monitoring, alert channels, bug tickets, share links and report branding. */

type Fetch = typeof fetch;

export async function registerLaunchRoutes(app: FastifyInstance, send: Fetch = fetch): Promise<void> {
  const webOrigin = app.env.WEB_ORIGIN.replace(/\/+$/, '');

  /* ------------------------------------------------------------ monitoring */

  app.put('/projects/:id/monitoring', async (request) => {
    const { id } = projectIdParamsSchema.parse(request.params);
    const { project } = await requireProjectAccess(request, id, 'ADMIN');
    const body = monitoringBodySchema.parse(request.body ?? {});
    if (body.environmentId) {
      const environment = await app.prisma.environment.findFirst({
        where: { id: body.environmentId, projectId: project.id },
        select: { id: true },
      });
      if (!environment) throw new HttpError(404, 'Environment not found');
    }
    const updated = await app.prisma.project.update({
      where: { id: project.id },
      data: {
        monitorCadence: body.cadence,
        monitorHourUtc: body.hourUtc,
        monitorWeekday: body.weekday,
        monitorEnvironmentId: body.environmentId,
        monitorDevices: body.devices,
        alertSettings: body.alerts,
        nextMonitorAt: nextMonitorRun(body.cadence, body.hourUtc, body.weekday),
      },
    });
    await writeAuditLog(app.prisma, request, {
      action: 'project.monitoring',
      resourceType: 'Project',
      resourceId: project.id,
      organizationId: project.organizationId,
      metadata: { cadence: body.cadence, devices: body.devices },
    });
    return monitoringView(updated);
  });

  app.get('/projects/:id/monitoring', async (request) => {
    const { id } = projectIdParamsSchema.parse(request.params);
    const { project } = await requireProjectAccess(request, id, 'VIEWER');
    return monitoringView(project);
  });

  /* ---------------------------------------------------------- integrations */

  app.get('/projects/:id/integrations', async (request) => {
    const { id } = projectIdParamsSchema.parse(request.params);
    const { project } = await requireProjectAccess(request, id, 'VIEWER');
    const rows = await app.prisma.projectIntegration.findMany({ where: { projectId: project.id } });
    return Promise.all(rows.map((row) => integrationView(app, row)));
  });

  app.put('/projects/:id/integrations', async (request) => {
    const { id } = projectIdParamsSchema.parse(request.params);
    const { project } = await requireProjectAccess(request, id, 'ADMIN');
    const body = integrationBodySchema.parse(request.body);
    const existing = await app.prisma.projectIntegration.findUnique({
      where: { projectId_provider: { projectId: project.id, provider: body.provider } },
    });
    if (!body.secret && !existing?.secretCiphertext) {
      throw new HttpError(400, body.provider === 'slack' || body.provider === 'webhook' ? 'Add the webhook URL' : 'Add the access token');
    }
    const secretCiphertext = body.secret ? await app.secrets.encrypt(body.secret) : existing!.secretCiphertext;
    const row = await app.prisma.projectIntegration.upsert({
      where: { projectId_provider: { projectId: project.id, provider: body.provider } },
      create: {
        organizationId: project.organizationId,
        projectId: project.id,
        provider: body.provider,
        config: body.config,
        secretCiphertext,
      },
      update: { config: body.config, secretCiphertext },
    });
    await writeAuditLog(app.prisma, request, {
      action: 'integration.save',
      resourceType: 'ProjectIntegration',
      resourceId: row.id,
      organizationId: project.organizationId,
      metadata: { provider: body.provider },
    });
    return integrationView(app, row);
  });

  app.delete('/projects/:id/integrations/:provider', async (request, reply) => {
    const params = z.object({ id: z.string().min(1), provider: integrationProviderSchema }).parse(request.params);
    const { project } = await requireProjectAccess(request, params.id, 'ADMIN');
    await app.prisma.projectIntegration.deleteMany({ where: { projectId: project.id, provider: params.provider } });
    await writeAuditLog(app.prisma, request, {
      action: 'integration.delete',
      resourceType: 'ProjectIntegration',
      resourceId: `${project.id}:${params.provider}`,
      organizationId: project.organizationId,
    });
    return reply.status(204).send();
  });

  /** Sends a sample alert so people can see it arrive before the first real one. */
  app.post('/projects/:id/integrations/:provider/test', async (request) => {
    const params = z.object({ id: z.string().min(1), provider: z.enum(['slack', 'webhook']) }).parse(request.params);
    const { project } = await requireProjectAccess(request, params.id, 'ADMIN');
    const row = await app.prisma.projectIntegration.findUnique({
      where: { projectId_provider: { projectId: project.id, provider: params.provider } },
    });
    if (!row?.secretCiphertext) throw new HttpError(404, 'Save the webhook first');
    const target = await app.secrets.decrypt(row.secretCiphertext);
    const text = `Snaghunt is connected. Alerts for ${project.name} will arrive here.`;
    const body =
      params.provider === 'slack'
        ? { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: ${text}` } }] }
        : { event: 'test', subject: 'Snaghunt test alert', text, projectName: project.name };
    if (params.provider === 'webhook') {
      const { assertSafeNavigationTarget } = await import('@auditor/shared/ssrf');
      await assertSafeNavigationTarget(target, { allowPrivate: false }).catch((error: Error) => {
        throw new HttpError(400, error.message);
      });
    }
    const response = await send(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Snaghunt-Alerts/1.0' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) {
      throw new HttpError(502, `The webhook did not accept the test message${response ? ` (status ${response.status})` : ''}`);
    }
    return { ok: true };
  });

  /* ---------------------------------------------------------- bug tickets */

  app.post('/runs/:runId/findings/:findingId/ticket', async (request) => {
    const { runId, findingId } = findingParamsSchema.parse(request.params);
    const { provider } = z.object({ provider: z.enum(TICKET_PROVIDERS) }).parse(request.body ?? {});
    const finding = await findFinding(app, request, runId, findingId);
    if (finding.ticketUrl) {
      return { provider: finding.ticketProvider, url: finding.ticketUrl, existing: true };
    }
    const integration = await app.prisma.projectIntegration.findUnique({
      where: { projectId_provider: { projectId: finding.projectId, provider } },
    });
    if (!integration?.secretCiphertext) {
      throw new HttpError(400, `Connect ${PROVIDER_NAME[provider]} in project settings first`);
    }
    const token = await app.secrets.decrypt(integration.secretCiphertext);
    const links = {
      report: finding.run.shareToken ? `${webOrigin}/r/${finding.run.shareToken}#${finding.id}` : null,
      app: `${webOrigin}/runs/${runId}?finding=${finding.id}`,
    };
    const url = await createTicket(send, provider, integration.config as Record<string, unknown>, token, finding, links);
    await app.prisma.finding.update({
      where: { id: finding.id },
      data: { ticketProvider: provider, ticketUrl: url, status: finding.status === 'OPEN' ? 'CONFIRMED' : finding.status },
    });
    await writeAuditLog(app.prisma, request, {
      action: 'finding.ticket',
      resourceType: 'Finding',
      resourceId: finding.id,
      organizationId: finding.organizationId,
      metadata: { provider, url },
    });
    return { provider, url, existing: false };
  });

  /* ----------------------------------------------------------- share links */

  app.post('/runs/:runId/share', async (request) => {
    const { runId } = runIdParamsSchema.parse(request.params);
    const run = await findRun(app, request, runId, 'MEMBER');
    const token = run.shareToken ?? randomBytes(18).toString('base64url');
    const updated = await app.prisma.run.update({
      where: { id: run.id },
      data: { shareToken: token, sharedAt: run.sharedAt ?? new Date() },
    });
    await writeAuditLog(app.prisma, request, {
      action: 'run.share',
      resourceType: 'Run',
      resourceId: run.id,
      organizationId: run.organizationId,
    });
    return { token, url: `${webOrigin}/r/${token}`, sharedAt: updated.sharedAt };
  });

  app.delete('/runs/:runId/share', async (request, reply) => {
    const { runId } = runIdParamsSchema.parse(request.params);
    const run = await findRun(app, request, runId, 'MEMBER');
    await app.prisma.run.update({ where: { id: run.id }, data: { shareToken: null, sharedAt: null } });
    await writeAuditLog(app.prisma, request, {
      action: 'run.unshare',
      resourceType: 'Run',
      resourceId: run.id,
      organizationId: run.organizationId,
    });
    return reply.status(204).send();
  });

  /* -------------------------------------------------------------- branding */

  app.patch('/organizations/:id/branding', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    await requireOrgRole(request, id, 'ADMIN');
    const body = brandingBodySchema.parse(request.body ?? {});
    const clean = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null);
    const org = await app.prisma.organization.update({
      where: { id },
      data: {
        brandName: clean(body.brandName),
        brandLogoUrl: clean(body.brandLogoUrl),
        brandColor: clean(body.brandColor),
        brandFooter: clean(body.brandFooter),
      },
    });
    await writeAuditLog(app.prisma, request, {
      action: 'organization.branding',
      resourceType: 'Organization',
      resourceId: id,
      organizationId: id,
    });
    return brandView(org);
  });

  /* --------------------------------------------------------- public report */

  app.get('/public/reports/:token', async (request, reply) => {
    const run = await findSharedRun(app, request);
    const findings = await app.prisma.finding.findMany({
      where: {
        runId: run.id,
        suppressed: false,
        duplicateOfId: null,
        status: { notIn: ['DISMISSED', 'IGNORED'] },
      },
      include: {
        evidence: {
          where: { type: 'SCREENSHOT' },
          select: { id: true, fileName: true },
          orderBy: { createdAt: 'asc' },
          take: 6,
        },
      },
    });
    const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
    findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
    const report: PublicReport = {
      brand: brandView(run.organization),
      project: { name: run.project.name, baseUrl: run.baseUrlOverride ?? run.environment?.baseUrl ?? run.project.baseUrl },
      run: {
        status: run.status,
        device: run.device,
        qualityScore: run.qualityScore,
        pagesDiscovered: run.pagesDiscovered,
        testsGenerated: run.testsGenerated,
        testsPassed: run.testsPassed,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      },
      summary: run.report?.summary ?? null,
      findings: findings.map((item) => ({
        id: item.id,
        title: item.title,
        severity: item.severity,
        category: item.category,
        description: item.description,
        url: item.url,
        steps: findingSteps(item.steps),
        expected: item.expected,
        actual: item.actual,
        recommendation: item.recommendation,
        change: item.change,
        screenshots: item.evidence.map((evidence) => ({ id: evidence.id, caption: evidence.fileName ?? 'Screenshot' })),
      })),
    };
    return reply.header('cache-control', 'private, max-age=30').header('x-robots-tag', 'noindex').send(report);
  });

  app.get('/public/reports/:token/evidence/:evidenceId', async (request, reply) => {
    const run = await findSharedRun(app, request);
    const { evidenceId } = z.object({ evidenceId: z.string().min(1).max(64) }).parse(request.params);
    const evidence = await app.prisma.evidence.findFirst({
      where: {
        id: evidenceId,
        runId: run.id,
        type: 'SCREENSHOT',
        finding: { suppressed: false, status: { notIn: ['DISMISSED', 'IGNORED'] } },
      },
    });
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
}

/* ------------------------------------------------------------------ helpers */

const PROVIDER_NAME: Record<TicketProvider, string> = { github: 'GitHub', jira: 'Jira', linear: 'Linear' };

function monitoringView(project: {
  monitorCadence: string | null;
  monitorHourUtc: number;
  monitorWeekday: number;
  monitorEnvironmentId: string | null;
  monitorDevices: unknown;
  nextMonitorAt: Date | null;
  alertSettings: unknown;
}) {
  return {
    cadence: project.monitorCadence,
    hourUtc: project.monitorHourUtc,
    weekday: project.monitorWeekday,
    environmentId: project.monitorEnvironmentId,
    devices: Array.isArray(project.monitorDevices) ? project.monitorDevices : ['desktop'],
    nextRunAt: project.nextMonitorAt,
    alerts: project.alertSettings ?? {},
  };
}

function brandView(org: {
  name: string;
  brandName: string | null;
  brandLogoUrl: string | null;
  brandColor: string | null;
  brandFooter: string | null;
}) {
  return {
    name: org.brandName || org.name,
    logoUrl: org.brandLogoUrl,
    color: org.brandColor,
    footer: org.brandFooter,
  };
}

async function integrationView(
  app: FastifyInstance,
  row: { provider: string; config: unknown; secretCiphertext: string | null; updatedAt: Date },
): Promise<Integration> {
  let hint: string | null = null;
  if (row.secretCiphertext) {
    try {
      const secret = await app.secrets.decrypt(row.secretCiphertext);
      hint = `…${secret.slice(-4)}`;
    } catch {
      hint = null;
    }
  }
  return {
    provider: integrationProviderSchema.parse(row.provider),
    config: (row.config ?? {}) as Record<string, unknown>,
    hasSecret: Boolean(row.secretCiphertext),
    secretHint: hint,
    updatedAt: row.updatedAt,
  };
}

async function findRun(app: FastifyInstance, request: FastifyRequest, runId: string, minimum: 'MEMBER' | 'VIEWER') {
  const user = await requireAuth(request);
  const run = await app.prisma.run.findFirst({
    where: { id: runId, organizationId: { in: user.memberships.map((item) => item.organizationId) } },
  });
  if (!run) throw new HttpError(404, 'Run not found');
  await requireProjectAccess(request, run.projectId, minimum);
  return run;
}

async function findFinding(app: FastifyInstance, request: FastifyRequest, runId: string, findingId: string) {
  const run = await findRun(app, request, runId, 'MEMBER');
  const finding = await app.prisma.finding.findFirst({
    where: { id: findingId, runId: run.id },
    include: { run: { select: { shareToken: true } } },
  });
  if (!finding) throw new HttpError(404, 'Finding not found');
  return finding;
}

async function findSharedRun(app: FastifyInstance, request: FastifyRequest) {
  const { token } = z.object({ token: z.string().regex(/^[\w-]{16,64}$/) }).parse(request.params);
  const run = await app.prisma.run.findUnique({
    where: { shareToken: token },
    include: {
      organization: { select: { name: true, brandName: true, brandLogoUrl: true, brandColor: true, brandFooter: true } },
      project: { select: { name: true, baseUrl: true } },
      environment: { select: { baseUrl: true } },
      report: { select: { summary: true } },
    },
  });
  if (!run) throw new HttpError(404, 'This report link is no longer shared');
  return run;
}

/** Creates the issue and returns its URL. */
export async function createTicket(
  send: Fetch,
  provider: TicketProvider,
  config: Record<string, unknown>,
  token: string,
  finding: TicketFinding,
  links: { report?: string | null; app?: string | null },
): Promise<string> {
  const title = `[${finding.severity.charAt(0)}${finding.severity.slice(1).toLowerCase()}] ${finding.title}`.slice(0, 250);
  const body = ticketMarkdown(finding, links);
  const call = async (url: string, init: RequestInit) => {
    const response = await send(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!response) throw new HttpError(502, `Could not reach ${PROVIDER_NAME[provider]}`);
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const reason =
        (typeof json.message === 'string' && json.message) ||
        (Array.isArray(json.errorMessages) && json.errorMessages.join(' ')) ||
        (json.errors && JSON.stringify(json.errors).slice(0, 200)) ||
        `status ${response.status}`;
      throw new HttpError(502, `${PROVIDER_NAME[provider]} refused the ticket: ${reason}`);
    }
    return json;
  };

  if (provider === 'github') {
    const repo = String(config.repo ?? '')
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new HttpError(400, 'Set the GitHub repository first');
    const json = await call(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': 'Snaghunt',
      },
      body: JSON.stringify({ title, body, labels: Array.isArray(config.labels) ? config.labels : ['bug'] }),
    });
    return String(json.html_url);
  }

  if (provider === 'jira') {
    const site = String(config.site ?? '');
    if (!/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/i.test(site)) throw new HttpError(400, 'Set the Jira site first');
    const auth = Buffer.from(`${String(config.email)}:${token}`).toString('base64');
    const json = await call(`https://${site}/rest/api/3/issue`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: String(config.projectKey) },
          issuetype: { name: String(config.issueType ?? 'Bug') },
          summary: title,
          description: markdownToAdf(body),
        },
      }),
    });
    return `https://${site}/browse/${String(json.key)}`;
  }

  const json = await call('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({
      query:
        'mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { url identifier } } }',
      variables: { input: { teamId: String(config.teamId), title, description: body } },
    }),
  });
  const data = json.data as { issueCreate?: { issue?: { url?: string } } } | undefined;
  const url = data?.issueCreate?.issue?.url;
  if (!url) {
    const errors = Array.isArray(json.errors) ? (json.errors as { message?: string }[]).map((item) => item.message).join(' ') : '';
    throw new HttpError(502, `Linear refused the ticket${errors ? `: ${errors}` : ''}`);
  }
  return url;
}

/** Turns the ticket Markdown into Jira's document format: headings, numbered lists, paragraphs and links. */
export function markdownToAdf(markdown: string) {
  type Node = Record<string, unknown>;
  const content: Node[] = [];
  let list: Node | null = null;
  const inline = (text: string): Node[] => {
    const nodes: Node[] = [];
    const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|_([^_]+)_/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index! > last) nodes.push({ type: 'text', text: text.slice(last, match.index) });
      if (match[1]) nodes.push({ type: 'text', text: match[1], marks: [{ type: 'link', attrs: { href: match[2] } }] });
      else if (match[3]) nodes.push({ type: 'text', text: match[3], marks: [{ type: 'strong' }] });
      else if (match[4]) nodes.push({ type: 'text', text: match[4], marks: [{ type: 'em' }] });
      last = match.index! + match[0].length;
    }
    if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
    return nodes.length ? nodes : [{ type: 'text', text: ' ' }];
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      if (!list) {
        list = { type: 'orderedList', content: [] };
        content.push(list);
      }
      (list.content as Node[]).push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(numbered[1]!) }] });
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    if (line === '---') {
      content.push({ type: 'rule' });
    } else if (line.startsWith('### ')) {
      content.push({ type: 'heading', attrs: { level: 3 }, content: inline(line.slice(4)) });
    } else {
      content.push({ type: 'paragraph', content: inline(line) });
    }
  }
  return { type: 'doc', version: 1, content };
}
