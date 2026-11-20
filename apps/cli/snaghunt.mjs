#!/usr/bin/env node
// Snaghunt CI client. No dependencies; needs Node 18+.
//
//   SNAGHUNT_API_URL=https://auditor.example.com SNAGHUNT_TOKEN=tc_... \
//     node snaghunt.mjs run --project <projectId> --base-url https://pr-42.preview.example.com
//
// Exit codes: 0 gate passed, 1 gate failed, 2 the run failed or could not be started.
import { realpathSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const HELP = `Usage: snaghunt run --project <id> [options]

Options:
  --base-url <url>     Audit this URL instead of the project's own (e.g. a preview deployment)
  --environment <id>   Use a saved environment of the project
  --fail-on <rule>     new-high (default): fail on NEW or REGRESSED findings rated HIGH or CRITICAL
                       new-any: fail on any NEW or REGRESSED finding
                       high: fail on any HIGH or CRITICAL finding, new or not
                       none: never fail on findings
  --min-score <n>      Also fail when the health score is below n (0-100)
  --export <path>      Save the run's tests as a Playwright spec file
  --timeout <seconds>  Give up waiting after this long (default 1800)
  --no-wait            Start the run and exit 0 without waiting

Environment:
  SNAGHUNT_API_URL     Base URL of the Snaghunt API (required)
  SNAGHUNT_TOKEN       Project API token, tc_... (required)
`;

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, failOn: 'new-high', timeout: 1800, wait: true };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = () => {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === '--project') options.project = next();
    else if (arg === '--base-url') options.baseUrl = next();
    else if (arg === '--environment') options.environmentId = next();
    else if (arg === '--fail-on') options.failOn = next();
    else if (arg === '--min-score') options.minScore = Number(next());
    else if (arg === '--export') options.exportPath = next();
    else if (arg === '--timeout') options.timeout = Number(next());
    else if (arg === '--no-wait') options.wait = false;
    else if (arg === '--help' || arg === '-h') options.command = 'help';
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!['new-high', 'new-any', 'high', 'none'].includes(options.failOn)) {
    throw new Error(`--fail-on must be new-high, new-any, high or none`);
  }
  if (options.minScore !== undefined && !(options.minScore >= 0 && options.minScore <= 100)) {
    throw new Error('--min-score must be between 0 and 100');
  }
  return options;
}

/** Decides pass/fail from a run summary. Pure, so it is unit-tested. */
export function evaluateGate(summary, options) {
  const reasons = [];
  if (summary.status !== 'COMPLETED') {
    return { passed: false, error: true, reasons: [`Run ended with status ${summary.status}${summary.errorMessage ? `: ${summary.errorMessage}` : ''}`] };
  }
  const serious = (finding) => finding.severity === 'HIGH' || finding.severity === 'CRITICAL';
  const changed = (finding) => finding.change === 'NEW' || finding.change === 'REGRESSED';
  let blocking = [];
  if (options.failOn === 'new-high') blocking = summary.findings.filter((f) => changed(f) && serious(f));
  if (options.failOn === 'new-any') blocking = summary.findings.filter(changed);
  if (options.failOn === 'high') blocking = summary.findings.filter(serious);
  if (blocking.length > 0) {
    reasons.push(`${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'} (--fail-on ${options.failOn})`);
  }
  if (options.minScore !== undefined && (summary.qualityScore ?? 0) < options.minScore) {
    reasons.push(`Health score ${summary.qualityScore ?? 'n/a'} is below ${options.minScore}`);
  }
  return { passed: reasons.length === 0, error: false, reasons, blocking };
}

export function markdownSummary(summary, gate, runUrl) {
  const lines = [];
  lines.push(`## Snaghunt audit: ${gate.passed ? 'passed' : gate.error ? 'error' : 'failed'}`);
  lines.push('');
  lines.push(`Target: ${summary.baseUrl} · Safety mode: ${summary.safetyMode ?? 'n/a'} · Health score: **${summary.qualityScore ?? 'n/a'}**`);
  lines.push('');
  if (summary.previousRunId) {
    const c = summary.changeCounts;
    lines.push(`Since the previous run: **${c.new} new**, **${c.regressed} regressed**, ${c.fixed} fixed, ${c.recurring} still open.`);
  } else {
    lines.push('First completed run for this project; nothing to compare against yet.');
  }
  lines.push(`Tests: ${summary.tests.passed} passed, ${summary.tests.failed} failed, ${summary.tests.flaky} flaky of ${summary.tests.generated}.`);
  if (gate.reasons.length) {
    lines.push('', ...gate.reasons.map((reason) => `- ${reason}`));
  }
  const shown = (gate.blocking && gate.blocking.length ? gate.blocking : summary.findings.filter((f) => f.change !== 'RECURRING')).slice(0, 20);
  if (shown.length) {
    lines.push('', '| Change | Severity | Finding |', '| --- | --- | --- |');
    for (const f of shown) lines.push(`| ${f.change} | ${f.severity} | ${String(f.title).replace(/\|/g, '\\|')} |`);
  }
  if (runUrl) lines.push('', `Run: ${runUrl}`);
  return `${lines.join('\n')}\n`;
}

async function api(path, init = {}) {
  const base = (process.env.SNAGHUNT_API_URL ?? '').replace(/\/+$/, '');
  const token = process.env.SNAGHUNT_TOKEN;
  if (!base || !token) throw new Error('Set SNAGHUNT_API_URL and SNAGHUNT_TOKEN');
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${init.method ?? 'GET'} ${path} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return response;
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP}`);
    return 2;
  }
  if (options.command !== 'run' || !options.project) {
    process.stdout.write(HELP);
    return options.command === 'help' ? 0 : 2;
  }

  const body = { trigger: 'ci' };
  if (options.baseUrl) body.baseUrl = options.baseUrl;
  if (options.environmentId) body.environmentId = options.environmentId;
  const run = await (await api(`/projects/${encodeURIComponent(options.project)}/runs`, { method: 'POST', body: JSON.stringify(body) })).json();
  process.stdout.write(`Started run ${run.id}\n`);
  if (!options.wait) return 0;

  const deadline = Date.now() + options.timeout * 1000;
  let summary;
  let last = '';
  for (;;) {
    summary = await (await api(`/runs/${run.id}/summary`)).json();
    if (summary.status !== last) {
      process.stdout.write(`  ${new Date().toISOString()} ${summary.status}\n`);
      last = summary.status;
    }
    if (TERMINAL.has(summary.status)) break;
    if (Date.now() > deadline) {
      process.stderr.write(`Timed out after ${options.timeout}s waiting for run ${run.id}\n`);
      return 2;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  if (options.exportPath && summary.status === 'COMPLETED') {
    const spec = await (await api(`/runs/${run.id}/export/playwright`)).text();
    await writeFile(options.exportPath, spec);
    process.stdout.write(`Saved Playwright tests to ${options.exportPath}\n`);
  }

  const gate = evaluateGate(summary, options);
  const report = markdownSummary(summary, gate, process.env.SNAGHUNT_WEB_URL ? `${process.env.SNAGHUNT_WEB_URL.replace(/\/+$/, '')}/runs/${run.id}` : null);
  process.stdout.write(`\n${report}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, report).catch(() => undefined);
  }
  if (gate.error) return 2;
  return gate.passed ? 0 : 1;
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    });
}
