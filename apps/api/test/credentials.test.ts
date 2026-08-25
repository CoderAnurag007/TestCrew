import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOrg, injectJson, registerUser } from './helpers.js';

describe('credential security', () => {
  it('stores secrets encrypted and never returns them', async () => {
    const user = await registerUser(`creds-${randomUUID()}@example.com`);
    const org = await createOrg(user.cookie, 'Secret Lab');
    const project = await injectJson('POST', '/projects', {
      cookie: user.cookie,
      payload: {
        organizationId: org.body.id,
        name: 'App',
        baseUrl: 'https://example.com',
      },
    });
    const created = await injectJson('POST', `/projects/${project.json().id}/credentials`, {
      cookie: user.cookie,
      payload: {
        name: 'Admin',
        username: 'demo',
        secret: 'super-secret-password',
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as Record<string, unknown>;
    expect(body.secret).toBeUndefined();
    expect(body.secretCiphertext).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('super-secret-password');

    const listed = await injectJson('GET', `/projects/${project.json().id}/credentials`, {
      cookie: user.cookie,
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain('super-secret-password');
    expect(listed.json()[0].username).toBe('demo');
  });
});
