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

function step(message) {
  console.log(`• ${message}`);
}

const health = await call('GET', '/health');
step(`API healthy: ${JSON.stringify(health.json)}`);

const email = `smoke-${Date.now()}@testcrew.test`;
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

console.log('\nSMOKE TEST PASSED');
