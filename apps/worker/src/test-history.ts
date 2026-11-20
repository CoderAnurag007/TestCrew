import type { PrismaClient } from '@auditor/database';

/**
 * Per-project memory of how each generated test behaves across runs.
 *
 * A test is quarantined when it has been flaky at least twice and flakiness is
 * at least 20% of its runs. Quarantined tests still run and are still shown,
 * but their failures do not become findings. Quarantine lifts on its own once
 * clean passes bring the flake rate under the threshold.
 */
export const QUARANTINE_MIN_FLAKES = 2;
export const QUARANTINE_RATE = 0.2;

export function shouldQuarantine(stats: { passes: number; failures: number; flakes: number }): boolean {
  const total = stats.passes + stats.failures + stats.flakes;
  if (total === 0) return false;
  return stats.flakes >= QUARANTINE_MIN_FLAKES && stats.flakes / total >= QUARANTINE_RATE;
}

export async function loadHistory(prisma: PrismaClient, projectId: string, keys: string[]) {
  if (keys.length === 0) return new Map<string, { quarantined: boolean; passes: number; failures: number; flakes: number }>();
  const rows = await prisma.testHistory.findMany({ where: { projectId, testKey: { in: keys } } });
  return new Map(rows.map((row) => [row.testKey, row]));
}

export async function recordOutcome(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    projectId: string;
    testKey: string;
    name: string;
    outcome: 'PASSED' | 'FAILED' | 'FLAKY' | 'SKIPPED';
  },
): Promise<{ quarantined: boolean }> {
  if (input.outcome === 'SKIPPED') {
    const existing = await prisma.testHistory.findUnique({
      where: { projectId_testKey: { projectId: input.projectId, testKey: input.testKey } },
    });
    return { quarantined: existing?.quarantined ?? false };
  }
  const existing = await prisma.testHistory.findUnique({
    where: { projectId_testKey: { projectId: input.projectId, testKey: input.testKey } },
  });
  const stats = {
    passes: (existing?.passes ?? 0) + (input.outcome === 'PASSED' ? 1 : 0),
    failures: (existing?.failures ?? 0) + (input.outcome === 'FAILED' ? 1 : 0),
    flakes: (existing?.flakes ?? 0) + (input.outcome === 'FLAKY' ? 1 : 0),
  };
  const quarantined = shouldQuarantine(stats);
  await prisma.testHistory.upsert({
    where: { projectId_testKey: { projectId: input.projectId, testKey: input.testKey } },
    create: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      testKey: input.testKey,
      name: input.name.slice(0, 200),
      ...stats,
      quarantined,
      lastStatus: input.outcome,
    },
    update: { ...stats, quarantined, lastStatus: input.outcome, name: input.name.slice(0, 200) },
  });
  return { quarantined };
}
