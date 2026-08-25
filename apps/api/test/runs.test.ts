import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOrg, injectJson, registerUser } from './helpers.js';

describe('runs API', () => {
  it('queues a run, fetches it, and cancels it', async () => {
    const user = await registerUser(`runner-${randomUUID()}@example.com`);
    const org = await createOrg(user.cookie, 'Audit Lab');
    const project = await injectJson('POST', '/projects', {
      cookie: user.cookie,
      payload: {
        organizationId: org.body.id,
        name: 'Target',
        baseUrl: 'https://example.com',
      },
    });
    expect(project.statusCode).toBe(201);

    const created = await injectJson('POST', `/projects/${project.json().id}/runs`, {
      cookie: user.cookie,
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    expect(['QUEUED', 'INITIALIZING']).toContain(created.json().status);

    const listed = await injectJson('GET', `/projects/${project.json().id}/runs`, {
      cookie: user.cookie,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().length).toBeGreaterThan(0);

    const detail = await injectJson('GET', `/runs/${created.json().id}`, {
      cookie: user.cookie,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().project.name).toBe('Target');

    const cancelled = await injectJson('POST', `/runs/${created.json().id}/cancel`, {
      cookie: user.cookie,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('CANCELLED');
  });
});
