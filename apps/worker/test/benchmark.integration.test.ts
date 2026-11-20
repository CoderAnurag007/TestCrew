import { resolve } from 'node:path';
import { config } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '@auditor/config';
import { createPrismaClient } from '@auditor/database';
import { runBenchmark } from '../src/benchmark.js';

config({ path: resolve(import.meta.dirname, '../../../.env') });
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(import.meta.dirname, '../../../.playwright');

/**
 * Regression gate for the engine: a full audit of the fixture app, whose bugs
 * are known, must keep catching every bug reachable without AI and must not
 * start reporting things that are not bugs.
 */
describe('fixture benchmark', () => {
  it('catches every planted bug reachable without AI, with no false positives (FULL mode)', async () => {
    const env = loadWorkerEnv(process.env);
    const prisma = createPrismaClient(env.DATABASE_URL);
    try {
      const result = await runBenchmark({ prisma, secretsKeyHex: env.CREDENTIAL_ENCRYPTION_KEY, mode: 'FULL' });
      expect(result.runStatus).toBe('COMPLETED');
      expect(result.benchmark.missed.filter((id) => !id.startsWith('B9'))).toEqual([]);
      expect(result.reachableRecall).toBe(1);
      expect(result.benchmark.falsePositives).toEqual([]);
    } finally {
      await prisma.$disconnect();
    }
  }, 600_000);

  it('changes nothing in the app in READ_ONLY mode except the login, and still finds the browse-only bugs', async () => {
    const env = loadWorkerEnv(process.env);
    const prisma = createPrismaClient(env.DATABASE_URL);
    try {
      const result = await runBenchmark({ prisma, secretsKeyHex: env.CREDENTIAL_ENCRYPTION_KEY, mode: 'READ_ONLY' });
      expect(result.runStatus).toBe('COMPLETED');
      expect(result.fixtureMutations.every((item) => item.method === 'POST' && item.path === '/login')).toBe(true);
      expect(result.benchmark.recallByNeed.readonly.detected).toBe(result.benchmark.recallByNeed.readonly.total);
      expect(result.benchmark.falsePositives).toEqual([]);
    } finally {
      await prisma.$disconnect();
    }
  }, 600_000);
});
