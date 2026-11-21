import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createObjectStorage, type ObjectStorage } from '@auditor/analyzer';
import { loadApiEnv, type ApiEnv } from '@auditor/config';
import { createPrismaClient, LocalAesGcmSecretStore } from '@auditor/database';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from '@fastify/type-provider-zod';
import { Queue } from 'bullmq';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { AUDIT_QUEUE_NAME } from './lib/constants.js';
import { HttpError } from './lib/http-error.js';
import { MemoryRunQueue, MemorySessionStore, type RunQueuePort, type SessionStore } from './lib/runtime.js';
import { registerAccountRoutes } from './modules/auth/account.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerCredentialRoutes } from './modules/credentials/routes.js';
import { registerLaunchRoutes } from './modules/launch/routes.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';
import { registerEnvironmentRoutes } from './modules/environments/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerOrganizationRoutes } from './modules/organizations/routes.js';
import { registerProjectRoutes } from './modules/projects/routes.js';
import { registerRunRoutes } from './modules/runs/routes.js';
import { registerTokenRoutes } from './modules/tokens/routes.js';
import { registerPlugins } from './plugins/register.js';
import './types.js';

config({ path: resolve(import.meta.dirname, '../../../.env') });

export async function buildApp(env: ApiEnv = loadApiEnv()) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: ['password', 'passwordHash', 'secret', 'req.headers.cookie'],
        censor: '[Redacted]',
      },
    },
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      return typeof header === 'string' && header.length > 0 ? header : crypto.randomUUID();
    },
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const prisma = createPrismaClient(env.DATABASE_URL);
  const useMemoryQueue = env.NODE_ENV === 'test' || env.REDIS_URL.startsWith('memory:');
  const redis: SessionStore = useMemoryQueue
    ? new MemorySessionStore()
    : (new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) as unknown as SessionStore);
  const secrets = LocalAesGcmSecretStore.fromHexKey(env.CREDENTIAL_ENCRYPTION_KEY);
  const runQueue: RunQueuePort = useMemoryQueue
    ? new MemoryRunQueue()
    : (new Queue(AUDIT_QUEUE_NAME, {
        connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
      }) as unknown as RunQueuePort);
  const storage: ObjectStorage = createObjectStorage({
    artifactDir: env.ARTIFACT_DIR,
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });

  app.decorate('env', env);
  app.decorate('prisma', prisma);
  app.decorate('redis', redis);
  app.decorate('secrets', secrets);
  app.decorate('runQueue', runQueue);
  app.decorate('storage', storage);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.error,
        ...('code' in error && typeof error.code === 'string' ? { code: error.code } : {}),
        message: error.message,
        requestId: request.id,
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        requestId: request.id,
        details: error.issues,
      });
    }

    const statusCode =
      error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error');
    }

    return reply.status(statusCode).send({
      statusCode,
      error: statusCode >= 500 ? 'Internal Server Error' : error instanceof Error ? error.name : 'Error',
      message:
        statusCode >= 500
          ? 'An unexpected error occurred'
          : error instanceof Error
            ? error.message
            : 'An unexpected error occurred',
      requestId: request.id,
    });
  });

  await registerPlugins(app);
  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerAccountRoutes(app);
  await registerOrganizationRoutes(app);
  await registerProjectRoutes(app);
  await registerEnvironmentRoutes(app);
  await registerCredentialRoutes(app);
  await registerRunRoutes(app);
  await registerTokenRoutes(app);
  await registerDashboardRoutes(app);
  await registerLaunchRoutes(app);

  app.addHook('onClose', async () => {
    await runQueue.close();
    redis.disconnect();
    await prisma.$disconnect();
  });

  return app;
}
