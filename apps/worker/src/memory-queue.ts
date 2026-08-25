import type { AuditJobData } from '@auditor/shared';
import { executeAuditRun, type AuditDependencies, type AuditLogger } from './engine.js';

const POLL_MS = 1_000;

export async function processQueuedAuditsFromDatabase(
  deps: AuditDependencies,
  logger: AuditLogger,
): Promise<never> {
  const wired: AuditDependencies = {
    ...deps,
    explorationQueue: {
      add: async () => undefined,
    },
  };

  logger.warn({}, 'REDIS_URL is in-memory; processing queued audits from the database');

  for (;;) {
    const run = await deps.prisma.run.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, organizationId: true, projectId: true },
    });

    if (!run) {
      await sleep(POLL_MS);
      continue;
    }

    const job: AuditJobData = {
      runId: run.id,
      organizationId: run.organizationId,
      projectId: run.projectId,
    };
    logger.info({ runId: run.id }, 'processing queued audit without Redis');
    try {
      await executeAuditRun(wired, job);
    } catch (error) {
      logger.error({ err: error, runId: run.id }, 'queued audit failed');
      await deps.prisma.run
        .updateMany({
          where: { id: run.id, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
          data: {
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : 'Audit failed',
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
