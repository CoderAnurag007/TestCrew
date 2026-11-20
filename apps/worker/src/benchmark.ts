import './register-playwright-path.js';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { createModelRouter, ExplorerAgent, type ModelRouter } from '@auditor/ai';
import { LocalFileStorage } from '@auditor/analyzer';
import { loadWorkerEnv } from '@auditor/config';
import { createPrismaClient, LocalAesGcmSecretStore, type PrismaClient } from '@auditor/database';
import {
  FIXTURE_PASSWORD,
  FIXTURE_USER,
  PLANTED_BUGS,
  scoreFindings,
  startFixture,
  type BenchmarkScore,
  type FindingLike,
} from '@auditor/fixture';
import { testPlanSchema, type Intent, type SafetyMode, type TestPlan } from '@auditor/shared';
import { executeAuditRun } from './engine.js';

/**
 * Runs a complete audit against the fixture app, whose bugs are known, and
 * measures how many the auditor catches (recall), how many of its findings are
 * real (precision), how long it took and what the AI cost. Run it on every
 * change to the explorer, generators, prompts or analyzers.
 *
 *   pnpm --filter @auditor/worker benchmark            # heuristic (no AI), FULL mode
 *   pnpm --filter @auditor/worker benchmark -- --ai    # use the configured AI provider
 *   pnpm --filter @auditor/worker benchmark -- --mode READ_ONLY
 */
export const BENCHMARK_INTENTS: Intent[] = [
  { id: 'cart-plus-one', text: 'On the Shop page, clicking "Add to cart" for an item increases the cart count by exactly 1.', enabled: true },
];

/**
 * The fixture's search box searches users, not products, so the product
 * search journey is switched off, exactly as a project would do it.
 */
export const BENCHMARK_PLAN: TestPlan = testPlanSchema.parse({
  category: 'ecommerce',
  disabledJourneys: ['search_product'],
  interactionMap: { enabled: true, maxControlsPerScreen: 40, maxScreens: 25, budgetMinutes: 5, excludeLabels: [] },
  transactions: { enabled: true, maxPerRun: 2, stopBefore: 'none' },
  payment: { mode: 'sandbox', provider: 'stripe', cardNumber: '4242424242424242', expiry: '12/34', cvc: '123', nameOnCard: 'Snaghunt QA' },
});

export interface BenchmarkResult {
  startedAt: string;
  durationMs: number;
  mode: SafetyMode;
  ai: string;
  runId: string;
  runStatus: string;
  score: number | null;
  findings: number;
  aiCostUsd: number;
  benchmark: BenchmarkScore;
  /** Recall over the bugs this configuration can be expected to catch. */
  reachableRecall: number;
  tests: { generated: number; passed: number; failed: number; flaky: number };
  /** Non-GET requests the fixture received during the audit. */
  fixtureMutations: Array<{ method: string; path: string }>;
}

export async function runBenchmark(options: {
  prisma: PrismaClient;
  secretsKeyHex: string;
  router?: ModelRouter;
  mode?: SafetyMode;
  artifactDir?: string;
  maxActions?: number;
  maxDurationMs?: number;
}): Promise<BenchmarkResult> {
  const fixture = await startFixture();
  const artifactDir = options.artifactDir ?? (await mkdtemp(join(tmpdir(), 'auditor-bench-')));
  const router = options.router ?? createModelRouter({ model: 'heuristic' });
  const mode = options.mode ?? 'FULL';
  const startedAt = new Date();
  const prisma = options.prisma;
  const secrets = LocalAesGcmSecretStore.fromHexKey(options.secretsKeyHex);
  try {
    const suffix = randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: { email: `bench-${suffix}@example.com`, name: 'Benchmark', passwordHash: 'not-used' },
    });
    const org = await prisma.organization.create({ data: { name: `Bench ${suffix}`, slug: `bench-${suffix}` } });
    await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: 'OWNER' } });
    const project = await prisma.project.create({
      data: {
        organizationId: org.id,
        name: 'Fixture benchmark',
        baseUrl: fixture.url,
        allowPrivateTargets: true,
        maxPages: 25,
        maxActions: options.maxActions ?? 45,
        maxDepth: 8,
        maxDurationMs: options.maxDurationMs ?? 180_000,
        allowDestructive: false,
        safetyMode: mode,
        intents: BENCHMARK_INTENTS,
        testPlan: BENCHMARK_PLAN,
      },
    });
    await prisma.credential.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Demo',
        type: 'USERNAME_PASSWORD',
        username: FIXTURE_USER,
        secretCiphertext: await secrets.encrypt(FIXTURE_PASSWORD),
      },
    });
    // The fixture plays a staging site, so orders and sandbox payments are allowed in FULL mode.
    const environment = await prisma.environment.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Staging',
        baseUrl: fixture.url,
        kind: 'STAGING',
        safetyMode: mode,
      },
    });
    const run = await prisma.run.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        environmentId: environment.id,
        status: 'QUEUED',
        createdById: user.id,
        trigger: 'api',
      },
    });

    await executeAuditRun(
      {
        prisma,
        secrets,
        storage: new LocalFileStorage(artifactDir),
        explorer: new ExplorerAgent(router),
        ai: router,
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      },
      { runId: run.id, organizationId: org.id, projectId: project.id },
    );

    const finished = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    const findings = await prisma.finding.findMany({ where: { runId: run.id, suppressed: false } });
    const findingLikes: FindingLike[] = findings.map((item) => ({
      title: item.title,
      description: item.description,
      signature: item.signature,
      url: item.url,
      category: item.category,
      severity: item.severity,
    }));
    const usesAi = router.current().name !== 'heuristic';
    const exclude: Array<'readonly' | 'full' | 'ai' | 'transaction'> = [];
    if (!usesAi) exclude.push('ai');
    if (mode === 'READ_ONLY') exclude.push('full', 'transaction');
    const benchmark = scoreFindings(findingLikes);
    const reachable = scoreFindings(findingLikes, { exclude });
    return {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      mode,
      ai: usesAi ? `${router.current().name}:${router.modelFor('structured')}` : 'heuristic',
      runId: run.id,
      runStatus: finished.status,
      score: finished.qualityScore,
      findings: findings.length,
      aiCostUsd: finished.aiCostUsd,
      benchmark,
      reachableRecall: reachable.recall,
      tests: {
        generated: finished.testsGenerated,
        passed: finished.testsPassed,
        failed: finished.testsFailed,
        flaky: finished.testsFlaky,
      },
      fixtureMutations: [...fixture.mutations],
    };
  } finally {
    await fixture.close();
    if (!options.artifactDir) {
      await rm(artifactDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export function formatBenchmark(result: BenchmarkResult): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const lines = [
    `# Auditor benchmark (${result.startedAt})`,
    '',
    `Mode ${result.mode}, AI ${result.ai}, run ${result.runId} (${result.runStatus}) in ${(result.durationMs / 1000).toFixed(1)} s, AI cost $${result.aiCostUsd.toFixed(4)}`,
    '',
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Recall, all ${PLANTED_BUGS.length} planted bugs | ${pct(result.benchmark.recall)} |`,
    `| Recall, bugs reachable in this configuration | ${pct(result.reachableRecall)} |`,
    `| Precision | ${pct(result.benchmark.precision)} |`,
    `| Findings | ${result.findings} (${result.benchmark.falsePositives.length} false positives) |`,
    `| Tests | ${result.tests.generated} generated, ${result.tests.passed} passed, ${result.tests.failed} failed, ${result.tests.flaky} flaky |`,
    `| Health score | ${result.score ?? 'n/a'} |`,
    '',
    '| Bug | Needs | Caught |',
    '| --- | --- | --- |',
    ...PLANTED_BUGS.map((bug) => `| ${bug.id}: ${bug.summary} | ${bug.needs} | ${result.benchmark.detected.includes(bug.id) ? 'yes' : 'no'} |`),
  ];
  if (result.benchmark.falsePositives.length > 0) {
    lines.push('', 'False positives:', ...result.benchmark.falsePositives.map((item) => `- [${item.category}/${item.severity}] ${item.title} (${item.url ?? ''})`));
  }
  return `${lines.join('\n')}\n`;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  config({ path: resolve(import.meta.dirname, '../../../.env') });
  const args = process.argv.slice(2);
  const env = loadWorkerEnv();
  const router = args.includes('--ai')
    ? createModelRouter({
        model: env.OPENAI_MODEL,
        openaiApiKey: env.OPENAI_API_KEY,
        openaiModel: env.OPENAI_MODEL,
        geminiApiKey: env.GEMINI_API_KEY,
        geminiModel: env.GEMINI_MODEL,
        provider: env.AI_PROVIDER,
      })
    : createModelRouter({ model: 'heuristic' });
  const modeArg = args[args.indexOf('--mode') + 1];
  const mode: SafetyMode = args.includes('--mode') && modeArg === 'READ_ONLY' ? 'READ_ONLY' : 'FULL';
  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    const result = await runBenchmark({ prisma, secretsKeyHex: env.CREDENTIAL_ENCRYPTION_KEY, router, mode });
    const dir = resolve(import.meta.dirname, '../benchmark-results');
    await mkdir(dir, { recursive: true });
    const stamp = result.startedAt.replace(/[:.]/g, '-');
    await writeFile(join(dir, `${stamp}.json`), JSON.stringify(result, null, 2));
    await writeFile(join(dir, 'latest.md'), formatBenchmark(result));
    process.stdout.write(formatBenchmark(result));
  } finally {
    await prisma.$disconnect();
  }
}
