import { z } from 'zod';

export function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

const hex32 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'CREDENTIAL_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  COOKIE_SECURE: z.string().optional(),
  COOKIE_DOMAIN: z.string().optional(),
  CREDENTIAL_ENCRYPTION_KEY: hex32,
  SENTRY_DSN: z.string().optional(),
  ARTIFACT_DIR: z.string().default('.artifacts'),
});

export type ApiEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  LOG_LEVEL: string;
  API_HOST: string;
  API_PORT: number;
  WEB_ORIGIN: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  SESSION_SECRET: string;
  SESSION_TTL_SECONDS: number;
  COOKIE_SECURE: boolean;
  COOKIE_DOMAIN: string | undefined;
  CREDENTIAL_ENCRYPTION_KEY: string;
  SENTRY_DSN: string | undefined;
  ARTIFACT_DIR: string;
};

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = apiEnvSchema.parse(env);
  return {
    ...parsed,
    COOKIE_SECURE: booleanFromEnv(parsed.COOKIE_SECURE, parsed.NODE_ENV === 'production'),
    COOKIE_DOMAIN: parsed.COOKIE_DOMAIN === '' ? undefined : parsed.COOKIE_DOMAIN,
    SENTRY_DSN: parsed.SENTRY_DSN === '' ? undefined : parsed.SENTRY_DSN,
    ARTIFACT_DIR: parsed.ARTIFACT_DIR,
  };
}

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CREDENTIAL_ENCRYPTION_KEY: hex32,
  SENTRY_DSN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  AI_PROVIDER: z.enum(['auto', 'openai', 'gemini', 'heuristic']).default('auto'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  ARTIFACT_DIR: z.string().default('.artifacts'),
});

export type WorkerEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  LOG_LEVEL: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  SENTRY_DSN: string | undefined;
  OPENAI_API_KEY: string | undefined;
  OPENAI_MODEL: string;
  GEMINI_API_KEY: string | undefined;
  GEMINI_MODEL: string;
  AI_PROVIDER: 'auto' | 'openai' | 'gemini' | 'heuristic';
  S3_ENDPOINT: string | undefined;
  S3_REGION: string;
  S3_BUCKET: string | undefined;
  S3_ACCESS_KEY_ID: string | undefined;
  S3_SECRET_ACCESS_KEY: string | undefined;
  S3_FORCE_PATH_STYLE: boolean;
  ARTIFACT_DIR: string;
};

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = workerEnvSchema.parse(env);
  return {
    ...parsed,
    SENTRY_DSN: parsed.SENTRY_DSN === '' ? undefined : parsed.SENTRY_DSN,
    OPENAI_API_KEY: parsed.OPENAI_API_KEY === '' ? undefined : parsed.OPENAI_API_KEY,
    GEMINI_API_KEY: parsed.GEMINI_API_KEY === '' ? undefined : parsed.GEMINI_API_KEY,
    S3_ENDPOINT: parsed.S3_ENDPOINT === '' ? undefined : parsed.S3_ENDPOINT,
    S3_BUCKET: parsed.S3_BUCKET === '' ? undefined : parsed.S3_BUCKET,
    S3_ACCESS_KEY_ID: parsed.S3_ACCESS_KEY_ID === '' ? undefined : parsed.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY:
      parsed.S3_SECRET_ACCESS_KEY === '' ? undefined : parsed.S3_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: booleanFromEnv(parsed.S3_FORCE_PATH_STYLE, true),
    ARTIFACT_DIR: parsed.ARTIFACT_DIR,
  };
}

export const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function loadWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  return webEnvSchema.parse({
    NEXT_PUBLIC_API_URL: env.NEXT_PUBLIC_API_URL,
  });
}
