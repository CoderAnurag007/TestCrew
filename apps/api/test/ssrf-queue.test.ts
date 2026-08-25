import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { START_AUDIT_JOB } from '@auditor/shared';
import { createOrg, getApp, injectJson, registerUser } from './helpers.js';
import type { MemoryRunQueue } from '../src/lib/runtime.js';

describe('SSRF protection', () => {
  it('rejects localhost and metadata targets unless the project allows private targets', async () => {
    const user = await registerUser(`ssrf-${randomUUID()}@example.com`);
    const org = await createOrg(user.cookie, 'SSRF Lab');

    const blocked = await injectJson('POST', '/projects', {
      cookie: user.cookie,
      payload: {
        organizationId: org.body.id,
        name: 'Internal',
        baseUrl: 'http://127.0.0.1:4173',
      },
    });
    expect(blocked.statusCode).toBe(400);

    const metadata = await injectJson('POST', '/projects', {
      cookie: user.cookie,
      payload: {
        organizationId: org.body.id,
        name: 'Metadata',
        baseUrl: 'http://169.254.169.254/latest/meta-data',
        allowPrivateTargets: true,
      },
    });
    expect(metadata.statusCode).toBe(400);

    const allowed = await injectJson('POST', '/projects', {
      cookie: user.cookie,
      payload: {
        organizationId: org.body.id,
        name: 'Local fixture',
        baseUrl: 'http://127.0.0.1:4173',
        allowPrivateTargets: true,
      },
    });
    expect(allowed.statusCode).toBe(201);
  });
});

describe('queue behavior', () => {
  it('enqueues START_AUDIT on the audit queue', async () => {
    const user = await registerUser(`queue-${randomUUID()}@example.com`);
    const org = await createOrg(user.cookie, 'Queue Lab');
    const project = await injectJson('POST', '/projects', {
      cookie: user.cookie,
      payload: {
        organizationId: org.body.id,
        name: 'Queued',
        baseUrl: 'https://example.com',
      },
    });
    const created = await injectJson('POST', `/projects/${project.json().id}/runs`, {
      cookie: user.cookie,
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const app = await getApp();
    const queue = app.runQueue as MemoryRunQueue;
    expect(queue.added.some((job) => job.name === START_AUDIT_JOB)).toBe(true);
  });
});
