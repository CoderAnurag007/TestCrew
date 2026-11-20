import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOrg, injectJson, registerUser } from './helpers.js';

async function setup(payload: Record<string, unknown> = {}) {
  const user = await registerUser(`plan-${randomUUID()}@example.com`);
  const org = await createOrg(user.cookie, 'Plan Org');
  const project = await injectJson('POST', '/projects', {
    cookie: user.cookie,
    payload: { organizationId: org.body.id, name: 'Shop', baseUrl: 'https://example.com', ...payload },
  });
  expect(project.statusCode).toBe(201);
  return { user, project: project.json() };
}

describe('environments and staging', () => {
  it('creates a read-only production environment, and a full-mode staging one when a staging URL is given', async () => {
    const { user, project } = await setup({ stagingUrl: 'https://example.org' });
    const list = await injectJson('GET', `/projects/${project.id}/environments`, { cookie: user.cookie });
    expect(list.statusCode).toBe(200);
    const environments = list.json() as Array<{ kind: string; safetyMode: string | null; baseUrl: string }>;
    expect(environments.find((env) => env.kind === 'PRODUCTION')).toMatchObject({ safetyMode: 'READ_ONLY' });
    expect(environments.find((env) => env.kind === 'STAGING')).toMatchObject({ safetyMode: 'FULL', baseUrl: 'https://example.org' });
  });

  it('creates only production without a staging URL, and lets an environment change kind and mode', async () => {
    const { user, project } = await setup();
    const list = (await injectJson('GET', `/projects/${project.id}/environments`, { cookie: user.cookie })).json() as Array<{
      id: string;
      kind: string;
    }>;
    expect(list.map((env) => env.kind)).toEqual(['PRODUCTION']);
    const updated = await injectJson('PATCH', `/projects/${project.id}/environments/${list[0]!.id}`, {
      cookie: user.cookie,
      payload: { kind: 'STAGING', safetyMode: 'FULL' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ kind: 'STAGING', safetyMode: 'FULL' });

    const unsafe = await injectJson('PATCH', `/projects/${project.id}/environments/${list[0]!.id}`, {
      cookie: user.cookie,
      payload: { baseUrl: 'http://169.254.169.254/latest' },
    });
    expect(unsafe.statusCode).toBe(400);
  });

  it('issues verification for a specific environment host', async () => {
    const { user, project } = await setup({ stagingUrl: 'https://example.org' });
    const list = (await injectJson('GET', `/projects/${project.id}/environments`, { cookie: user.cookie })).json() as Array<{
      id: string;
      kind: string;
    }>;
    const staging = list.find((env) => env.kind === 'STAGING')!;
    const response = await injectJson('POST', `/projects/${project.id}/verification?environmentId=${staging.id}`, { cookie: user.cookie });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ host: 'example.org', verified: false });
    const missing = await injectJson('POST', `/projects/${project.id}/verification?environmentId=nope`, { cookie: user.cookie });
    expect(missing.statusCode).toBe(404);
  });
});

describe('test plan', () => {
  it('returns a full default plan and saves changes', async () => {
    const { user, project } = await setup();
    expect(project.testPlan).toMatchObject({ category: 'auto', transactions: { enabled: false }, payment: { mode: 'never' } });
    const updated = await injectJson('PATCH', `/projects/${project.id}`, {
      cookie: user.cookie,
      payload: {
        testPlan: {
          category: 'ecommerce',
          transactions: { enabled: true, maxPerRun: 1, stopBefore: 'none' },
          payment: { mode: 'sandbox', provider: 'stripe', cardNumber: '4242424242424242' },
          customJourneys: [{ id: 'newsletter', name: 'Newsletter', steps: [{ action: 'goto', target: '/' }] }],
        },
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().testPlan).toMatchObject({ category: 'ecommerce', transactions: { enabled: true }, payment: { mode: 'sandbox' } });
  });

  it('rejects a card that is not a published sandbox test card', async () => {
    const { user, project } = await setup();
    const response = await injectJson('PATCH', `/projects/${project.id}`, {
      cookie: user.cookie,
      payload: { testPlan: { payment: { mode: 'sandbox', provider: 'stripe', cardNumber: '4000056655665556' } } },
    });
    expect(response.statusCode).toBe(400);
  });
});
