import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOrg, getApp, injectJson, registerUser } from './helpers.js';

async function setup(plan?: string, trialEnded = false) {
  const user = await registerUser(`plans-${randomUUID()}@example.com`);
  const org = await createOrg(user.cookie, 'Plans Org');
  const app = await getApp();
  if (plan || trialEnded) {
    await app.prisma.organization.update({
      where: { id: org.body.id },
      data: { ...(plan ? { plan } : {}), ...(trialEnded ? { trialEndsAt: new Date(Date.now() - 1000) } : {}) },
    });
  }
  const project = (url = 'https://example.com') =>
    injectJson('POST', '/projects', { cookie: user.cookie, payload: { organizationId: org.body.id, name: 'Site', baseUrl: url } });
  return { user, org: org.body, app, project };
}

describe('plans and limits', () => {
  it('starts new workspaces on a 14-day Pro trial', async () => {
    const { user, org } = await setup();
    const usage = await injectJson('GET', `/organizations/${org.id}/usage`, { cookie: user.cookie });
    expect(usage.statusCode).toBe(200);
    const body = usage.json();
    expect(body).toMatchObject({ plan: 'FREE', effectivePlan: 'PRO', sites: 0, audits: 0 });
    const days = (new Date(body.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThanOrEqual(14);
  });

  it('limits Free to one site, with an upgrade code the app can act on', async () => {
    const { project } = await setup(undefined, true);
    expect((await project('https://example.com')).statusCode).toBe(201);
    const second = await project('https://example.org');
    expect(second.statusCode).toBe(402);
    expect(second.json()).toMatchObject({ code: 'sites' });
    expect(second.json().message).toMatch(/Upgrade to Pro/);
  });

  it('stops audits at the monthly limit and blocks devices outside the plan', async () => {
    const { user, project, app, org } = await setup(undefined, true);
    const site = (await project()).json();
    const iphone = await injectJson('POST', `/projects/${site.id}/runs`, { cookie: user.cookie, payload: { device: 'iphone' } });
    expect(iphone.statusCode).toBe(402);
    expect(iphone.json()).toMatchObject({ code: 'device' });

    for (let i = 0; i < 3; i += 1) {
      const run = await injectJson('POST', `/projects/${site.id}/runs`, { cookie: user.cookie, payload: {} });
      expect(run.statusCode).toBe(201);
    }
    const fourth = await injectJson('POST', `/projects/${site.id}/runs`, { cookie: user.cookie, payload: {} });
    expect(fourth.statusCode).toBe(402);
    expect(fourth.json()).toMatchObject({ code: 'audits' });
    // Keep the worker away from these test runs.
    await app.prisma.run.updateMany({ where: { organizationId: org.id }, data: { status: 'CANCELLED' } });
  });

  it('keeps branding for Agency and shows Snaghunt on other plans', async () => {
    const pro = await setup('PRO');
    const blocked = await injectJson('PATCH', `/organizations/${pro.org.id}/branding`, {
      cookie: pro.user.cookie,
      payload: { brandName: 'Pixel Agency' },
    });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json()).toMatchObject({ code: 'branding' });

    const agency = await setup('AGENCY');
    const allowed = await injectJson('PATCH', `/organizations/${agency.org.id}/branding`, {
      cookie: agency.user.cookie,
      payload: { brandName: 'Pixel Agency' },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('only allows schedules and alerts the plan includes', async () => {
    const starter = await setup('STARTER');
    const site = (await starter.project()).json();
    const hourly = await injectJson('PUT', `/projects/${site.id}/monitoring`, {
      cookie: starter.user.cookie,
      payload: { cadence: 'hourly' },
    });
    expect(hourly.statusCode).toBe(402);
    expect(hourly.json()).toMatchObject({ code: 'cadence' });
    const daily = await injectJson('PUT', `/projects/${site.id}/monitoring`, {
      cookie: starter.user.cookie,
      payload: { cadence: 'daily', devices: ['desktop', 'phone'] },
    });
    expect(daily.statusCode).toBe(200);
  });

  it('lets the owner switch plans outside production', async () => {
    const { user, org } = await setup(undefined, true);
    const switched = await injectJson('POST', `/organizations/${org.id}/plan`, { cookie: user.cookie, payload: { plan: 'AGENCY' } });
    expect(switched.statusCode).toBe(200);
    expect(switched.json()).toMatchObject({ plan: 'AGENCY', effectivePlan: 'AGENCY' });
    expect(switched.json().limits.sites).toBe(25);
  });
});
