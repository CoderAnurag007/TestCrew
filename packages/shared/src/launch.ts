import { z } from 'zod';
import { findingSeveritySchema } from './enums.js';

/* ------------------------------------------------------------------ devices */

/** Browser + screen an audit runs with. */
export const deviceSchema = z.enum(['desktop', 'phone', 'safari', 'iphone']);
export type Device = z.infer<typeof deviceSchema>;

export const DEVICES: Record<Device, { label: string; engine: 'chromium' | 'webkit'; mobile: boolean }> = {
  desktop: { label: 'Desktop Chrome', engine: 'chromium', mobile: false },
  phone: { label: 'Android phone (Chrome)', engine: 'chromium', mobile: true },
  safari: { label: 'Desktop Safari', engine: 'webkit', mobile: false },
  iphone: { label: 'iPhone (Safari)', engine: 'webkit', mobile: true },
};

/* --------------------------------------------------------------- monitoring */

export const monitorCadenceSchema = z.enum(['hourly', 'daily', 'weekly']);
export type MonitorCadence = z.infer<typeof monitorCadenceSchema>;

export const alertSettingsSchema = z.object({
  /** People emailed when a run finds new or returning bugs. */
  emails: z.array(z.string().email().max(320)).max(10).default([]),
  /** Only bugs at or above this severity trigger an alert. */
  minSeverity: findingSeveritySchema.default('MEDIUM'),
  /** Also alert when an audit cannot finish (site down, blocked, crashed). */
  onFailure: z.boolean().default(true),
  /** Alert for scheduled runs only, not runs started by hand. */
  scheduledOnly: z.boolean().default(false),
});
export type AlertSettings = z.infer<typeof alertSettingsSchema>;

export const monitoringBodySchema = z.object({
  cadence: monitorCadenceSchema.nullable(),
  hourUtc: z.number().int().min(0).max(23).default(6),
  /** 0 = Sunday … 6 = Saturday; used by weekly runs. */
  weekday: z.number().int().min(0).max(6).default(1),
  environmentId: z.string().min(1).nullable().default(null),
  devices: z.array(deviceSchema).min(1).max(4).default(['desktop']),
  alerts: alertSettingsSchema.prefault({}),
});
export type MonitoringBody = z.infer<typeof monitoringBodySchema>;

/** The next time a monitored project is due, strictly after `from`. */
export function nextMonitorRun(
  cadence: MonitorCadence | null | undefined,
  hourUtc: number,
  weekday: number,
  from: Date = new Date(),
): Date | null {
  if (!cadence) return null;
  const next = new Date(from.getTime());
  next.setUTCSeconds(0, 0);
  if (cadence === 'hourly') {
    next.setUTCMinutes(0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }
  next.setUTCMinutes(0);
  next.setUTCHours(hourUtc);
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  if (cadence === 'weekly') {
    while (next.getUTCDay() !== weekday) next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

const SEVERITY_RANK: Record<string, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export function severityAtLeast(severity: string, minimum: string): boolean {
  return (SEVERITY_RANK[severity] ?? 0) >= (SEVERITY_RANK[minimum] ?? 0);
}

/* ------------------------------------------------------------- integrations */

export const integrationProviderSchema = z.enum(['slack', 'webhook', 'github', 'jira', 'linear']);
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;
export const TICKET_PROVIDERS = ['github', 'jira', 'linear'] as const;
export type TicketProvider = (typeof TICKET_PROVIDERS)[number];

const httpsUrl = z
  .string()
  .url()
  .max(2000)
  .refine((value) => value.startsWith('https://'), 'Must start with https://');

/** Body for saving one integration. `secret` may be omitted to keep the saved one. */
export const integrationBodySchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('slack'),
    config: z.object({}).default({}),
    secret: httpsUrl
      .refine((value) => /^https:\/\/hooks\.slack\.com\/services\//.test(value), 'Use a Slack incoming-webhook URL')
      .optional(),
  }),
  z.object({
    provider: z.literal('webhook'),
    config: z.object({}).default({}),
    secret: httpsUrl.optional(),
  }),
  z.object({
    provider: z.literal('github'),
    config: z.object({
      repo: z
        .string()
        .trim()
        // Accept pasted forms like https://github.com/owner/repo.git and keep "owner/repo".
        .transform((value) => value.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, ''))
        .pipe(z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Use owner/repository')),
      labels: z.array(z.string().min(1).max(50)).max(10).default(['bug']),
    }),
    secret: z.string().min(10).max(500).optional(),
  }),
  z.object({
    provider: z.literal('jira'),
    config: z.object({
      site: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/i, 'Use your-team.atlassian.net'),
      email: z.string().email(),
      projectKey: z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/, 'Use the project key, e.g. WEB'),
      issueType: z.string().min(1).max(40).default('Bug'),
    }),
    secret: z.string().min(10).max(500).optional(),
  }),
  z.object({
    provider: z.literal('linear'),
    config: z.object({ teamId: z.string().min(1).max(80) }),
    secret: z.string().min(10).max(500).optional(),
  }),
]);
export type IntegrationBody = z.infer<typeof integrationBodySchema>;

export const integrationSchema = z.object({
  provider: integrationProviderSchema,
  config: z.record(z.string(), z.unknown()),
  hasSecret: z.boolean(),
  /** The last few characters of the token or URL, so people can tell which one is saved. */
  secretHint: z.string().nullable(),
  updatedAt: z.coerce.date(),
});
export type Integration = z.infer<typeof integrationSchema>;

/* ----------------------------------------------------------------- branding */

export const brandingBodySchema = z.object({
  brandName: z.string().trim().max(80).nullable().optional(),
  brandLogoUrl: httpsUrl.nullable().optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour like #1F6FEB')
    .nullable()
    .optional(),
  brandFooter: z.string().trim().max(200).nullable().optional(),
});
export type BrandingBody = z.infer<typeof brandingBodySchema>;

/* ------------------------------------------------------------- bug tickets */

export type TicketFinding = {
  title: string;
  severity: string;
  description: string;
  url?: string | null;
  steps?: unknown;
  expected?: string | null;
  actual?: string | null;
  recommendation?: string | null;
  rootCauseHypothesis?: string | null;
};

export function findingSteps(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((step) => (typeof step === 'string' ? step : step && typeof step === 'object' && 'description' in step ? String((step as { description: unknown }).description) : ''))
    .map((step) => step.trim())
    .filter(Boolean);
}

/** A bug report as Markdown, for GitHub and Linear issues and chat alerts. */
export function ticketMarkdown(finding: TicketFinding, links: { report?: string | null; app?: string | null } = {}): string {
  const lines: string[] = [];
  lines.push(`**Severity:** ${finding.severity.charAt(0)}${finding.severity.slice(1).toLowerCase()}`);
  if (finding.url) lines.push(`**Page:** ${finding.url}`);
  lines.push('', '### What’s wrong', finding.description.trim());
  const steps = findingSteps(finding.steps);
  if (steps.length) {
    lines.push('', '### How to reproduce', ...steps.map((step, index) => `${index + 1}. ${step}`));
  }
  if (finding.expected) lines.push('', '### What should happen', finding.expected);
  if (finding.actual) lines.push('', '### What actually happened', finding.actual);
  if (finding.recommendation || finding.rootCauseHypothesis) {
    lines.push('', '### How to fix');
    if (finding.recommendation) lines.push(finding.recommendation);
    if (finding.rootCauseHypothesis) lines.push('', `Likely cause: ${finding.rootCauseHypothesis}`);
  }
  const footer = [
    links.report ? `[Screenshots and evidence](${links.report})` : null,
    links.app ? `[Open in Snaghunt](${links.app})` : null,
  ].filter(Boolean);
  if (footer.length) lines.push('', '---', `${footer.join(' · ')}`);
  lines.push('', '_Found by Snaghunt._');
  return lines.join('\n');
}

/* ------------------------------------------------------------- public report */

export const publicReportSchema = z.object({
  brand: z.object({
    name: z.string(),
    logoUrl: z.string().nullable(),
    color: z.string().nullable(),
    footer: z.string().nullable(),
  }),
  /** Show the "Checked by Snaghunt" footer and free-check link (hidden on white-label plans). */
  poweredBy: z.boolean().optional(),
  project: z.object({ name: z.string(), baseUrl: z.string() }),
  run: z.object({
    status: z.string(),
    device: z.string(),
    qualityScore: z.number().nullable(),
    pagesDiscovered: z.number(),
    testsGenerated: z.number(),
    testsPassed: z.number(),
    startedAt: z.coerce.date().nullable(),
    completedAt: z.coerce.date().nullable(),
    /** False for a design-only review. */
    bugAudit: z.boolean().optional(),
    designScore: z.number().nullable().optional(),
  }),
  summary: z.string().nullable(),
  /** The design review (see DesignReport), when the run had one. */
  design: z.unknown().nullable().optional(),
  findings: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: z.string(),
      category: z.string(),
      description: z.string(),
      url: z.string().nullable(),
      steps: z.array(z.string()),
      expected: z.string().nullable(),
      actual: z.string().nullable(),
      recommendation: z.string().nullable(),
      change: z.string(),
      component: z.string().nullable().optional(),
      confidence: z.number().optional(),
      screenshots: z.array(z.object({ id: z.string(), caption: z.string() })),
    }),
  ),
});
export type PublicReport = z.infer<typeof publicReportSchema>;
