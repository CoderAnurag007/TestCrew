import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type * as Ssrf from '@auditor/shared/ssrf';
import { createOrg, getApp, injectJson, registerUser } from './helpers.js';

// The made-up test sites don't exist in DNS; every other address goes through the real check.
vi.mock('@auditor/shared/ssrf', async (importOriginal) => {
  const actual = await importOriginal<typeof Ssrf>();
  return {
    ...actual,
    assertSafeNavigationTarget: async (url: string, options?: { allowPrivate?: boolean }) => {
      if (/^https?:\/\/free-[a-f0-9]{8}\.example\.com(\/|$)/.test(url)) return;
      return actual.assertSafeNavigationTarget(url, options);
    },
  };
});

/** Each test checks its own made-up site, so reuse and limits don't leak between tests. */
function site() {
  return `free-${randomUUID().slice(0, 8)}.example.com`;
}

const created: string[] = [];

async function start(url: string) {
  const response = await injectJson('POST', '/public/free-scans', { payload: { url } });
  if (response.statusCode < 300) created.push(response.json().token);
  return response;
}

async function view(token: string) {
  return injectJson('GET', `/public/free-scans/${token}`);
}

/** Stands in for the worker: finishes the run with a design score and some findings. */
async function finish(token: string, findings = 5) {
  const app = await getApp();
  const scan = await app.prisma.freeScan.findUniqueOrThrow({ where: { token }, include: { run: true } });
  const run = scan.run;
  await app.prisma.run.update({
    where: { id: run.id },
    data: {
      status: 'COMPLETED',
      startedAt: new Date(Date.now() - 120_000),
      completedAt: new Date(),
      designScore: 87,
      designReport: {
        version: 1,
        score: 87,
        areas: { visual: { score: 100, issues: 0 }, layout: { score: 82, issues: 2 } },
        pages: [],
        marks: {},
      },
    },
  });
  const severities = ['LOW', 'HIGH', 'MEDIUM', 'CRITICAL', 'LOW', 'INFO'];
  for (let index = 0; index < findings; index += 1) {
    await app.prisma.finding.create({
      data: {
        organizationId: run.organizationId,
        runId: run.id,
        projectId: run.projectId,
        title: `Issue ${index + 1}`,
        description: 'Something is off on this page.',
        severity: severities[index % severities.length] as never,
        category: index === 0 ? 'BUG' : 'VISUAL',
        signature: index === 0 ? `link|${index}` : `design|layout|${index}`,
        url: `https://${scan.host}/pricing`,
      },
    });
  }
  return run;
}

async function newWorkspace() {
  const user = await registerUser(`free-${randomUUID()}@example.com`);
  const org = await createOrg(user.cookie, 'Free check test');
  return { cookie: user.cookie, organizationId: org.body.id as string };
}

afterAll(async () => {
  // Leave nothing queued behind for a worker to pick up later.
  const app = await getApp();
  const scans = await app.prisma.freeScan.findMany({ where: { token: { in: created } }, select: { run: { select: { projectId: true } } } });
  await app.prisma.project.deleteMany({ where: { id: { in: scans.map((scan) => scan.run.projectId) } } });
});

describe('free checks', () => {
  it('starts a check for a public site and refuses anything else', async () => {
    (await getApp()).env.FREE_SCAN_PER_VISITOR = 1000;
    expect((await start('not a website')).statusCode).toBe(400);
    expect((await start('localhost:3000')).statusCode).toBe(400);
    expect((await start('http://127.0.0.1')).statusCode).toBe(400);
    expect((await start('ftp://files.example.com')).statusCode).toBe(400);

    const response = await start(site());
    expect(response.statusCode).toBe(201);
    const { token } = response.json();
    const body = (await view(token)).json();
    expect(body).toMatchObject({ phase: 'queued', result: null, claimed: false });
    expect(body.url).toMatch(/^https:\/\/free-/);

    // A design review plus the quick scan, in the hidden workspace, never the full crawl.
    const app = await getApp();
    const scan = await app.prisma.freeScan.findUniqueOrThrow({ where: { token }, include: { run: { include: { organization: true } } } });
    expect(scan.run).toMatchObject({ trigger: 'free', bugAudit: false, designReview: true, status: 'QUEUED' });
    expect(scan.run.organization.slug).toBe('snaghunt-free-checks');
  });

  it('shows the same check when the visitor asks again for the same site', async () => {
    const host = site();
    const first = await start(`https://${host}/?utm=ad#top`);
    const again = await start(host);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ token: first.json().token, reused: true });
  });

  it('shows a teaser of three issues once finished, most severe first', async () => {
    const { token } = (await start(site())).json();
    await finish(token, 5);
    const body = (await view(token)).json();
    expect(body.phase).toBe('completed');
    expect(body.result.designScore).toBe(87);
    expect(body.result.totalIssues).toBe(5);
    expect(body.result.bugCount).toBe(1);
    expect(body.result.preview).toHaveLength(3);
    expect(body.result.preview.map((item: { severity: string }) => item.severity)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM']);
    expect(body.result.preview[0].path).toBe('/pricing');
    expect(body.result.areas.find((area: { area: string }) => area.area === 'layout')).toMatchObject({ score: 82, issues: 2 });
    expect(body.result.screenshot).toBe(false);
    expect((await injectJson('GET', `/public/free-scans/${token}/screenshot`)).statusCode).toBe(404);
  });

  it('answers 404 for an unknown check', async () => {
    expect((await view('x'.repeat(24))).statusCode).toBe(404);
  });

  it('limits checks per visitor per day', async () => {
    const app = await getApp();
    app.env.FREE_SCAN_PER_VISITOR = 0;
    try {
      const response = await start(site());
      expect(response.statusCode).toBe(429);
      expect(response.json().message).toMatch(/free account/);
    } finally {
      app.env.FREE_SCAN_PER_VISITOR = 1000;
    }
  });
});

describe('claiming a free check', () => {
  it('waits for the check to finish, then moves it into the new workspace', async () => {
    const { token } = (await start(site())).json();
    const owner = await newWorkspace();
    const early = await injectJson('POST', `/free-scans/${token}/claim`, { cookie: owner.cookie, payload: { organizationId: owner.organizationId } });
    expect(early.statusCode).toBe(409);

    const run = await finish(token, 4);
    const claim = await injectJson('POST', `/free-scans/${token}/claim`, { cookie: owner.cookie, payload: { organizationId: owner.organizationId } });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({ runId: run.id, projectId: run.projectId, alreadyClaimed: false });

    // The owner now sees the site, the run and every finding; the check shows as claimed.
    const projects = (await injectJson('GET', `/projects?organizationId=${owner.organizationId}`, { cookie: owner.cookie })).json();
    expect(projects.map((project: { id: string }) => project.id)).toContain(run.projectId);
    const detail = await injectJson('GET', `/runs/${run.id}`, { cookie: owner.cookie });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().findings).toHaveLength(4);
    const app = await getApp();
    expect(await app.prisma.finding.count({ where: { runId: run.id, organizationId: { not: owner.organizationId } } })).toBe(0);
    expect((await view(token)).json().claimed).toBe(true);

    // Saving it again is harmless; someone else cannot take it.
    const again = await injectJson('POST', `/free-scans/${token}/claim`, { cookie: owner.cookie, payload: { organizationId: owner.organizationId } });
    expect(again.json()).toMatchObject({ alreadyClaimed: true });
    const other = await newWorkspace();
    const stolen = await injectJson('POST', `/free-scans/${token}/claim`, { cookie: other.cookie, payload: { organizationId: other.organizationId } });
    expect(stolen.statusCode).toBe(409);
  });

  it('adds the check to the same site when the workspace already has it', async () => {
    const host = site();
    const owner = await newWorkspace();
    const project = await injectJson('POST', '/projects', {
      cookie: owner.cookie,
      payload: { organizationId: owner.organizationId, name: 'Mine', baseUrl: `https://${host}`, environmentName: 'Production' },
    });
    expect(project.statusCode).toBe(201);
    const { token } = (await start(host)).json();
    const run = await finish(token, 2);
    const claim = await injectJson('POST', `/free-scans/${token}/claim`, { cookie: owner.cookie, payload: { organizationId: owner.organizationId } });
    expect(claim.json()).toMatchObject({ projectId: project.json().id, runId: run.id });

    const app = await getApp();
    expect(await app.prisma.project.count({ where: { id: run.projectId } })).toBe(0);
    expect(await app.prisma.finding.count({ where: { runId: run.id, projectId: project.json().id } })).toBe(2);
    const sites = (await injectJson('GET', `/projects?organizationId=${owner.organizationId}`, { cookie: owner.cookie })).json();
    expect(sites).toHaveLength(1);
  });

  it('needs a workspace the user belongs to', async () => {
    const { token } = (await start(site())).json();
    await finish(token, 1);
    const owner = await newWorkspace();
    const stranger = await newWorkspace();
    const response = await injectJson('POST', `/free-scans/${token}/claim`, {
      cookie: stranger.cookie,
      payload: { organizationId: owner.organizationId },
    });
    expect(response.statusCode).toBe(404);
    expect((await injectJson('POST', `/free-scans/${token}/claim`, { payload: { organizationId: owner.organizationId } })).statusCode).toBe(401);
  });
});

describe('shared report footer', () => {
  it('shows "Checked by Snaghunt" unless the plan is white-label', async () => {
    const { token } = (await start(site())).json();
    const run = await finish(token, 1);
    const owner = await newWorkspace();
    await injectJson('POST', `/free-scans/${token}/claim`, { cookie: owner.cookie, payload: { organizationId: owner.organizationId } });
    const share = (await injectJson('POST', `/runs/${run.id}/share`, { cookie: owner.cookie })).json();

    const before = (await injectJson('GET', `/public/reports/${share.token}`)).json();
    expect(before.poweredBy).toBe(true);
    expect(before.brand.name).toBe('Snaghunt');

    await injectJson('POST', `/organizations/${owner.organizationId}/plan`, { cookie: owner.cookie, payload: { plan: 'AGENCY' } });
    const after = (await injectJson('GET', `/public/reports/${share.token}`)).json();
    expect(after.poweredBy).toBe(false);
  });
});
