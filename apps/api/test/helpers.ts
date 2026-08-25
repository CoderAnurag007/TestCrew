import { config } from 'dotenv';
import { resolve } from 'node:path';
import { loadApiEnv, type ApiEnv } from '@auditor/config';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll } from 'vitest';
import { buildApp } from '../src/app.js';

config({ path: resolve(import.meta.dirname, '../../../.env') });
process.env.NODE_ENV = 'test';

let app: FastifyInstance | undefined;
let env: ApiEnv | undefined;

export function getEnv(): ApiEnv {
  env ??= loadApiEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
  });
  return env;
}

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp(getEnv());
    await app.ready();
  }
  return app;
}

export function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values
    .map((item) => String(item).split(';')[0])
    .filter(Boolean)
    .join('; ');
}

export async function injectJson(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  options?: { cookie?: string; payload?: unknown },
) {
  const instance = await getApp();
  const headers: Record<string, string> = {
    origin: getEnv().WEB_ORIGIN,
  };
  if (options?.cookie) {
    headers.cookie = options.cookie;
  }
  if (options?.payload !== undefined) {
    headers['content-type'] = 'application/json';
  }
  return instance.inject({
    method,
    url,
    payload: options?.payload,
    headers,
  });
}

export async function registerUser(email: string, password = 'password1234') {
  const response = await injectJson('POST', '/auth/register', {
    payload: { email, name: 'Test User', password },
  });
  return {
    status: response.statusCode,
    body: response.json(),
    cookie: cookieHeader(response),
  };
}

export async function createOrg(cookie: string, name = 'Acme') {
  const response = await injectJson('POST', '/organizations', {
    cookie,
    payload: { name },
  });
  return { status: response.statusCode, body: response.json() };
}

beforeAll(async () => {
  await getApp();
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
});
