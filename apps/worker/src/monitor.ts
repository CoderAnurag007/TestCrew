import {
  alertSettingsSchema,
  deviceSchema,
  findingSteps,
  isTerminalRunStatus,
  nextMonitorRun,
  severityAtLeast,
  START_AUDIT_JOB,
  type AlertSettings,
  type Device,
  type MonitorCadence,
  type RunStatus,
} from '@auditor/shared';
import { assertSafeNavigationTarget } from '@auditor/shared/ssrf';
import type { AuditDependencies } from './engine.js';
import { orgUsage } from './plan-usage.js';

/** Starts runs for monitored projects and sends alerts when runs finish. */

const TICK_MS = 60_000;
const ACTIVE_STATUSES: RunStatus[] = [
  'QUEUED',
  'INITIALIZING',
  'AUTHENTICATING',
  'DISCOVERING',
  'EXPLORING',
  'GENERATING_TESTS',
  'EXECUTING_TESTS',
  'ANALYZING',
  'FINALIZING',
] as RunStatus[];

export type AuditQueuePort = {
  add: (name: string, data: unknown, options?: Record<string, unknown>) => Promise<{ id?: string | null }>;
};

export function appUrl(path = ''): string {
  const origin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${origin}${path}`;
}

/** Starts every monitored project that is due. Returns how many runs were queued. */
export async function startDueMonitors(
  deps: Pick<AuditDependencies, 'prisma' | 'logger'>,
  queue: AuditQueuePort | null,
  now = new Date(),
): Promise<number> {
  const due = await deps.prisma.project.findMany({
    where: { monitorCadence: { not: null }, nextMonitorAt: { lte: now } },
    select: {
      id: true,
      name: true,
      organizationId: true,
      monitorCadence: true,
      monitorHourUtc: true,
      monitorWeekday: true,
      monitorEnvironmentId: true,
      monitorDevices: true,
      nextMonitorAt: true,
      designReview: true,
    },
    take: 50,
  });
  let queued = 0;
  for (const project of due) {
    const next = nextMonitorRun(
      project.monitorCadence as MonitorCadence,
      project.monitorHourUtc,
      project.monitorWeekday,
      now,
    );
    // Claim this slot first so two workers never start the same schedule twice.
    const claimed = await deps.prisma.project.updateMany({
      where: { id: project.id, nextMonitorAt: project.nextMonitorAt },
      data: { nextMonitorAt: next },
    });
    if (claimed.count === 0) continue;

    const busy = await deps.prisma.run.count({
      where: { projectId: project.id, status: { in: ACTIVE_STATUSES } },
    });
    if (busy > 0) {
      deps.logger.info({ projectId: project.id }, 'scheduled audit skipped: an audit is already running');
      continue;
    }

    // The plan may have changed since monitoring was set up.
    const usage = await orgUsage(deps.prisma, project.organizationId, now);
    if (!usage || !usage.limits.cadences.includes(project.monitorCadence as MonitorCadence)) {
      deps.logger.info({ projectId: project.id }, 'scheduled audit skipped: the plan no longer includes this schedule');
      continue;
    }
    const allowed = monitorDevices(project.monitorDevices).filter((device) => usage.limits.devices.includes(device));
    const room = usage.limits.auditsPerMonth == null ? Infinity : usage.limits.auditsPerMonth - usage.audits;
    const devices = allowed.slice(0, Math.max(0, room));
    if (!devices.length) {
      deps.logger.info({ projectId: project.id }, 'scheduled audit skipped: monthly audit limit reached');
      continue;
    }

    const owner = await deps.prisma.membership.findFirst({
      where: { organizationId: project.organizationId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: { userId: true },
    });
    if (!owner) continue;

    const environment = await deps.prisma.environment.findFirst({
      where: project.monitorEnvironmentId
        ? { id: project.monitorEnvironmentId, projectId: project.id }
        : { projectId: project.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    for (const device of devices) {
      const run = await deps.prisma.run.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          environmentId: environment?.id ?? null,
          status: 'QUEUED',
          createdById: owner.userId,
          trigger: 'schedule',
          device,
          designReview: project.designReview,
        },
      });
      await deps.prisma.runEvent.create({
        data: {
          organizationId: project.organizationId,
          runId: run.id,
          kind: 'stage',
          message: `Scheduled ${project.monitorCadence} audit queued.`,
        },
      });
      if (queue) {
        const job = await queue.add(
          START_AUDIT_JOB,
          { runId: run.id, organizationId: project.organizationId, projectId: project.id },
          { jobId: run.id, removeOnComplete: 100, removeOnFail: 100 },
        );
        await deps.prisma.run.update({ where: { id: run.id }, data: { queueJobId: job.id ?? run.id } });
      }
      queued += 1;
    }
    deps.logger.info({ projectId: project.id, next }, 'scheduled audit queued');
  }
  return queued;
}

export function monitorDevices(value: unknown): Device[] {
  const list = Array.isArray(value) ? value : [];
  const devices = list.map((item) => deviceSchema.safeParse(item)).filter((item) => item.success).map((item) => item.data);
  return devices.length ? [...new Set(devices)] : ['desktop'];
}

/** Deletes security log entries older than 12 months. */
export async function pruneOldAuditLogs(deps: Pick<AuditDependencies, 'prisma'>, now = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const result = await deps.prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}

export function startMonitorLoop(
  deps: AuditDependencies,
  queue: AuditQueuePort | null,
): () => void {
  let lastPrune = 0;
  const tick = () => {
    startDueMonitors(deps, queue).catch((error) => deps.logger.error({ err: error }, 'monitor tick failed'));
    // Once a day: security logs are kept for 12 months (see the Privacy Policy).
    if (Date.now() - lastPrune > 24 * 60 * 60 * 1000) {
      lastPrune = Date.now();
      pruneOldAuditLogs(deps).catch((error) => deps.logger.warn({ err: error }, 'could not prune old audit logs'));
    }
  };
  tick();
  const timer = setInterval(tick, TICK_MS);
  return () => clearInterval(timer);
}

/* ------------------------------------------------------------------ alerts */

export type AlertFinding = {
  title: string;
  severity: string;
  change: string;
  url: string | null;
  description: string;
  steps: string[];
};

export type AlertMessage = {
  kind: 'bugs' | 'failed';
  projectName: string;
  siteUrl: string;
  runUrl: string;
  device: string;
  score: number | null;
  findings: AlertFinding[];
  error?: string | null;
};

export function alertSubject(message: AlertMessage): string {
  if (message.kind === 'failed') return `Snaghunt: the audit of ${message.projectName} could not finish`;
  const fresh = message.findings.filter((item) => item.change === 'NEW').length;
  const back = message.findings.length - fresh;
  const parts = [fresh ? `${fresh} new ${fresh === 1 ? 'bug' : 'bugs'}` : null, back ? `${back} came back` : null].filter(Boolean);
  return `Snaghunt: ${parts.join(', ')} on ${message.projectName}`;
}

export function alertText(message: AlertMessage): string {
  const lines = [alertSubject(message), `${message.siteUrl}${message.device !== 'desktop' ? ` (${message.device})` : ''}`];
  if (message.kind === 'failed') {
    lines.push('', message.error ? `Reason: ${message.error}` : 'The audit stopped before it finished.');
  } else {
    if (message.score != null) lines.push(`Score: ${Math.round(message.score)}/100`);
    lines.push('');
    for (const finding of message.findings.slice(0, 8)) {
      const tag = finding.change === 'REGRESSED' ? ' (came back)' : '';
      lines.push(`• [${label(finding.severity)}] ${finding.title}${tag}${finding.url ? ` — ${finding.url}` : ''}`);
    }
    if (message.findings.length > 8) lines.push(`…and ${message.findings.length - 8} more`);
  }
  lines.push('', `Open the report: ${message.runUrl}`);
  return lines.join('\n');
}

function label(severity: string): string {
  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function slackPayload(message: AlertMessage): Record<string, unknown> {
  const blocks: Record<string, unknown>[] = [
    { type: 'header', text: { type: 'plain_text', text: alertSubject(message).replace(/^Snaghunt: /, '').slice(0, 150) } },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [
            escapeSlack(message.siteUrl),
            message.device !== 'desktop' ? escapeSlack(message.device) : null,
            message.score != null && message.kind === 'bugs' ? `Score ${Math.round(message.score)}/100` : null,
          ]
            .filter(Boolean)
            .join('  ·  '),
        },
      ],
    },
  ];
  if (message.kind === 'failed') {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: escapeSlack(message.error ?? 'The audit stopped before it finished.').slice(0, 2900) },
    });
  } else {
    for (const finding of message.findings.slice(0, 6)) {
      const head = `*${escapeSlack(finding.title)}*  \`${label(finding.severity)}\`${finding.change === 'REGRESSED' ? '  _came back_' : ''}`;
      const where = finding.url ? `\n${escapeSlack(finding.url)}` : '';
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${head}${where}\n${escapeSlack(firstSentence(finding.description))}`.slice(0, 2900) } });
    }
    if (message.findings.length > 6) {
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `…and ${message.findings.length - 6} more` }] });
    }
  }
  blocks.push({
    type: 'actions',
    elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open the report' }, url: message.runUrl }],
  });
  return { text: alertSubject(message), blocks };
}

function firstSentence(text: string): string {
  const match = /^(.{20,240}?[.!?])(\s|$)/.exec(text.trim());
  return match ? match[1]! : text.trim().slice(0, 240);
}

export function alertHtml(message: AlertMessage): string {
  const esc = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const rows =
    message.kind === 'failed'
      ? `<p style="margin:0 0 16px">${esc(message.error ?? 'The audit stopped before it finished.')}</p>`
      : message.findings
          .slice(0, 10)
          .map(
            (finding) => `<tr><td style="padding:12px 0;border-top:1px solid #e6e7ea">
  <div style="font:600 15px/1.4 system-ui,sans-serif;color:#111">${esc(finding.title)}</div>
  <div style="font:13px/1.5 system-ui,sans-serif;color:#555;margin-top:2px">${esc(label(finding.severity))}${finding.change === 'REGRESSED' ? ' · came back' : ''}${finding.url ? ` · ${esc(finding.url)}` : ''}</div>
  <div style="font:14px/1.55 system-ui,sans-serif;color:#222;margin-top:6px">${esc(firstSentence(finding.description))}</div>
</td></tr>`,
          )
          .join('');
  return `<!doctype html><html><body style="margin:0;background:#f6f6f7;padding:24px">
<table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e6e7ea;border-radius:10px;padding:24px">
<tr><td>
  <div style="font:600 18px/1.3 system-ui,sans-serif;color:#111">${esc(alertSubject(message).replace(/^Snaghunt: /, ''))}</div>
  <div style="font:13px/1.5 system-ui,sans-serif;color:#666;margin:4px 0 16px">${esc(message.siteUrl)}${message.score != null && message.kind === 'bugs' ? ` · Score ${Math.round(message.score)}/100` : ''}</div>
  <table role="presentation" width="100%">${message.kind === 'failed' ? `<tr><td>${rows}</td></tr>` : rows}</table>
  <a href="${esc(message.runUrl)}" style="display:inline-block;margin-top:16px;background:#111;color:#fff;text-decoration:none;font:600 14px system-ui,sans-serif;padding:10px 16px;border-radius:6px">Open the report</a>
  <div style="font:12px/1.5 system-ui,sans-serif;color:#888;margin-top:20px">Sent by Snaghunt because alerts are on for this project.</div>
</td></tr></table></body></html>`;
}

/** Builds the alert for a finished run, or null when nothing should be sent. */
export async function buildRunAlert(
  deps: Pick<AuditDependencies, 'prisma'>,
  runId: string,
): Promise<{ message: AlertMessage; settings: AlertSettings; projectId: string; organizationId: string } | null> {
  const run = await deps.prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      trigger: true,
      device: true,
      errorMessage: true,
      qualityScore: true,
      alertsSentAt: true,
      baseUrlOverride: true,
      projectId: true,
      organizationId: true,
      environment: { select: { baseUrl: true } },
      project: { select: { name: true, baseUrl: true, alertSettings: true } },
    },
  });
  if (!run || run.alertsSentAt || !isTerminalRunStatus(run.status as RunStatus)) return null;
  const parsed = alertSettingsSchema.safeParse(run.project.alertSettings ?? {});
  const settings = parsed.success ? parsed.data : alertSettingsSchema.parse({});
  if (settings.scheduledOnly && run.trigger !== 'schedule') return null;

  const base = {
    projectName: run.project.name,
    siteUrl: run.baseUrlOverride ?? run.environment?.baseUrl ?? run.project.baseUrl,
    runUrl: appUrl(`/runs/${run.id}`),
    device: run.device,
    score: run.qualityScore,
  };
  if (run.status === 'FAILED') {
    if (!settings.onFailure) return null;
    return {
      message: { ...base, kind: 'failed', findings: [], error: run.errorMessage },
      settings,
      projectId: run.projectId,
      organizationId: run.organizationId,
    };
  }
  if (run.status !== 'COMPLETED') return null;

  const findings = await deps.prisma.finding.findMany({
    where: {
      runId,
      suppressed: false,
      duplicateOfId: null,
      change: { in: ['NEW', 'REGRESSED'] },
      status: { notIn: ['DISMISSED', 'IGNORED', 'RESOLVED'] },
    },
    select: { title: true, severity: true, change: true, url: true, description: true, steps: true },
  });
  const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  const worth = findings
    .filter((item) => severityAtLeast(item.severity, settings.minSeverity))
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
    .map((item) => ({ ...item, steps: findingSteps(item.steps) }));
  if (!worth.length) return null;
  return {
    message: { ...base, kind: 'bugs', findings: worth },
    settings,
    projectId: run.projectId,
    organizationId: run.organizationId,
  };
}

type Sender = (url: string, init: RequestInit) => Promise<Response>;

/** Sends the alert for a finished run to Slack, a webhook and email. Never throws. */
export async function sendRunAlerts(
  deps: Pick<AuditDependencies, 'prisma' | 'secrets' | 'logger'>,
  runId: string,
  send: Sender = fetch,
): Promise<string[]> {
  const sent: string[] = [];
  try {
    const alert = await buildRunAlert(deps, runId);
    if (!alert) return sent;
    const { message, settings } = alert;
    // Mark first, so a crash halfway never sends the same alert twice.
    const claimed = await deps.prisma.run.updateMany({
      where: { id: runId, alertsSentAt: null },
      data: { alertsSentAt: new Date() },
    });
    if (claimed.count === 0) return sent;

    const channels = await deps.prisma.projectIntegration.findMany({
      where: { projectId: alert.projectId, provider: { in: ['slack', 'webhook'] } },
    });
    for (const channel of channels) {
      if (!channel.secretCiphertext) continue;
      try {
        const target = await deps.secrets.decrypt(channel.secretCiphertext);
        if (channel.provider === 'slack') {
          if (!/^https:\/\/hooks\.slack\.com\/services\//.test(target)) throw new Error('Not a Slack webhook URL');
          await postJson(send, target, slackPayload(message));
        } else {
          await assertSafeNavigationTarget(target, { allowPrivate: false });
          await postJson(send, target, {
            event: message.kind === 'failed' ? 'audit.failed' : 'audit.new_bugs',
            subject: alertSubject(message),
            text: alertText(message),
            ...message,
          });
        }
        sent.push(channel.provider);
      } catch (error) {
        deps.logger.warn({ runId, provider: channel.provider, err: error }, 'alert channel failed');
      }
    }

    if (settings.emails.length) {
      try {
        if (await sendEmail(settings.emails, alertSubject(message), alertText(message), alertHtml(message))) {
          sent.push('email');
        }
      } catch (error) {
        deps.logger.warn({ runId, err: error }, 'alert email failed');
      }
    }
    await deps.prisma.runEvent
      .create({
        data: {
          organizationId: alert.organizationId,
          runId,
          kind: 'stage',
          message: sent.length ? `Alert sent to ${sent.join(', ')}.` : 'Alert ready, but no alert channel is set up.',
        },
      })
      .catch(() => undefined);
  } catch (error) {
    deps.logger.warn({ runId, err: error }, 'alerts failed');
  }
  return sent;
}

async function postJson(send: Sender, url: string, body: unknown): Promise<void> {
  const response = await send(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Snaghunt-Alerts/1.0' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Alert endpoint answered ${response.status}`);
}

/** Sends mail through SMTP_URL (e.g. smtps://user:pass@smtp.example.com). Returns false when not set up. */
async function sendEmail(to: string[], subject: string, text: string, html: string): Promise<boolean> {
  const smtp = process.env.SMTP_URL;
  if (!smtp) return false;
  const { createTransport } = await import('nodemailer');
  const transport = createTransport(smtp);
  await transport.sendMail({
    from: process.env.ALERT_FROM ?? 'Snaghunt <alerts@snaghunt.local>',
    to: to.join(', '),
    subject,
    text,
    html,
  });
  return true;
}
