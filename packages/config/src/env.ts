import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

/** Repository root (packages/config/src -> ../../..). */
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

/**
 * The API and the worker run from different folders (apps/api, apps/worker).
 * A relative ARTIFACT_DIR used to resolve against each process's own folder,
 * so the worker wrote screenshots where the API never looked. Relative paths
 * now resolve against the repository root, the same place for every process.
 */
export function resolveArtifactDir(value: string): string {
  return isAbsolute(value) ? value : resolve(REPO_ROOT, value);
}

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
  /** Sends password reset and verification emails, e.g. smtps://user:pass@smtp.example.com:465. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  ALERT_FROM: z.string().optional(),
  ARTIFACT_DIR: z.string().default('.artifacts'),
  // The API reads the screenshots and reports the worker stores, so it needs the same storage.
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  /** Free checks from the landing page (no sign-up): most per day in total, and per visitor. */
  FREE_SCAN_DAILY_LIMIT: z.coerce.number().int().min(0).default(200),
  FREE_SCAN_PER_VISITOR: z.coerce.number().int().min(0).default(3),
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
  SMTP_URL: string | undefined;
  MAIL_FROM: string;
  ARTIFACT_DIR: string;
  S3_ENDPOINT: string | undefined;
  S3_REGION: string;
  S3_BUCKET: string | undefined;
  S3_ACCESS_KEY_ID: string | undefined;
  S3_SECRET_ACCESS_KEY: string | undefined;
  S3_FORCE_PATH_STYLE: boolean;
  FREE_SCAN_DAILY_LIMIT: number;
  FREE_SCAN_PER_VISITOR: number;
};

const blank = (value: string | undefined) => (value === '' ? undefined : value);

/** The example values from .env.example: fine on a laptop, never in production. */
const EXAMPLE_SECRETS = new Set([
  'local-dev-session-secret-change-me-32',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
]);

function assertProductionSecrets(env: { NODE_ENV: string; SESSION_SECRET?: string; CREDENTIAL_ENCRYPTION_KEY: string }) {
  if (env.NODE_ENV !== 'production') return;
  for (const [name, value] of [
    ['SESSION_SECRET', env.SESSION_SECRET],
    ['CREDENTIAL_ENCRYPTION_KEY', env.CREDENTIAL_ENCRYPTION_KEY],
  ] as const) {
    if (value && EXAMPLE_SECRETS.has(value)) {
      throw new Error(`${name} is still the example value from .env.example. Generate a new one before running in production.`);
    }
  }
}

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = apiEnvSchema.parse(env);
  assertProductionSecrets(parsed);
  return {
    ...parsed,
    COOKIE_SECURE: booleanFromEnv(parsed.COOKIE_SECURE, parsed.NODE_ENV === 'production'),
    COOKIE_DOMAIN: blank(parsed.COOKIE_DOMAIN),
    SENTRY_DSN: blank(parsed.SENTRY_DSN),
    SMTP_URL: blank(parsed.SMTP_URL),
    MAIL_FROM: blank(parsed.MAIL_FROM) ?? blank(parsed.ALERT_FROM) ?? 'Snaghunt <hello@snaghunt.com>',
    ARTIFACT_DIR: resolveArtifactDir(parsed.ARTIFACT_DIR),
    S3_ENDPOINT: blank(parsed.S3_ENDPOINT),
    S3_BUCKET: blank(parsed.S3_BUCKET),
    S3_ACCESS_KEY_ID: blank(parsed.S3_ACCESS_KEY_ID),
    S3_SECRET_ACCESS_KEY: blank(parsed.S3_SECRET_ACCESS_KEY),
    S3_FORCE_PATH_STYLE: booleanFromEnv(parsed.S3_FORCE_PATH_STYLE, true),
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
  assertProductionSecrets(parsed);
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
    ARTIFACT_DIR: resolveArtifactDir(parsed.ARTIFACT_DIR),
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
