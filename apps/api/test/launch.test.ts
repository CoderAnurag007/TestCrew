import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTicket, markdownToAdf } from '../src/modules/launch/routes.js';
import { createOrg, getApp, injectJson, registerUser } from './helpers.js';

async function setup() {
  const user = await registerUser(`launch-${randomUUID()}@example.com`);
  const org = await createOrg(user.cookie, 'Launch Org');
  const project = await injectJson('POST', '/projects', {
    cookie: user.cookie,
    payload: { organizationId: org.body.id, name: 'Launch', baseUrl: 'https://example.com' },
  });
  expect(project.statusCode).toBe(201);
  return { user, org: org.body, project: project.json() };
}

async function completedRunWithFinding(projectId: string, organizationId: string, userId: string) {
  const app = await getApp();
  const run = await app.prisma.run.create({
    data: { organizationId, projectId, createdById: userId, status: 'COMPLETED', qualityScore: 82, completedAt: new Date() },
  });
  const visible = await app.prisma.finding.create({
    data: {
      organizationId,
      projectId,
      runId: run.id,
      title: 'Checkout button does nothing',
      description: 'Clicking Pay shows no response.',
      severity: 'HIGH',
      category: 'BUG',
      steps: ['Open /cart', 'Click Pay'],
    },
  });
  const hidden = await app.prisma.finding.create({
    data: {
      organizationId,
      projectId,
      runId: run.id,
      title: 'Dismissed thing',
      description: 'Not a bug.',
      severity: 'LOW',
      category: 'BUG',
      status: 'DISMISSED',
    },
  });
  return { run, visible, hidden };
}

describe('monitoring settings', () => {
  it('saves a daily schedule with alerts and works out the next run', async () => {
    const { user, project } = await setup();
    const saved = await injectJson('PUT', `/projects/${project.id}/monitoring`, {
      cookie: user.cookie,
      payload: {
        cadence: 'daily',
        hourUtc: 3,
        devices: ['desktop', 'iphone'],
        alerts: { emails: ['dev@example.com'], minSeverity: 'HIGH' },
      },
    });
    expect(saved.statusCode).toBe(200);
    const body = saved.json();
    expect(body.cadence).toBe('daily');
    expect(body.devices).toEqual(['desktop', 'iphone']);
    expect(body.alerts).toMatchObject({ emails: ['dev@example.com'], minSeverity: 'HIGH', onFailure: true });
    expect(new Date(body.nextRunAt).getUTCHours()).toBe(3);

    const off = await injectJson('PUT', `/projects/${project.id}/monitoring`, {
      cookie: user.cookie,
      payload: { cadence: null },
    });
    expect(off.json().nextRunAt).toBeNull();
  });

  it('rejects an unknown device', async () => {
    const { user, project } = await setup();
    const response = await injectJson('PUT', `/projects/${project.id}/monitoring`, {
      cookie: user.cookie,
      payload: { cadence: 'daily', devices: ['tv'] },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('integrations', () => {
  it('stores tokens encrypted, shows only a hint, and keeps the old token when none is sent', async () => {
    const { user, project } = await setup();
    const first = await injectJson('PUT', `/projects/${project.id}/integrations`, {
      cookie: user.cookie,
      payload: { provider: 'github', config: { repo: 'acme/shop' }, secret: 'ghp_secret_token_1234' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ provider: 'github', hasSecret: true, secretHint: '…1234' });
    expect(JSON.stringify(first.json())).not.toContain('ghp_secret');

    const app = await getApp();
    const row = await app.prisma.projectIntegration.findFirstOrThrow({ where: { projectId: project.id } });
    expect(row.secretCiphertext).not.toContain('ghp_secret');

    const second = await injectJson('PUT', `/projects/${project.id}/integrations`, {
      cookie: user.cookie,
      payload: { provider: 'github', config: { repo: 'acme/web' } },
    });
    expect(second.json()).toMatchObject({ config: { repo: 'acme/web' }, secretHint: '…1234' });
  });

  it('only accepts Slack incoming-webhook URLs for Slack', async () => {
    const { user, project } = await setup();
    const response = await injectJson('PUT', `/projects/${project.id}/integrations`, {
      cookie: user.cookie,
      payload: { provider: 'slack', secret: 'https://evil.example.com/hook' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('asks to connect a tracker before creating a ticket', async () => {
    const { user, org, project } = await setup();
    const { run, visible } = await completedRunWithFinding(project.id, org.id, user.body.id);
    const response = await injectJson('POST', `/runs/${run.id}/findings/${visible.id}/ticket`, {
      cookie: user.cookie,
      payload: { provider: 'jira' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/Connect Jira/);
  });
});

describe('share links', () => {
  it('shares a report publicly without hidden findings, and revokes it', async () => {
    const { user, org, project } = await setup();
    await injectJson('PATCH', `/organizations/${org.id}/branding`, {
      cookie: user.cookie,
      payload: { brandName: 'Pixel Agency', brandColor: '#1F6FEB' },
    });
    const { run } = await completedRunWithFinding(project.id, org.id, user.body.id);
    const shared = await injectJson('POST', `/runs/${run.id}/share`, { cookie: user.cookie });
    expect(shared.statusCode).toBe(200);
    const { token } = shared.json();

    const again = await injectJson('POST', `/runs/${run.id}/share`, { cookie: user.cookie });
    expect(again.json().token).toBe(token);

    const report = await injectJson('GET', `/public/reports/${token}`);
    expect(report.statusCode).toBe(200);
    const body = report.json();
    expect(body.brand).toMatchObject({ name: 'Pixel Agency', color: '#1F6FEB' });
    expect(body.findings.map((item: { title: string }) => item.title)).toEqual(['Checkout button does nothing']);
    expect(body.findings[0].steps).toEqual(['Open /cart', 'Click Pay']);
    expect(JSON.stringify(body)).not.toContain('organizationId');

    const revoked = await injectJson('DELETE', `/runs/${run.id}/share`, { cookie: user.cookie });
    expect(revoked.statusCode).toBe(204);
    expect((await injectJson('GET', `/public/reports/${token}`)).statusCode).toBe(404);
  });

  it('does not let another workspace share a run', async () => {
    const owner = await setup();
    const { run } = await completedRunWithFinding(owner.project.id, owner.org.id, owner.user.body.id);
    const stranger = await registerUser(`launch-${randomUUID()}@example.com`);
    const response = await injectJson('POST', `/runs/${run.id}/share`, { cookie: stranger.cookie });
    expect(response.statusCode).toBe(404);
  });
});

describe('ticket creation', () => {
  const finding = {
    title: 'Pay button does nothing',
    severity: 'HIGH',
    description: 'Clicking Pay shows no response.',
    url: 'https://shop.example.com/cart',
    steps: ['Open the cart', 'Click Pay'],
    expected: 'The payment form opens.',
    actual: 'Nothing happens.',
    recommendation: 'Check the click handler.',
  };

  function fakeFetch(reply: unknown, status = 201) {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(reply), { status });
    }) as unknown as typeof fetch;
    return { send, calls };
  }

  it('creates a GitHub issue with labels and the steps', async () => {
    const { send, calls } = fakeFetch({ html_url: 'https://github.com/acme/shop/issues/7' });
    const url = await createTicket(send, 'github', { repo: 'acme/shop', labels: ['bug'] }, 'tok', finding, {
      report: 'https://app/r/x',
    });
    expect(url).toBe('https://github.com/acme/shop/issues/7');
    expect(calls[0]!.url).toBe('https://api.github.com/repos/acme/shop/issues');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.title).toBe('[High] Pay button does nothing');
    expect(body.labels).toEqual(['bug']);
    expect(body.body).toContain('1. Open the cart');
    expect(body.body).toContain('[Screenshots and evidence](https://app/r/x)');
  });

  it('creates a Jira issue in Atlassian document format', async () => {
    const { send, calls } = fakeFetch({ key: 'WEB-12' });
    const url = await createTicket(
      send,
      'jira',
      { site: 'acme.atlassian.net', email: 'a@b.co', projectKey: 'WEB', issueType: 'Bug' },
      'tok',
      finding,
      {},
    );
    expect(url).toBe('https://acme.atlassian.net/browse/WEB-12');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.fields.project.key).toBe('WEB');
    expect(body.fields.description.type).toBe('doc');
    expect(String((calls[0]!.init.headers as Record<string, string>).authorization)).toMatch(/^Basic /);
  });

  it('creates a Linear issue and reports Linear errors plainly', async () => {
    const ok = fakeFetch({ data: { issueCreate: { success: true, issue: { url: 'https://linear.app/acme/issue/ENG-3' } } } }, 200);
    expect(await createTicket(ok.send, 'linear', { teamId: 't1' }, 'key', finding, {})).toBe('https://linear.app/acme/issue/ENG-3');
    const bad = fakeFetch({ errors: [{ message: 'Team not found' }] }, 200);
    await expect(createTicket(bad.send, 'linear', { teamId: 't1' }, 'key', finding, {})).rejects.toThrow(/Team not found/);
  });

  it('explains a refusal from the tracker', async () => {
    const { send } = fakeFetch({ message: 'Bad credentials' }, 401);
    await expect(createTicket(send, 'github', { repo: 'acme/shop' }, 'tok', finding, {})).rejects.toThrow(
      /GitHub refused the ticket: Bad credentials/,
    );
  });

  it('turns ticket markdown into Jira headings, numbered lists and links', () => {
    const doc = markdownToAdf('### Steps\n1. Open [cart](https://x.co/cart)\n2. Click **Pay**\n\nDone.');
    expect(doc.content.map((node) => node.type)).toEqual(['heading', 'orderedList', 'paragraph']);
    const list = doc.content[1] as { content: { content: { content: { marks?: unknown[] }[] }[] }[] };
    expect(list.content).toHaveLength(2);
    expect(list.content[0]!.content[0]!.content[1]!.marks).toEqual([{ type: 'link', attrs: { href: 'https://x.co/cart' } }]);
  });
});
