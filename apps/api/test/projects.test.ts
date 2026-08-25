import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOrg, injectJson, registerUser } from './helpers.js';

describe('projects API', () => {
  it('creates, lists, updates, and deletes a project inside the caller tenant', async () => {
    const owner = await registerUser(`owner-${randomUUID()}@example.com`);
    const org = await createOrg(owner.cookie, 'Northwind');
    expect(org.status).toBe(201);

    const created = await injectJson('POST', '/projects', {
      cookie: owner.cookie,
      payload: {
        organizationId: org.body.id,
        name: 'Storefront',
        description: 'Public store',
        baseUrl: 'https://example.com',
        environmentName: 'Staging',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().name).toBe('Storefront');
    expect(created.json().environments[0].name).toBe('Staging');

    const listed = await injectJson('GET', `/projects?organizationId=${org.body.id}`, {
      cookie: owner.cookie,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const patched = await injectJson('PATCH', `/projects/${created.json().id}`, {
      cookie: owner.cookie,
      payload: { name: 'Storefront EU' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().name).toBe('Storefront EU');

    const deleted = await injectJson('DELETE', `/projects/${created.json().id}`, {
      cookie: owner.cookie,
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('isolates projects across organizations', async () => {
    const alice = await registerUser(`alice-${randomUUID()}@example.com`);
    const bob = await registerUser(`bob-${randomUUID()}@example.com`);
    const aliceOrg = await createOrg(alice.cookie, 'Alice Corp');
    const project = await injectJson('POST', '/projects', {
      cookie: alice.cookie,
      payload: {
        organizationId: aliceOrg.body.id,
        name: 'Private App',
        baseUrl: 'https://example.com',
      },
    });
    expect(project.statusCode).toBe(201);

    const bobRead = await injectJson('GET', `/projects/${project.json().id}`, {
      cookie: bob.cookie,
    });
    expect(bobRead.statusCode).toBe(404);

    const bobList = await injectJson('GET', `/projects?organizationId=${aliceOrg.body.id}`, {
      cookie: bob.cookie,
    });
    expect(bobList.statusCode).toBe(404);
  });
});
