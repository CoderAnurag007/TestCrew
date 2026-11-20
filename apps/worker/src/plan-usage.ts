import { limitsFor, monthStart, planIdSchema, type PlanLimits } from '@auditor/shared';
import type { PrismaClient } from '@auditor/database';

export type OrgUsage = { limits: PlanLimits; audits: number; aiSpendUsd: number };

/** The workspace's current plan limits and this month's audits and AI spend. */
export async function orgUsage(prisma: PrismaClient, organizationId: string, now = new Date()): Promise<OrgUsage | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, trialEndsAt: true, extraSites: true },
  });
  if (!org) return null;
  const parsed = planIdSchema.safeParse(org.plan);
  const periodStart = monthStart(now);
  const [audits, ai] = await Promise.all([
    prisma.run.count({ where: { organizationId, createdAt: { gte: periodStart }, status: { not: 'CANCELLED' } } }),
    prisma.aiUsage.aggregate({ where: { organizationId, createdAt: { gte: periodStart } }, _sum: { estimatedCostUsd: true } }),
  ]);
  return {
    limits: limitsFor({ plan: parsed.success ? parsed.data : 'FREE', trialEndsAt: org.trialEndsAt, extraSites: org.extraSites }, now),
    audits,
    aiSpendUsd: ai._sum.estimatedCostUsd ?? 0,
  };
}
