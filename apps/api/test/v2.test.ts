import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOrg, getApp, injectJson, registerUser } from './helpers.js';

async function setup(name = 'V2') {
  const user = await registerUser(`v2-${randomUUID()}@example.com`);
  const org = await createOrg(user.cookie, `${name} Org`);
  const project = await injectJson('POST', '/projects', {
    cookie: user.cookie,
    payload: { organizationId: org.body.id, name, baseUrl: 'https://example.com' },
  });
  expect(project.statusCode).toBe(201);
  return { user, org: org.body, project: project.json() };
}

async function withToken(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) {
  const app = await getApp();
  return app.inject({
    method,
    url,
    payload: payload as never,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
  });
}

describe('project v2 settings', () => {
  it('defaults to read-only and saves safety mode, intents and blocked paths', async () => {
    const { user, project } = await setup('Settings');
    expect(project.safetyMode).toBe('READ_ONLY');
    expect(project.intents).toEqual([]);
    const updated = await injectJson('PATCH', `/projects/${project.id}`, {
      cookie: user.cookie,
      payload: {
        safetyMode: 'FULL',
        intents: [{ id: 'cart', text: 'Adding to cart increases the count by 1', enabled: true }],
        blockedPathPatterns: ['/admin/*'],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ safetyMode: 'FULL', blockedPathPatterns: ['/admin/*'] });
    expect(updated.json().intents).toHaveLength(1);

    const bad = await injectJson('PATCH', `/projects/${project.id}`, {
      cookie: user.cookie,
      payload: { blockedPathPatterns: ['admin'] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('rejects a reset hook pointing at a private address', async () => {
    const { user, project } = await setup('Hook');
    const response = await injectJson('PATCH', `/projects/${project.id}`, {
      cookie: user.cookie,
      payload: { resetHookUrl: 'http://169.254.169.254/latest' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('issues verification instructions and keeps the token stable', async () => {
    const { user, project } = await setup('Verify');
    const first = await injectJson('POST', `/projects/${project.id}/verification`, { cookie: user.cookie });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      host: 'example.com',
      verified: false,
      dnsRecordName: '_snaghunt.example.com',
      fileUrl: 'https://example.com/.well-known/snaghunt-verification.txt',
    });
    const second = await injectJson('POST', `/projects/${project.id}/verification`, { cookie: user.cookie });
    expect(second.json().token).toBe(first.json().token);
  });
});

describe('API tokens for CI', () => {
  it('starts and reads runs on its own project only', async () => {
    const { user, project } = await setup('CI');
    const other = await injectJson('POST', '/projects', {
      cookie: user.cookie,
      payload: { organizationId: project.organizationId, name: 'Other', baseUrl: 'https://example.org' },
    });
    const created = await injectJson('POST', `/projects/${project.id}/tokens`, {
      cookie: user.cookie,
      payload: { name: 'GitHub' },
    });
    expect(created.statusCode).toBe(201);
    const token = created.json().token as string;
    expect(token).toMatch(/^tc_/);

    const listed = await injectJson('GET', `/projects/${project.id}/tokens`, { cookie: user.cookie });
    expect(JSON.stringify(listed.json())).not.toContain(token);

    const run = await withToken('POST', `/projects/${project.id}/runs`, token, { baseUrl: 'https://example.net' });
    expect(run.statusCode).toBe(201);
    expect(run.json()).toMatchObject({ trigger: 'ci', baseUrlOverride: 'https://example.net' });

    const summary = await withToken('GET', `/runs/${run.json().id}/summary`, token);
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ status: 'QUEUED', baseUrl: 'https://example.net' });

    expect((await withToken('POST', `/projects/${other.json().id}/runs`, token, {})).statusCode).toBe(404);
    expect((await withToken('GET', '/projects?organizationId=x', token)).statusCode).toBe(403);
    expect((await withToken('PATCH', `/projects/${project.id}`, token, { name: 'x' })).statusCode).toBe(403);
    expect((await withToken('GET', `/projects/${project.id}/tokens`, token)).statusCode).toBe(403);

    // Tokens may cancel their own runs (and the test must not leave a queued run behind).
    expect((await withToken('POST', `/runs/${run.json().id}/cancel`, token)).statusCode).toBe(200);

    const revoked = await injectJson('DELETE', `/projects/${project.id}/tokens/${created.json().id}`, { cookie: user.cookie });
    expect(revoked.statusCode).toBe(204);
    expect((await withToken('GET', `/runs/${run.json().id}/summary`, token)).statusCode).toBe(401);
  });

  it('rejects unknown tokens and unsafe override URLs', async () => {
    const { user, project } = await setup('CI2');
    expect((await withToken('GET', `/projects/${project.id}`, 'tc_not-a-real-token')).statusCode).toBe(401);
    const unsafe = await injectJson('POST', `/projects/${project.id}/runs`, {
      cookie: user.cookie,
      payload: { baseUrl: 'http://127.0.0.1:8080' },
    });
    expect(unsafe.statusCode).toBe(400);
  });
});

describe('remembered "not a bug" decisions', () => {
  it('stores a suppression when a finding is dismissed with remember, and forgets it on reopen', async () => {
    const { user, project } = await setup('Suppress');
    const app = await getApp();
    const run = await injectJson('POST', `/projects/${project.id}/runs`, { cookie: user.cookie, payload: {} });
    const finding = await app.prisma.finding.create({
      data: {
        organizationId: project.organizationId,
        runId: run.json().id,
        projectId: project.id,
        title: 'Overlapping interactive elements',
        description: 'Two buttons overlap',
        severity: 'LOW',
        category: 'VISUAL',
        signature: 'visual|/dashboard|overlapping interactive elements',
      },
    });
    const url = `/runs/${run.json().id}/findings/${finding.id}`;
    const dismissed = await injectJson('PATCH', url, {
      cookie: user.cookie,
      payload: { status: 'DISMISSED', remember: true, reason: 'Intended design' },
    });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json()).toMatchObject({ status: 'DISMISSED', suppressed: true });
    const list = await injectJson('GET', `/projects/${project.id}/suppressions`, { cookie: user.cookie });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]).toMatchObject({ reason: 'Intended design' });

    const reopened = await injectJson('PATCH', url, { cookie: user.cookie, payload: { status: 'OPEN' } });
    expect(reopened.json()).toMatchObject({ status: 'OPEN', suppressed: false });
    const after = await injectJson('GET', `/projects/${project.id}/suppressions`, { cookie: user.cookie });
    expect(after.json()).toHaveLength(0);

    // Do not leave a queued run for a real worker to pick up.
    await injectJson('POST', `/runs/${run.json().id}/cancel`, { cookie: user.cookie });
  });
});
