import './register-playwright-path.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { createModelRouter, ExplorerAgent } from '@auditor/ai';
import { createObjectStorage } from '@auditor/analyzer';
import { loadWorkerEnv } from '@auditor/config';
import { createPrismaClient, LocalAesGcmSecretStore } from '@auditor/database';
import type { SafetyMode } from '@auditor/shared';
import { executeAuditRun } from './engine.js';

/**
 * Audits one URL from the command line, without the API or queue, and prints a
 * short report. Useful for trying the engine against a real site.
 *
 *   pnpm --filter @auditor/worker audit-url -- https://example.com [--mode READ_ONLY|FULL] [--heuristic]
 *     [--max-actions 60] [--minutes 6]
 *
 * The run is stored under a "CLI audits" organization so it also shows up in the dashboard.
 */
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  config({ path: resolve(import.meta.dirname, '../../../.env') });
  const args = process.argv.slice(2);
  const target = args.find((arg) => /^https?:\/\//.test(arg));
  if (!target) {
    process.stderr.write('Usage: audit-url <https://...> [--mode READ_ONLY|FULL] [--heuristic] [--max-actions n] [--minutes n]\n');
    process.exit(2);
  }
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const mode: SafetyMode = value('--mode') === 'FULL' ? 'FULL' : 'READ_ONLY';
  const env = loadWorkerEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const router = args.includes('--heuristic')
    ? createModelRouter({ model: 'heuristic' })
    : createModelRouter({
        model: env.OPENAI_MODEL,
        openaiApiKey: env.OPENAI_API_KEY,
        openaiModel: env.OPENAI_MODEL,
        geminiApiKey: env.GEMINI_API_KEY,
        geminiModel: env.GEMINI_MODEL,
        provider: env.AI_PROVIDER,
      });
  try {
    const suffix = randomUUID().slice(0, 8);
    const user =
      (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })) ??
      (await prisma.user.create({ data: { email: `cli-${suffix}@example.com`, name: 'CLI', passwordHash: 'not-used' } }));
    const org =
      (await prisma.organization.findFirst({ where: { slug: 'cli-audits' } })) ??
      (await prisma.organization.create({ data: { name: 'CLI audits', slug: 'cli-audits' } }));
    await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      create: { organizationId: org.id, userId: user.id, role: 'OWNER' },
      update: {},
    });
    const host = new URL(target).host;
    const project =
      (await prisma.project.findFirst({ where: { organizationId: org.id, baseUrl: target } })) ??
      (await prisma.project.create({
        data: { organizationId: org.id, name: host, baseUrl: target },
      }));
    await prisma.project.update({
      where: { id: project.id },
      data: {
        safetyMode: mode,
        maxActions: Number(value('--max-actions') ?? 60),
        maxPages: 40,
        maxDurationMs: Number(value('--minutes') ?? 6) * 60_000,
      },
    });
    const run = await prisma.run.create({
      data: { organizationId: org.id, projectId: project.id, status: 'QUEUED', createdById: user.id, trigger: 'api' },
    });
    process.stdout.write(`Auditing ${target} (${mode}, AI ${router.current().name}) as run ${run.id}\n`);
    const storage = createObjectStorage({
      artifactDir: env.ARTIFACT_DIR,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
    await executeAuditRun(
      {
        prisma,
        secrets: LocalAesGcmSecretStore.fromHexKey(env.CREDENTIAL_ENCRYPTION_KEY),
        storage,
        explorer: new ExplorerAgent(router),
        ai: router,
        logger: { info: () => undefined, warn: (o, m) => process.stderr.write(`warn: ${m}\n`), error: (o, m) => process.stderr.write(`error: ${m}\n`) },
      },
      { runId: run.id, organizationId: org.id, projectId: project.id },
    );

    const finished = await prisma.run.findUniqueOrThrow({ where: { id: run.id }, include: { report: true } });
    const findings = await prisma.finding.findMany({ where: { runId: run.id, suppressed: false }, orderBy: [{ severity: 'asc' }] });
    const tests = await prisma.testCase.findMany({ where: { runId: run.id }, include: { testRuns: true } });
    const states = await prisma.state.findMany({ where: { runId: run.id }, select: { url: true } });
    const events = await prisma.runEvent.findMany({ where: { runId: run.id, kind: { in: ['warning', 'error'] } } });
    const payload = (finished.report?.payload ?? {}) as Record<string, unknown>;
    const lines = [
      `# Audit of ${target}`,
      '',
      `Run ${run.id}: ${finished.status}${finished.errorMessage ? ` (${finished.errorMessage})` : ''}. Mode ${finished.effectiveSafetyMode}. Health score ${finished.qualityScore ?? 'n/a'}. AI cost $${finished.aiCostUsd.toFixed(4)}.`,
      '',
      `Screens explored (${states.length}): ${[...new Set(states.map((item) => item.url))].join(', ')}`,
      '',
      `Tests: ${finished.testsGenerated} generated, ${finished.testsPassed} passed, ${finished.testsFailed} failed, ${finished.testsFlaky} flaky.`,
      ...tests.map((test) => `- [${test.source}] ${test.name}: ${test.testRuns[0]?.status ?? 'n/a'}${test.testRuns[0]?.failureClass ? ` (${test.testRuns[0]?.failureClass})` : ''}${test.testRuns[0]?.errorMessage ? ` — ${test.testRuns[0]?.errorMessage?.split('\n')[0]?.slice(0, 200)}` : ''}`),
      '',
      `Findings (${findings.length}):`,
      ...findings.map((f) => `- ${f.severity} ${f.category}: ${f.title}${f.url ? ` (${f.url})` : ''}\n  ${f.description.slice(0, 300).replace(/\n/g, ' ')}`),
      '',
      `Safety: ${JSON.stringify((payload.safety as Record<string, unknown> | undefined)?.blockedCount ?? 0)} requests blocked. Links: ${JSON.stringify(payload.links ?? {})}`,
      ...(events.length ? ['', 'Warnings:', ...events.map((e) => `- ${e.message.slice(0, 300)}`)] : []),
      '',
      `Summary: ${finished.report?.summary ?? ''}`,
    ];
    const report = `${lines.join('\n')}\n`;
    const dir = resolve(import.meta.dirname, '../audit-results');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${host}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
    await writeFile(file, report);
    process.stdout.write(`${report}\nSaved to ${file}\n`);
  } finally {
    await prisma.$disconnect();
  }
}
