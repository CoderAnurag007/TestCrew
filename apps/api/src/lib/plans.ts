import {
  cheapestPlanWith,
  effectivePlan,
  limitsFor,
  monthStart,
  planIdSchema,
  PLANS,
  type PlanLimitCode,
  type PlanLimits,
  type Usage,
} from '@auditor/shared';
import type { PrismaClient } from '@auditor/database';
import { HttpError } from './http-error.js';

/** HTTP 402 with a code the app uses to show the right upgrade prompt. */
export class PlanLimitError extends HttpError {
  constructor(
    readonly code: PlanLimitCode,
    message: string,
  ) {
    super(402, message, 'Payment Required');
  }
}

export async function getUsage(prisma: PrismaClient, organizationId: string, now = new Date()): Promise<Usage> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, trialEndsAt: true, extraSites: true },
  });
  if (!org) throw new HttpError(404, 'Organization not found');
  const parsed = planIdSchema.safeParse(org.plan);
  const state = { plan: parsed.success ? parsed.data : 'FREE', trialEndsAt: org.trialEndsAt, extraSites: org.extraSites } as const;
  const periodStart = monthStart(now);
  const [sites, audits, ai] = await Promise.all([
    prisma.project.count({ where: { organizationId } }),
    prisma.run.count({ where: { organizationId, createdAt: { gte: periodStart }, status: { not: 'CANCELLED' } } }),
    prisma.aiUsage.aggregate({ where: { organizationId, createdAt: { gte: periodStart } }, _sum: { estimatedCostUsd: true } }),
  ]);
  return {
    plan: state.plan,
    effectivePlan: effectivePlan(state, now),
    trialEndsAt: org.trialEndsAt,
    limits: limitsFor(state, now),
    periodStart,
    sites,
    audits,
    aiSpendUsd: Number((ai._sum.estimatedCostUsd ?? 0).toFixed(4)),
  };
}

function upgradeHint(test: (limits: PlanLimits) => boolean): string {
  const plan = cheapestPlanWith(test);
  return plan ? ` Upgrade to ${plan.name} ($${plan.priceUsd}/month) to unlock it.` : '';
}

export function assertCanAddSite(usage: Usage): void {
  if (usage.sites >= usage.limits.sites) {
    throw new PlanLimitError(
      'sites',
      `Your ${PLANS[usage.effectivePlan].name} plan includes ${usage.limits.sites} site${usage.limits.sites === 1 ? '' : 's'}.` +
        upgradeHint((limits) => limits.sites > usage.limits.sites),
    );
  }
}

export function assertCanAudit(usage: Usage, device = 'desktop'): void {
  if (usage.limits.auditsPerMonth != null && usage.audits >= usage.limits.auditsPerMonth) {
    throw new PlanLimitError(
      'audits',
      `You've used all ${usage.limits.auditsPerMonth} audits this month on the ${PLANS[usage.effectivePlan].name} plan.` +
        upgradeHint((limits) => limits.auditsPerMonth == null || limits.auditsPerMonth > (usage.limits.auditsPerMonth ?? 0)),
    );
  }
  assertDevices(usage, [device]);
}

export function assertDevices(usage: Usage, devices: string[]): void {
  const blocked = devices.filter((device) => !usage.limits.devices.includes(device as never));
  if (blocked.length) {
    throw new PlanLimitError(
      'device',
      `${blocked.map(deviceName).join(' and ')} ${blocked.length === 1 ? 'is' : 'are'} not in your ${PLANS[usage.effectivePlan].name} plan.` +
        upgradeHint((limits) => blocked.every((device) => limits.devices.includes(device as never))),
    );
  }
}

export function assertCadence(usage: Usage, cadence: string | null): void {
  if (cadence && !usage.limits.cadences.includes(cadence as never)) {
    throw new PlanLimitError(
      'cadence',
      `${cadence.charAt(0).toUpperCase()}${cadence.slice(1)} audits are not in your ${PLANS[usage.effectivePlan].name} plan.` +
        upgradeHint((limits) => limits.cadences.includes(cadence as never)),
    );
  }
}

export function assertFeature(usage: Usage, feature: 'tickets' | 'alerts' | 'branding'): void {
  if (!usage.limits[feature]) {
    const label = { tickets: 'Bug tickets', alerts: 'Alerts', branding: 'Your own branding on reports' }[feature];
    throw new PlanLimitError(feature, `${label} ${feature === 'alerts' || feature === 'tickets' ? 'are' : 'is'} not in your ${PLANS[usage.effectivePlan].name} plan.` + upgradeHint((limits) => limits[feature]));
  }
}

function deviceName(device: string): string {
  return { desktop: 'Desktop Chrome', phone: 'Android phone', safari: 'Desktop Safari', iphone: 'iPhone' }[device] ?? device;
}
