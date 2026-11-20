#!/usr/bin/env node
// End-to-end check of a running deployment: sign up, create a project for the
// test shop, run a real audit through the Redis queue and a worker, and read
// back its findings and a screenshot. Exits non-zero on any failure.
//
//   API_URL=http://localhost:3001 WEB_ORIGIN=http://localhost:3000 \
//   TARGET_URL=http://fixture:4173 node infrastructure/deploy/smoke.mjs

const API = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const TARGET = process.env.TARGET_URL ?? 'http://fixture:4173';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 15 * 60_000);

let cookie = '';

async function call(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((item) => item.split(';')[0]).join('; ');
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 300)}`);
  return { json, response };
}

const progress = [];
function step(message) {
  progress.push(message);
  console.log(`• ${message}`);
}

// In GitHub Actions, failures also become annotations, which are readable without signing in.
const annotate = (level, title, text) => {
  if (!process.env.GITHUB_ACTIONS) return;
  const body = text.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
  console.log(`::${level} title=${title}::${body}`);
};
const fail = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  annotate('error', 'Smoke test failed', `${message}\n\nProgress:\n${progress.join('\n')}`);
  console.error(error);
  process.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

const health = await call('GET', '/health');
step(`API healthy: ${JSON.stringify(health.json)}`);

const email = `smoke-${Date.now()}@snaghunt.test`;
await call('POST', '/auth/register', { email, name: 'Smoke Test', password: `Smoke-${Date.now()}-pw` });
step('Signed up a fresh account');

const me = await call('GET', '/auth/me');
step(`Session works for ${me.json.email}`);

const org = await call('POST', '/organizations', { name: 'Smoke Org' });
const project = await call('POST', '/projects', {
  organizationId: org.json.id,
  name: 'Smoke shop',
  baseUrl: TARGET,
  allowPrivateTargets: true,
  maxPages: 12,
  maxActions: 40,
  maxDurationMs: 240_000,
});
step(`Created project ${project.json.id} for ${TARGET}`);

// The test shop asks visitors to sign in; these are its public demo login (apps/fixture).
await call('POST', `/projects/${project.json.id}/credentials`, {
  name: 'Test shop login',
  type: 'USERNAME_PASSWORD',
  username: process.env.TARGET_USERNAME ?? 'demo',
  secret: process.env.TARGET_PASSWORD ?? 'demo-password',
});
step('Saved the test shop login');

const run = await call('POST', `/projects/${project.json.id}/runs`, {});
step(`Queued audit ${run.json.id}`);

const started = Date.now();
let detail;
let lastStatus = '';
for (;;) {
  detail = (await call('GET', `/runs/${run.json.id}`)).json;
  if (detail.status !== lastStatus) {
    lastStatus = detail.status;
    step(`  status ${detail.status}${detail.currentAction ? ` (${detail.currentAction})` : ''}`);
  }
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(detail.status)) break;
  if (detail.currentAction === 'authentication-required' && Date.now() - started > 60_000) {
    throw new Error('The audit is waiting for a login it cannot do (authentication-required)');
  }
  if (Date.now() - started > TIMEOUT_MS) throw new Error(`Audit still ${detail.status} after ${TIMEOUT_MS / 60000} min`);
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

if (detail.status !== 'COMPLETED') throw new Error(`Audit ended ${detail.status}: ${detail.errorMessage ?? ''}`);
step(`Audit completed: score ${detail.qualityScore}, ${detail.pagesDiscovered} pages, ${detail.findings.length} findings`);
if (detail.pagesDiscovered < 2) throw new Error('The worker barely explored the site');
if (detail.findings.length < 1) throw new Error('The test shop has planted bugs, but no findings came back');

const shot = (detail.evidence ?? []).find((item) => item.contentType?.startsWith('image/'));
if (!shot) throw new Error('No screenshot evidence was stored');
const image = await call('GET', `/runs/${run.json.id}/evidence/${shot.id}`);
const bytes = (await image.response.arrayBuffer?.().catch(() => null))?.byteLength;
step(`API served a screenshot the worker stored (${image.response.headers.get('content-type')})${bytes ? `, ${bytes} bytes` : ''}`);

const share = await call('POST', `/runs/${run.json.id}/share`);
cookie = '';
const report = await call('GET', `/public/reports/${share.json.token}`);
step(`Public report link works without signing in (${report.json.findings.length} findings)`);

annotate('notice', 'Smoke test passed', progress.join('\n'));
console.log('\nSMOKE TEST PASSED');
