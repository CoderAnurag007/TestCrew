import type { FastifyInstance } from 'fastify';

/**
 * Removes the stored files (screenshots, videos, reports) of deleted runs.
 * Runs after the database rows are gone; a failure is logged, never thrown,
 * so a deletion the user asked for always completes.
 */
export async function purgeRunFiles(app: FastifyInstance, runIds: string[]): Promise<void> {
  if (!app.storage.deletePrefix) return;
  for (const runId of runIds) {
    if (!/^[a-z0-9]+$/i.test(runId)) continue;
    await app.storage.deletePrefix(`runs/${runId}/`).catch((error: unknown) => {
      app.log.warn({ err: error, runId }, 'could not delete the files of a deleted run');
    });
  }
}
