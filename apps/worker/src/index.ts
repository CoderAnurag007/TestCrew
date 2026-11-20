import './register-playwright-path.js';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createModelRouter, ExplorerAgent } from '@auditor/ai';
import { createObjectStorage } from '@auditor/analyzer';
import { loadWorkerEnv } from '@auditor/config';
import { createPrismaClient, LocalAesGcmSecretStore } from '@auditor/database';
import { createErrorReporter, createLogger } from '@auditor/logger';
import {
  AUDIT_QUEUE_NAME,
  EXPLORATION_QUEUE_NAME,
  START_AUDIT_JOB,
  type AuditJobData,
} from '@auditor/shared';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { type AuditDependencies } from './engine.js';
import { processQueuedAuditsFromDatabase } from './memory-queue.js';
import { sendRunAlerts, startMonitorLoop } from './monitor.js';
import { handleAuditJob, handleExplorationJob } from './processors/jobs.js';

config({ path: resolve(import.meta.dirname, '../../../.env') });
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(import.meta.dirname, '../../../.playwright');

const env = loadWorkerEnv();
const logger = createLogger({ name: 'worker', level: env.LOG_LEVEL });
const reporter = createErrorReporter(logger, env.SENTRY_DSN);
const prisma = createPrismaClient(env.DATABASE_URL);
const secrets = LocalAesGcmSecretStore.fromHexKey(env.CREDENTIAL_ENCRYPTION_KEY);
const storage = createObjectStorage({
  artifactDir: env.ARTIFACT_DIR,
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});
const router = createModelRouter({
  model: env.OPENAI_MODEL,
  openaiApiKey: env.OPENAI_API_KEY,
  openaiModel: env.OPENAI_MODEL,
  geminiApiKey: env.GEMINI_API_KEY,
  geminiModel: env.GEMINI_MODEL,
  provider: env.AI_PROVIDER,
});
const explorer = new ExplorerAgent(router);
logger.info({ provider: router.current().name, model: router.modelFor('explore') }, 'AI provider ready');
const deps: AuditDependencies = {
  prisma,
  secrets,
  storage,
  explorer,
  ai: router,
  logger,
};

if (env.REDIS_URL.startsWith('memory:')) {
  // Scheduled audits only need a QUEUED row here: the loop below picks it up.
  startMonitorLoop(deps, null);
  await processQueuedAuditsFromDatabase(deps, logger);
}

const auditQueue = new Queue(AUDIT_QUEUE_NAME, {
  connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
});
const stopMonitor = startMonitorLoop(deps, auditQueue);

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const explorationConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const explorationQueue = new Queue(EXPLORATION_QUEUE_NAME, {
  connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
});
deps.explorationQueue = explorationQueue;

const auditWorker = new Worker<AuditJobData>(
  AUDIT_QUEUE_NAME,
  async (job) => {
    logger.info({ jobId: job.id, name: job.name, runId: job.data.runId }, 'processing audit job');
    await handleAuditJob(deps, job);
  },
  {
    connection,
    concurrency: 2,
    settings: { backoffStrategy: (attempts) => Math.min(60_000, 2 ** attempts * 1000) },
  },
);

const explorationWorker = new Worker<AuditJobData>(
  EXPLORATION_QUEUE_NAME,
  async (job) => {
    logger.info({ jobId: job.id, name: job.name, runId: job.data.runId }, 'processing exploration job');
    await handleExplorationJob(deps, job);
  },
  { connection: explorationConnection, concurrency: 2 },
);

auditWorker.on('failed', (job, error) => {
  logger.error({ err: error, jobId: job?.id, name: job?.name }, 'audit job failed');
  reporter.captureException(error, { jobId: job?.id });
  if (job?.name === START_AUDIT_JOB && job.data.runId) {
    void prisma.run
      .updateMany({
        where: { id: job.data.runId, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
        data: { status: 'FAILED', errorMessage: error.message, completedAt: new Date() },
      })
      .then(() => sendRunAlerts(deps, job.data.runId))
      .catch(() => undefined);
  }
});

explorationWorker.on('failed', (job, error) => {
  logger.error({ err: error, jobId: job?.id }, 'exploration job failed');
  reporter.captureException(error, { jobId: job?.id });
});

logger.info({ audit: AUDIT_QUEUE_NAME, exploration: EXPLORATION_QUEUE_NAME }, 'worker listening');

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info('graceful shutdown');
  stopMonitor();
  await Promise.all([auditWorker.close(), explorationWorker.close()]);
  await explorationQueue.close();
  await auditQueue.close();
  connection.disconnect();
  explorationConnection.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
