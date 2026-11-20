import {
  createModelRouter,
  FailureAnalysisAgent,
  IntentCompiler,
  REPORT_SUMMARY_PROMPT_VERSION,
  TestGenerationAgent,
  UXAnalysisAgent,
  type CompiledIntent,
} from '@auditor/ai';
import {
  AccessibilityAnalyzer,
  BugDetector,
  ConfidenceCalculator,
  DuplicateDetector,
  diffRuns,
  normalizeTitle,
  ReportGenerator,
  scoreBreakdown,
  serializeDiff,
  SeverityClassifier,
  VisualAnalyzer,
  coverageFrom,
  type ReportPayload,
} from '@auditor/analyzer';
import { currentDeviceProfile, LiveStreamer, type BlockedRequest } from '@auditor/browser';
import { reconcileQuickFindings } from './quick-scan.js';
import type { Prisma } from '@auditor/database';
import {
  catalogFromActions,
  catalogFromSemantic,
  ConsistencyCheckGenerator,
  exportPlaywrightSpec,
  mergeCatalogs,
  TestGenerator,
  TestRunner,
  testKeyFor,
  type TestRunExecution,
} from '@auditor/test-engine';
import {
  intentListSchema,
  parseTestPlan,
  selectorMetaSchema,
  type ControlProbe,
  type InteractionMap,
  type JourneyResult,
  type DiscoveredElement,
  type GeneratedTestCase,
  type SafetyMode,
  type SemanticPage,
} from '@auditor/shared';
import { appendEvent, createLivePublisher, setRunStatus, startStage, completeStage, type AuditDependencies } from './engine.js';
import { buildHtmlReport } from './html-report.js';
import { checkLinks, type BrokenLink } from './link-check.js';
import { asStringArray, resolveRunPermissions } from './safety-mode.js';
import { buildInteractionMap } from './interaction-map.js';
import { detectCategory } from './journeys/detect.js';
import { runJourneys } from './journeys/runner.js';
import { loadHistory, recordOutcome } from './test-history.js';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
type Category = 'BUG' | 'UX' | 'ACCESSIBILITY' | 'SECURITY' | 'PERFORMANCE' | 'VISUAL';

interface FindingDraft {
  title: string;
  description: string;
  severity: Severity;
  category: Category;
  confidence: number;
  expected?: string;
  actual?: string;
  recommendation?: string;
  steps?: unknown;
  signature: string;
  component?: string;
  url?: string;
  rootCauseHypothesis?: string;
  testRunId?: string;
  pageId?: string;
  /** Raw error strings behind a test failure, used to match it with page-level signals. */
  evidenceText?: string;
}

const MAX_TESTS = 40;

export async function runPostExplorationPipeline(
  deps: AuditDependencies,
  input: { runId: string; organizationId: string; projectId: string },
): Promise<void> {
  const run = await deps.prisma.run.findUnique({
    where: { id: input.runId },
    include: { project: true, environment: true },
  });
  if (!run || run.status === 'CANCELLED') {
    return;
  }

  const router = deps.ai ?? createModelRouter({ model: 'heuristic' });
  const generator = new TestGenerator(undefined, undefined, undefined, new TestGenerationAgent(router));
  const failureAgent = new FailureAnalysisAgent(router);
  const uxAgent = new UXAnalysisAgent(router);
  const safetyMode: SafetyMode = run.effectiveSafetyMode ?? 'READ_ONLY';
  const baseUrl = run.baseUrlOverride ?? run.environment?.baseUrl ?? run.project.baseUrl;
  const blockedPathPatterns = asStringArray(run.project.blockedPathPatterns);

  await setRunStatus(deps.prisma, input.runId, 'GENERATING_TESTS', { currentAction: 'Generating tests from visited screens' });
  await startStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'generate-tests' });
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'stage',
    message: 'Generating tests from the screens that were actually opened',
  });

  const [states, actions, flows, pages] = await Promise.all([
    deps.prisma.state.findMany({ where: { runId: input.runId } }),
    deps.prisma.action.findMany({ where: { runId: input.runId } }),
    deps.prisma.flow.findMany({ where: { runId: input.runId } }),
    deps.prisma.page.findMany({ where: { runId: input.runId } }),
  ]);

  const urlByStateId = new Map(states.map((state) => [state.id, state.url ?? '']));
  const semanticPages: SemanticPage[] = [];
  const catalogParts: DiscoveredElement[][] = [
    catalogFromActions(
      actions.map((action) => ({
        id: action.id,
        type: action.type,
        selector: action.selector,
        target: action.target,
        href: action.href,
        label: action.label,
        category: action.category,
        riskLevel: action.riskLevel,
        sourceStateId: action.sourceStateId,
        selectors: parseSelectors(action.selectors),
      })),
      urlByStateId,
    ),
  ];

  for (const state of states) {
    const metadata = asRecord(state.metadata);
    const elements = Array.isArray(metadata.elements) ? metadata.elements : [];
    const page: SemanticPage = {
      url: state.url ?? '',
      title: state.title ?? state.name,
      route: typeof metadata.route === 'string' ? metadata.route : '/',
      modalOpen: metadata.modalOpen === true,
      importantText: Array.isArray(metadata.importantText) ? metadata.importantText.map(String) : [],
      contentSignature: typeof metadata.contentSignature === 'string' ? metadata.contentSignature : undefined,
      elements: elements as SemanticPage['elements'],
      listItems: asStringArray(metadata.listItems),
      brokenImages: asStringArray(metadata.brokenImages),
    };
    semanticPages.push(page);
    catalogParts.push(catalogFromSemantic(page, state.id));
  }

  try {
    const storedCatalog = JSON.parse(
      (await deps.storage.get(`runs/${input.runId}/ui-catalog.json`)).toString('utf8'),
    ) as DiscoveredElement[];
    if (Array.isArray(storedCatalog)) {
      catalogParts.push(storedCatalog);
    }
  } catch {
    /* catalog file is optional */
  }

  let loginPage: SemanticPage | null = null;
  try {
    const loginRaw = JSON.parse((await deps.storage.get(`runs/${input.runId}/login-semantic.json`)).toString('utf8')) as SemanticPage;
    loginPage = {
      url: loginRaw.url,
      title: loginRaw.title ?? 'Login',
      route: loginRaw.route ?? '/login',
      modalOpen: Boolean(loginRaw.modalOpen),
      importantText: loginRaw.importantText ?? [],
      elements: loginRaw.elements ?? [],
    };
    semanticPages.push(loginPage);
    catalogParts.push(catalogFromSemantic(loginPage));
  } catch {
    /* login catalog is optional when the app has no login page */
  }

  const catalog = mergeCatalogs(...catalogParts);
  const generated = await generator.generate({
    catalog,
    flows,
    states,
    semanticPages,
    baseUrl,
    allowDestructive: run.project.allowDestructive,
  });
  await recordAiUsage(deps, input, 'test_generation', generated);

  // Consistency checks: expected results that come from the app itself.
  const appPages = semanticPages.filter((page) => page !== loginPage);
  const consistency = new ConsistencyCheckGenerator()
    .generate({
      pages: appPages,
      catalog,
      baseUrl,
      allowMutations: safetyMode === 'FULL',
      token: input.runId.slice(-6),
    })
    .filter((test) => generator.validate(test, catalog).ok);

  // User intents, compiled by the AI against discovered controls only.
  const intents = intentListSchema.safeParse(run.project.intents).success ? intentListSchema.parse(run.project.intents) : [];
  const compiled = await new IntentCompiler(router).compile({ intents, catalog, pages: appPages, baseUrl });
  await recordAiUsage(deps, input, 'intent_compilation', compiled);
  const intentTests = compiled.intents
    .filter((item): item is CompiledIntent & { test: GeneratedTestCase } => item.status === 'compiled' && Boolean(item.test))
    .map((item) => item.test);
  if (intents.length > 0) {
    const notCompiled = compiled.intents.filter((item) => item.status !== 'compiled');
    await appendEvent(deps.prisma, {
      organizationId: input.organizationId,
      runId: input.runId,
      kind: notCompiled.length > 0 ? 'warning' : 'info',
      message: `Intents: ${intentTests.length} of ${intents.filter((item) => item.enabled !== false).length} compiled into tests${
        notCompiled.length ? `; not compiled: ${notCompiled.map((item) => `"${item.text.slice(0, 60)}" (${item.reason ?? item.status})`).join('; ')}` : ''
      }`,
    });
  }

  const allTests = uniqueByName([
    ...intentTests,
    ...consistency,
    ...generated.tests.map((test) => ({ ...test, source: test.source ?? 'generated' })),
  ]).slice(0, MAX_TESTS);
  const keyed = allTests.map((test) => ({ test, testKey: testKeyFor(test) }));
  const history = await loadHistory(deps.prisma, input.projectId, keyed.map((item) => item.testKey));

  const persistedTests: Array<{ id: string; draft: GeneratedTestCase; flowId: string | null; testKey: string; quarantined: boolean }> = [];
  for (const { test, testKey } of keyed) {
    const flow = flows.find((item) => item.name === test.flowName) ?? flows[0] ?? null;
    const quarantined = history.get(testKey)?.quarantined ?? false;
    const row = await deps.prisma.testCase.create({
      data: {
        organizationId: input.organizationId,
        runId: input.runId,
        projectId: input.projectId,
        flowId: flow?.id,
        name: test.name,
        description: test.description,
        category: test.category,
        priority: test.priority,
        risk: test.risk,
        preconditions: test.preconditions,
        steps: test.steps as unknown as Prisma.InputJsonValue,
        expectedResults: test.expectedResults as unknown as Prisma.InputJsonValue,
        testKey,
        source: test.source ?? 'generated',
        intentId: test.intentId,
        quarantined,
        promptVersion: test.source === 'intent' ? compiled.promptVersion : generated.promptVersion,
        model: test.source === 'intent' ? compiled.model : generated.model,
      },
    });
    persistedTests.push({ id: row.id, draft: test, flowId: flow?.id ?? null, testKey, quarantined });
  }

  await deps.prisma.run.update({
    where: { id: input.runId },
    data: { testsGenerated: persistedTests.length },
  });
  await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'generate-tests' });

  await setRunStatus(deps.prisma, input.runId, 'EXECUTING_TESTS', { currentAction: 'executing-tests' });
  await startStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'execute-tests' });
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'stage',
    message: `Executing ${persistedTests.length} tests (${intentTests.length} from intents, ${consistency.length} consistency checks)`,
  });

  let storageState: unknown;
  if (run.storageStateKey) {
    try {
      storageState = JSON.parse((await deps.storage.get(run.storageStateKey)).toString('utf8'));
    } catch {
      storageState = undefined;
    }
  }

  const credential = await deps.prisma.credential.findFirst({
    where: { projectId: input.projectId, organizationId: input.organizationId, type: 'USERNAME_PASSWORD' },
    orderBy: { createdAt: 'asc' },
  });
  const credentials =
    credential?.type === 'USERNAME_PASSWORD' && credential.secretCiphertext
      ? {
          username: credential.username,
          password: await deps.secrets.decrypt(credential.secretCiphertext),
        }
      : undefined;

  let livePhase = 'testing';
  let currentTestName = '';
  const live = new LiveStreamer(createLivePublisher(deps, input.runId, () => livePhase), { fps: 2 });
  const runner = new TestRunner({
    onPage: async (page) => {
      await live.attach(page);
    },
    onStep: async (step, box) => {
      await live.setAction({
        kind:
          step.type === 'type'
            ? 'type'
            : step.type === 'select'
              ? 'select'
              : step.type === 'assert'
                ? 'assert'
                : step.type === 'navigate' || step.type === 'reload' || step.type === 'back'
                  ? 'navigate'
                  : step.type === 'click'
                    ? 'click'
                    : 'wait',
        label: `${currentTestName}: ${step.description}`.slice(0, 200),
        box,
      });
    },
    storage: deps.storage,
    allowPrivateTargets: run.project.allowPrivateTargets,
    recordVideo: run.project.recordVideo,
    timeoutMs: 45_000,
    retries: 1,
    safety: { mode: safetyMode, blockedPathPatterns },
  });

  const executions: Array<{
    testId: string;
    testRunId: string;
    draft: GeneratedTestCase;
    result: TestRunExecution;
    flowName?: string;
    testKey: string;
    quarantined: boolean;
    /** Journey results become findings from their checks, not from the generic failure analysis. */
    isJourney?: boolean;
  }> = [];
  let passed = 0;
  let failed = 0;
  let flaky = 0;
  let browserMs = 0;
  const blockedDuringTests: BlockedRequest[] = [];

  for (const test of persistedTests) {
    const latest = await deps.prisma.run.findUnique({ where: { id: input.runId }, select: { status: true } });
    if (latest?.status === 'CANCELLED') {
      return;
    }
    await deps.prisma.run.update({
      where: { id: input.runId },
      data: { currentAction: `Running test: ${test.draft.name}` },
    });
    await appendEvent(deps.prisma, {
      organizationId: input.organizationId,
      runId: input.runId,
      kind: 'test',
      message: `Running test: ${test.draft.name}`,
    });
    const testRun = await deps.prisma.testRun.create({
      data: {
        organizationId: input.organizationId,
        runId: input.runId,
        testCaseId: test.id,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
    currentTestName = test.draft.name;
    const result = await runner.run({
      runId: input.runId,
      testId: test.id,
      test: test.draft,
      storageState,
      credentials,
      baseUrl,
    });
    browserMs += result.durationMs;
    blockedDuringTests.push(...result.blockedRequests.slice(0, 20));
    if (result.status === 'PASSED') {
      passed += 1;
      if (result.flaky) flaky += 1;
    } else if (result.status === 'FAILED' || result.status === 'ERROR') {
      failed += 1;
    }
    const outcome = result.status === 'SKIPPED' ? 'SKIPPED' : result.flaky ? 'FLAKY' : result.status === 'PASSED' ? 'PASSED' : 'FAILED';
    const { quarantined } = await recordOutcome(deps.prisma, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      testKey: test.testKey,
      name: test.draft.name,
      outcome,
    });
    if (quarantined !== test.quarantined) {
      await deps.prisma.testCase.update({ where: { id: test.id }, data: { quarantined } });
    }
    await deps.prisma.testRun.update({
      where: { id: testRun.id },
      data: {
        status: result.status,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
        retryCount: result.retryCount,
        failureClass: result.failureClass ?? null,
        screenshotBeforeKey: result.screenshotBeforeKey,
        screenshotFailureKey: result.screenshotFailureKey,
        screenshotAfterKey: result.screenshotAfterKey,
        traceKey: result.traceKey,
        videoKey: result.videoKey,
        consoleKey: result.consoleKey,
        networkKey: result.networkKey,
        assertions: result.assertions as unknown as Prisma.InputJsonValue,
        actualResults: result.actualResults as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    for (const item of result.evidence) {
      await deps.prisma.evidence.create({
        data: {
          organizationId: input.organizationId,
          runId: input.runId,
          testRunId: testRun.id,
          type: item.type,
          storageKey: item.key,
          contentType: item.contentType,
          fileName: item.fileName,
          byteLength: item.byteLength,
        },
      });
    }
    executions.push({
      testId: test.id,
      testRunId: testRun.id,
      draft: test.draft,
      result,
      flowName: test.draft.flowName,
      testKey: test.testKey,
      quarantined: quarantined || test.quarantined,
    });
    const label = result.flaky ? 'PASSED (flaky)' : result.failureClass ? `${result.status} (${result.failureClass})` : result.status;
    await appendEvent(deps.prisma, {
      organizationId: input.organizationId,
      runId: input.runId,
      kind: 'test',
      message: `Finished "${test.draft.name}": ${label}`,
    });
  }

  await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'execute-tests' });

  // ---- Functional testing: interaction map and business journeys ----
  const plan = parseTestPlan(run.project.testPlan);
  // A one-off URL (CI preview) is never treated as staging: no orders there.
  const environmentKind = run.baseUrlOverride ? 'PRODUCTION' : (run.environment?.kind ?? 'PRODUCTION');
  const permissions = resolveRunPermissions({ kind: environmentKind, mode: safetyMode, plan });
  const detected = detectCategory(appPages);
  const category = plan.category === 'auto' ? detected.category : plan.category;
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'info',
    message: `App type: ${category}${plan.category === 'auto' ? ` (detected from ${detected.signals.slice(0, 3).join(', ') || 'no strong signals'})` : ' (set in the test plan)'}. ${permissions.transactionsReason} ${permissions.paymentReason}`,
  });

  let interactions: InteractionMap | null = null;
  if (plan.interactionMap.enabled && !(await isCancelled(deps, input.runId))) {
    await startStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'interaction-map' });
    await deps.prisma.run.update({ where: { id: input.runId }, data: { currentAction: 'Mapping what every control does' } });
    livePhase = 'probing';
    const seenScreens = new Set<string>();
    const screens = states
      .filter((state) => state.url && !/login|signin|sign-in/i.test(state.url))
      .filter((state) => {
        const key = (state.url ?? '').split('#')[0] ?? '';
        if (seenScreens.has(key)) return false;
        seenScreens.add(key);
        return true;
      })
      .map((state) => ({ url: state.url as string, title: state.title ?? state.name }));
    try {
      interactions = await buildInteractionMap({
        screens,
        baseUrl,
        storageState,
        safety: { mode: safetyMode, allowPrivate: run.project.allowPrivateTargets, blockedPathPatterns },
        allowDestructive: run.project.allowDestructive,
        maxControlsPerScreen: plan.interactionMap.maxControlsPerScreen,
        maxScreens: plan.interactionMap.maxScreens,
        budgetMs: plan.interactionMap.budgetMinutes * 60_000,
        excludeLabels: plan.interactionMap.excludeLabels,
        live,
        onProgress: (message) => appendEvent(deps.prisma, { organizationId: input.organizationId, runId: input.runId, kind: 'info', message }),
      });
      await deps.storage.put({
        key: `runs/${input.runId}/interaction-map.json`,
        body: Buffer.from(JSON.stringify(interactions)),
        contentType: 'application/json',
      });
      await appendEvent(deps.prisma, {
        organizationId: input.organizationId,
        runId: input.runId,
        kind: 'stage',
        message: `Interaction map: ${interactions.probed} controls on ${interactions.screens.length} screens (${interactions.totals.opens_overlay} popups, ${interactions.totals.navigates} links, ${interactions.totals.no_effect} with no effect, ${interactions.totals.error} errors)`,
      });
      await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'interaction-map' });
    } catch (error) {
      deps.logger.warn({ runId: input.runId, err: error }, 'interaction map failed');
      await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'interaction-map', status: 'FAILED', error: error instanceof Error ? error.message : 'failed' });
    }
  }

  let journeys: JourneyResult[] = [];
  if (!(await isCancelled(deps, input.runId))) {
    await startStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'journeys' });
    await deps.prisma.run.update({ where: { id: input.runId }, data: { currentAction: `Running ${category} journeys` } });
    livePhase = 'journeys';
    const shotsByJourney = new Map<string, Array<{ key: string; bytes: number }>>();
    try {
      journeys = await runJourneys({
        category,
        plan,
        permissions,
        baseUrl,
        storageState,
        allowPrivate: run.project.allowPrivateTargets,
        blockedPathPatterns,
        token: input.runId.slice(-6),
        // Tool sites get longer: every tool is its own feature, tried with a real file.
        budgetMs: (category === 'tools' ? 25 : 12) * 60_000,
        live,
        saveShot: async (journeyId, name, body) => {
          const key = `runs/${input.runId}/journeys/${journeyId.replace(/[^a-z0-9_-]/gi, '_')}/${name}.png`;
          await deps.storage.put({ key, body, contentType: 'image/png' });
          const list = shotsByJourney.get(journeyId) ?? [];
          list.push({ key, bytes: body.byteLength });
          shotsByJourney.set(journeyId, list);
          return { key, bytes: body.byteLength };
        },
        onProgress: (message) => appendEvent(deps.prisma, { organizationId: input.organizationId, runId: input.runId, kind: 'test', message }),
      });
    } catch (error) {
      deps.logger.warn({ runId: input.runId, err: error }, 'journeys failed');
    }
    // Store each journey as a test with its step screenshots as evidence.
    for (const journey of journeys) {
      const testCase = await deps.prisma.testCase.create({
        data: {
          organizationId: input.organizationId,
          runId: input.runId,
          projectId: input.projectId,
          name: `Journey: ${journey.name}`.slice(0, 200),
          description: journey.reason ?? `${journey.category} journey (${journey.requires})`,
          category: 'HAPPY_PATH',
          priority: journey.requires === 'readonly' ? 'MEDIUM' : 'HIGH',
          risk: journey.requires === 'readonly' ? 'SAFE' : 'CAUTION',
          steps: journey.steps.map((step) => ({ id: String(step.index), type: 'journey', description: step.goal })) as unknown as Prisma.InputJsonValue,
          expectedResults: journey.steps.flatMap((step) => (step.checks ?? []).map((check) => check.name)) as unknown as Prisma.InputJsonValue,
          testKey: `journey:${journey.id}`,
          source: 'journey',
        },
      });
      const status =
        journey.status === 'passed' ? 'PASSED' : journey.status === 'failed' ? 'FAILED' : journey.status === 'partial' ? 'ERROR' : 'SKIPPED';
      const testRun = await deps.prisma.testRun.create({
        data: {
          organizationId: input.organizationId,
          runId: input.runId,
          testCaseId: testCase.id,
          status,
          failureClass: status === 'FAILED' ? 'APP_BUG' : status === 'ERROR' ? 'TEST_BUG' : null,
          errorMessage: journey.reason ?? journey.steps.find((step) => step.status !== 'passed')?.detail ?? null,
          durationMs: journey.durationMs,
          startedAt: new Date(Date.now() - journey.durationMs),
          completedAt: new Date(),
          actualResults: journey.steps.map((step) => `${step.status}: ${step.goal}${step.detail ? ` (${step.detail})` : ''}`) as unknown as Prisma.InputJsonValue,
        },
      });
      for (const step of journey.steps) {
        if (!step.screenshotKey) continue;
        const evidence = await deps.prisma.evidence.create({
          data: {
            organizationId: input.organizationId,
            runId: input.runId,
            testRunId: testRun.id,
            type: 'SCREENSHOT',
            storageKey: step.screenshotKey,
            contentType: 'image/png',
            fileName: `${journey.id}-step-${step.index}.png`,
            byteLength: shotsByJourney.get(journey.id)?.find((shot) => shot.key === step.screenshotKey)?.bytes ?? 0,
          },
        });
        step.evidenceId = evidence.id;
      }
      if (status === 'PASSED') passed += 1;
      if (status === 'FAILED') failed += 1;
      executions.push({
        testId: testCase.id,
        testRunId: testRun.id,
        draft: {
          name: testCase.name,
          description: testCase.description ?? '',
          category: 'HAPPY_PATH',
          priority: 'HIGH',
          risk: 'SAFE',
          preconditions: [],
          steps: [{ id: 'journey', type: 'wait', description: journey.name }],
          expectedResults: ['Journey passes'],
          source: 'ai',
        },
        result: {
          status: status === 'ERROR' ? 'ERROR' : status,
          failureClass: status === 'FAILED' ? 'APP_BUG' : status === 'ERROR' ? 'TEST_BUG' : undefined,
          errorMessage: testRun.errorMessage ?? undefined,
          durationMs: journey.durationMs,
          retryCount: 0,
          assertions: [],
          actualResults: [],
          evidence: [],
          httpFailures: [],
          consoleErrors: [],
          pageErrors: [],
          blockedRequests: [],
        },
        flowName: undefined,
        testKey: `journey:${journey.id}`,
        quarantined: false,
        isJourney: true,
      });
    }
    await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'journeys' });
  }

  await deps.prisma.run.update({
    where: { id: input.runId },
    data: { testsGenerated: persistedTests.length + journeys.length, testsPassed: passed, testsFailed: failed, testsFlaky: flaky },
  });

  livePhase = 'analyzing';
  await live.setAction({ kind: 'info', label: 'All tests finished. Checking links and analyzing results' });
  await live.stop();
  await setRunStatus(deps.prisma, input.runId, 'ANALYZING', { currentAction: 'analyzing' });
  await startStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'analyze' });
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'stage',
    message: 'Checking links, then analyzing failures, UX, accessibility, and visual issues',
  });

  const bugDetector = new BugDetector();
  const confidence = new ConfidenceCalculator();
  const duplicates = new DuplicateDetector();
  const a11y = new AccessibilityAnalyzer();
  const visual = new VisualAnalyzer();
  const drafts: FindingDraft[] = [];
  const targetHost = new URL(baseUrl).host;
  const intentById = new Map(intents.map((intent) => [intent.id, intent]));

  // 1. Test failures. Only failures classified as application bugs become findings.
  for (const execution of executions) {
    const result = execution.result;
    if (result.status === 'PASSED' || result.status === 'SKIPPED') {
      continue;
    }
    if (result.failureClass !== 'APP_BUG' || execution.quarantined || execution.isJourney) {
      continue;
    }
    const signals = bugDetector.detect({
      httpFailures: result.httpFailures.filter((item) => sameSite(item.url, targetHost)),
      pageErrors: result.pageErrors,
      assertionMessage: result.errorMessage,
      timeout: /timeout/i.test(result.errorMessage ?? ''),
      url: result.url,
    });
    const analysis = await failureAgent.analyze({
      testName: execution.draft.name,
      category: execution.draft.category,
      steps: execution.draft.steps,
      expected: execution.draft.expectedResults,
      actual: result.actualResults.join('\n') || result.errorMessage || 'Unexpected failure',
      errorMessage: result.errorMessage,
      url: result.url,
      console: result.consoleErrors,
      network: result.httpFailures,
      httpFailures: result.httpFailures,
      pageErrors: result.pageErrors,
      screenshotAvailable: Boolean(result.screenshotFailureKey),
    });
    await recordAiUsage(deps, input, 'failure_analysis', { ...analysis, model: analysis.model ?? undefined });
    const intent = execution.draft.intentId ? intentById.get(execution.draft.intentId) : undefined;
    const failedKind = result.assertions.find((item) => !item.passed)?.kind ?? 'error';
    const isConsistency = execution.draft.source === 'consistency';
    const severity: Severity =
      intent || isConsistency ? maxSeverity(analysis.analysis.severity, 'MEDIUM') : analysis.analysis.severity;
    drafts.push({
      title: intent
        ? `Intent not met: ${intent.text}`.slice(0, 240)
        : isConsistency
          ? `${execution.draft.name} failed`.slice(0, 240)
          : analysis.analysis.title,
      description: intent
        ? `The app does not do what this intent describes: "${intent.text}". ${analysis.analysis.summary}`
        : analysis.analysis.summary,
      severity,
      category: intent || isConsistency ? 'BUG' : analysis.analysis.category,
      confidence: confidence.calculate({
        deterministic: signals.length > 0 || isConsistency,
        screenshot: Boolean(result.screenshotFailureKey),
        console: result.pageErrors.length > 0,
        network: result.httpFailures.length > 0,
        reproduced: result.retryCount > 0,
      }),
      expected: execution.draft.expectedResults.join('; '),
      actual: analysis.analysis.actual,
      recommendation: analysis.analysis.recommendation,
      steps: execution.draft.steps,
      signature: `test|${execution.testKey}|${failedKind}`,
      url: result.url,
      rootCauseHypothesis: analysis.analysis.rootCauseHypothesis,
      testRunId: execution.testRunId,
      evidenceText: [
        ...result.pageErrors,
        ...result.httpFailures.map((item) => `HTTP ${item.status ?? 'error'} for ${item.url}`),
      ].join(' | '),
    });
  }

  // 2. Page-level evidence gathered during exploration.
  const severityClassifier = new SeverityClassifier();
  // Broken images are grouped by the host that serves them: one image supplier
  // failing on every category page is one problem, not one per page.
  const brokenByHost = new Map<string, { pages: Array<{ url: string; id: string }>; images: Set<string> }>();
  for (const page of pages) {
    let html: string | null = null;
    if (page.domStorageKey) {
      try {
        html = (await deps.storage.get(page.domStorageKey)).toString('utf8');
      } catch {
        html = null;
      }
    }
    const semantic = semanticPages.find((item) => item.url === page.url) ?? null;
    for (const issue of a11y.analyze([{ url: page.url, html, semantic }])) {
      drafts.push({
        title: issue.title,
        description: issue.description,
        severity: 'MEDIUM',
        category: 'ACCESSIBILITY',
        confidence: issue.confidence,
        recommendation: issue.recommendation,
        signature: `a11y|${pathOf(issue.url)}|${issue.component ?? ''}|${normalizeTitle(issue.title)}`,
        component: issue.component,
        url: issue.url,
        pageId: page.id,
      });
    }
    if (semantic) {
      for (const issue of visual.analyze([semantic], {
        viewport: currentDeviceProfile().mobile ? 'mobile' : 'desktop',
        width: currentDeviceProfile().context.viewport?.width,
      })) {
        drafts.push({
          title: issue.title,
          description: issue.description,
          severity: 'LOW',
          category: 'VISUAL',
          confidence: issue.confidence,
          recommendation: issue.recommendation,
          signature: `visual|${pathOf(issue.url)}|${normalizeTitle(issue.title)}`,
          url: issue.url,
          pageId: page.id,
        });
      }
    }
    if (page.screenshotKey) {
      try {
        const telemetry = JSON.parse(
          (await deps.storage.get(`runs/${input.runId}/telemetry/${telemetryFingerprint(page.screenshotKey)}.json`)).toString('utf8'),
        ) as {
          pageErrors?: unknown[];
          networkFailures?: Array<{ url: string; status?: number; method?: string }>;
          brokenImages?: string[];
        };
        const pageErrors = (telemetry.pageErrors ?? []).map((item) =>
          typeof item === 'string' ? item : String((item as { text?: unknown })?.text ?? ''),
        );
        const signals = bugDetector.detect({
          pageErrors: pageErrors.filter(Boolean),
          httpFailures: (telemetry.networkFailures ?? []).filter(
            (item) => sameSite(item.url, targetHost) && (item.status ?? 0) >= 500,
          ),
          url: page.url,
        });
        for (const signal of signals) {
          drafts.push({
            title: signal.message.slice(0, 240),
            description: signal.message,
            severity: severityClassifier.classify([signal]),
            category: 'BUG',
            confidence: confidence.calculate({
              deterministic: true,
              network: signal.kind.startsWith('http'),
              console: signal.kind === 'uncaught_js',
            }),
            recommendation: 'Inspect the captured console and network evidence for this page.',
            signature: `page|${pathOf(page.url)}|${signal.kind}|${normalizeTitle(signal.message).slice(0, 80)}`,
            url: page.url,
            pageId: page.id,
          });
        }
        const brokenImages = [...new Set([...(telemetry.brokenImages ?? []), ...(semantic?.brokenImages ?? [])])];
        for (const image of brokenImages) {
          let host = '';
          try {
            host = new URL(image).host;
          } catch {
            /* relative or data URL: grouped under the page's own host */
          }
          const group = brokenByHost.get(host) ?? { pages: [], images: new Set<string>() };
          group.images.add(image);
          if (!group.pages.some((item) => item.id === page.id)) group.pages.push({ url: page.url, id: page.id });
          brokenByHost.set(host, group);
        }
        const missingAssets = (telemetry.networkFailures ?? []).filter(
          (item) =>
            sameSite(item.url, targetHost) &&
            (item.status === 404 || item.status === 410) &&
            !brokenImages.some((image) => image === item.url) &&
            pathOf(item.url) !== pathOf(page.url),
        );
        if (missingAssets.length > 0) {
          const urls = [...new Set(missingAssets.map((item) => item.url))];
          drafts.push({
            title: `${urls.length} missing resource${urls.length === 1 ? '' : 's'} on ${pathOf(page.url)}`,
            description: `The page requested files that return 404: ${urls.slice(0, 10).join(', ')}`,
            severity: 'LOW',
            category: 'BUG',
            confidence: 0.85,
            recommendation: 'Remove the references or restore the files.',
            signature: `asset|${pathOf(page.url)}|${urls.map(pathOf).sort().join(',').slice(0, 200)}`,
            url: page.url,
            pageId: page.id,
          });
        }
      } catch {
        /* telemetry is best-effort */
      }
    }
  }
  for (const [host, group] of brokenByHost) {
    const images = [...group.images];
    const first = group.pages[0]!;
    const onePage = group.pages.length === 1;
    const fromHost = host && host !== targetHost ? ` from ${host}` : '';
    drafts.push({
      title: onePage
        ? `${images.length} broken image${images.length === 1 ? '' : 's'}${fromHost} on ${pathOf(first.url)}`
        : `${images.length} broken images${fromHost} on ${group.pages.length} pages`,
      description: `These images did not load: ${images.slice(0, 10).join(', ')}${images.length > 10 ? ', …' : ''}.${
        onePage ? '' : ` Pages: ${group.pages.slice(0, 10).map((item) => pathOf(item.url)).join(', ')}${group.pages.length > 10 ? ', …' : ''}.`
      }`,
      severity: 'MEDIUM',
      category: 'VISUAL',
      confidence: 0.9,
      recommendation: fromHost
        ? `Check the image links from ${host}: they return errors or non-image content. Host the images yourself or fix the supplier links.`
        : 'Fix the image URLs or upload the missing files.',
      signature: onePage ? `img|${pathOf(first.url)}|${images.map(pathOf).sort().join(',').slice(0, 200)}` : `img-host|${host}`,
      url: first.url,
      pageId: first.id,
    });
  }

  // 3. Same-origin link integrity.
  let linkReport: { checked: number; broken: BrokenLink[]; skippedUnsafe: number } = { checked: 0, broken: [], skippedUnsafe: 0 };
  try {
    linkReport = await checkLinks({ pages: appPages, baseUrl, storageState });
  } catch (error) {
    deps.logger.warn({ runId: input.runId, err: error }, 'link check failed');
  }
  for (const link of linkReport.broken) {
    drafts.push({
      title: `Broken link: ${pathOf(link.url)} ${link.status ? `returns ${link.status}` : 'does not load'}`,
      description: `"${link.label}" on ${pathOf(link.linkedFrom)} points to ${link.url}, which ${
        link.status ? `returns HTTP ${link.status}` : `failed: ${link.error ?? 'unknown error'}`
      }.`,
      severity: link.status && link.status >= 500 ? 'HIGH' : 'MEDIUM',
      category: 'BUG',
      confidence: 0.95,
      expected: 'The linked page loads',
      actual: link.status ? `HTTP ${link.status}` : (link.error ?? 'Request failed'),
      recommendation: 'Fix the link target or remove the link.',
      signature: `link|${pathOf(link.url)}|${link.status ?? 'error'}`,
      url: link.linkedFrom,
    });
  }

  // 4. UX review (AI when configured, heuristics otherwise).
  const uxPages = semanticPages.map((page) => ({
    url: page.url,
    title: page.title,
    text: page.importantText,
    hasForm: page.elements.some((element) => element.type === 'input' || element.type === 'form'),
    hasTable: /table|users/i.test(`${page.title} ${page.route}`),
    rowCount: page.importantText.filter((item) => item.includes('@')).length,
    errorText: page.importantText.filter((item) => /error|invalid|nope|failed/i.test(item)),
  }));
  const ux = await uxAgent.analyze({
    pages: uxPages,
    failedTests: executions.filter((item) => item.result.status !== 'PASSED').map((item) => item.draft.name),
  });
  await recordAiUsage(deps, input, 'ux_analysis', { ...ux, model: ux.model ?? undefined });
  for (const finding of ux.analysis.findings) {
    drafts.push({
      title: finding.title,
      description: finding.description,
      severity: 'LOW',
      category: 'UX',
      confidence: finding.confidence,
      recommendation: finding.recommendation,
      signature: `ux|${pathOf(finding.url)}|${finding.component ?? ''}|${normalizeTitle(finding.title).slice(0, 80)}`,
      component: finding.component,
      url: finding.url,
    });
  }

  // 4b. Interaction map: broken popups, erroring or dead controls. The same
  //     control on pages built from one template (/store/p/1, /store/p/2) is one
  //     finding, and an error that a test or link check already reported is not
  //     reported again.
  const reportedLines = drafts.map((draft) => routeTemplate(`${draft.title} ${draft.description} ${draft.actual ?? ''} ${draft.url ?? ''}`));
  const alreadyReported = (detail: string): boolean => {
    const uncaught = /^Uncaught error: (.+)$/.exec(detail)?.[1];
    if (uncaught) return reportedLines.some((line) => line.includes(routeTemplate(uncaught.slice(0, 80))));
    const status = /\b([45]\d\d)\b/.exec(detail)?.[1];
    const path = /(\/[\w\-./~%]*)/.exec(detail)?.[1];
    if (!status || !path) return false;
    const template = routeTemplate(path);
    return reportedLines.some((line) => line.includes(template) && line.includes(status));
  };
  const mapGroups = new Map<string, { kind: 'error' | 'stuck' | 'escape' | 'dead'; control: ControlProbe; pages: string[]; firstUrl: string }>();
  const addToGroup = (kind: 'error' | 'stuck' | 'escape' | 'dead', control: ControlProbe, url: string) => {
    // A popup is one component wherever it opens, so it is grouped site-wide;
    // buttons and errors are grouped per page template.
    const where = kind === 'stuck' || kind === 'escape' ? `popup:${(control.overlay?.title ?? '').toLowerCase()}` : routeTemplate(pathOf(url).split('?')[0] ?? '');
    const key = `${kind}|${where}|${control.label.toLowerCase()}|${routeTemplate(control.detail).replace(/\d+/g, '#')}`;
    const group = mapGroups.get(key);
    if (group) {
      if (!group.pages.includes(pathOf(url))) group.pages.push(pathOf(url));
    } else {
      mapGroups.set(key, { kind, control, pages: [pathOf(url)], firstUrl: url });
    }
  };
  for (const screen of interactions?.screens ?? []) {
    for (const control of screen.controls) {
      if (control.outcome === 'error' && !alreadyReported(control.detail)) addToGroup('error', control, screen.url);
      if (control.overlay && !control.overlay.closed) addToGroup('stuck', control, screen.url);
      else if (control.overlay && control.overlay.escapeCloses === false && (control.overlay.kind === 'dialog' || control.overlay.kind === 'drawer')) {
        addToGroup('escape', control, screen.url);
      }
      if (control.outcome === 'no_effect' && control.kind !== 'link' && control.kind !== 'select' && !/^(prev|previous|next|‹|›|«|»)$/i.test(control.label.trim())) {
        addToGroup('dead', control, screen.url);
      }
    }
  }
  for (const [key, { kind, control, pages, firstUrl }] of mapGroups) {
    const where = `"${control.label}" on ${pages[0]}${pages.length > 1 ? ` and ${pages.length - 1} other page${pages.length > 2 ? 's' : ''}` : ''}`;
    const alsoOn = pages.length > 1 ? ` Seen on: ${pages.slice(0, 8).join(', ')}${pages.length > 8 ? ', …' : ''}.` : '';
    const common = { url: firstUrl, signature: `map|${key}`.slice(0, 250) };
    if (kind === 'error') {
      drafts.push({
        ...common,
        title: `Clicking ${where} causes an error`.slice(0, 240),
        description: `${control.detail}. Reproduce: open ${firstUrl} and activate "${control.label}".${alsoOn}`,
        severity: control.status && control.status < 500 ? 'MEDIUM' : 'HIGH',
        category: 'BUG',
        confidence: 0.85,
        expected: 'The control works without an error',
        actual: control.detail,
        recommendation: 'Fix the error the control triggers, or remove the control.',
      });
    } else if (kind === 'stuck') {
      drafts.push({
        ...common,
        title: `Popup "${control.overlay?.title || control.label}" cannot be closed`.slice(0, 240),
        description: `Opened by ${where}. Its close button, Escape and a click outside all left it open.${alsoOn}`,
        severity: 'MEDIUM',
        category: 'BUG',
        confidence: 0.8,
        expected: 'The popup closes with its close button or Escape',
        actual: 'It stayed open',
        recommendation: 'Give the popup a working close button and close it on Escape.',
      });
    } else if (kind === 'escape') {
      drafts.push({
        ...common,
        title: `Popup "${control.overlay?.title || control.label}" does not close with Escape`.slice(0, 240),
        description: `Opened by ${where}. It closes with its close button but not with the Escape key, which keyboard users rely on.${alsoOn}`,
        severity: 'LOW',
        category: 'ACCESSIBILITY',
        confidence: 0.85,
        expected: 'Escape closes the dialog',
        actual: 'Escape does nothing',
        recommendation: 'Close the dialog on Escape (WAI-ARIA dialog pattern).',
      });
    } else {
      drafts.push({
        ...common,
        title: `Button ${where} does nothing`.slice(0, 240),
        description: `Clicking it caused no navigation, popup, content change or request.${alsoOn}`,
        severity: 'LOW',
        category: 'UX',
        confidence: 0.55,
        expected: 'Visible feedback after clicking',
        actual: 'Nothing happened',
        recommendation: 'Wire the button up, disable it, or remove it.',
      });
    }
  }

  // 4c. Journeys: every failed business check is a finding.
  for (const journey of journeys) {
    for (const step of journey.steps) {
      for (const check of step.checks ?? []) {
        if (check.passed) continue;
        const money = /total|price|subtotal|quantity|order|payment|cart/i.test(check.name);
        // On tool sites each tool is its own feature: one finding per tool page, and a
        // tool that does not do its job is a broken core feature.
        const perTool = journey.category === 'tools';
        const toolBroken = perTool && /produces a result|runs without an error|still works after|finishes loading/i.test(check.name);
        const where = step.url ? pathOf(step.url) : '';
        // Written for people: the journey's own explanation when it gave one, otherwise a
        // plain sentence built from the check (check names state what should be true).
        const explain = check.explain;
        const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
        const plainSteps = explain?.steps.length
          ? explain.steps
          : journey.steps.slice(0, step.index).map((item) => `${item.goal}.`);
        drafts.push({
          title: (explain?.title ?? `${journey.name}: check failed — ${lower(check.name)}`).slice(0, 240),
          description:
            explain?.summary ??
            `While “${lower(step.goal)}”, Snaghunt expected that ${lower(check.name)}${check.expected ? ` (${check.expected})` : ''}, but found ${check.actual ?? 'otherwise'}.`,
          severity: money || toolBroken ? 'HIGH' : 'MEDIUM',
          category: 'BUG',
          confidence: 0.9,
          expected: explain?.expected ?? check.expected,
          actual: explain?.actual ?? check.actual,
          recommendation: explain?.fix ?? 'Follow the steps below and compare with the screenshot of the failing step.',
          steps: plainSteps.map((text, index) => ({ id: String(index + 1), type: 'journey', description: text })),
          signature: `journey|${journey.id}|${check.name.replace(/\(.*\)/, '').trim().toLowerCase().slice(0, 100)}${perTool ? `|${where}` : ''}`,
          url: step.url,
          testRunId: executions.find((item) => item.testKey === `journey:${journey.id}`)?.testRunId,
        });
      }
    }
  }

  // 5. One finding per root cause: a test failure and the page-level signal for
  //    the same HTTP 500 / uncaught error on the same path are the same bug.
  const merged = collapseRootCauses(duplicates.merge(drafts));

  // 6. Remembered "not a bug" decisions and run-to-run diff.
  const suppressions = await deps.prisma.findingSuppression.findMany({ where: { projectId: input.projectId } });
  const suppressed = new Set(suppressions.map((item) => item.signature));
  const previousRun = await deps.prisma.run.findFirst({
    where: { projectId: input.projectId, status: 'COMPLETED', id: { not: input.runId }, createdAt: { lt: run.createdAt } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const previousFindings = previousRun
    ? await deps.prisma.finding.findMany({
        where: { runId: previousRun.id, suppressed: false },
        select: { signature: true, title: true, severity: true, category: true, url: true },
      })
    : [];
  const olderSignatures = previousRun
    ? await deps.prisma.finding.findMany({
        where: {
          projectId: input.projectId,
          runId: { notIn: [previousRun.id, input.runId] },
          run: { createdAt: { lt: run.createdAt } },
          signature: { not: null },
        },
        select: { signature: true },
        distinct: ['signature'],
        take: 5000,
      })
    : [];
  const active = merged.filter((draft) => !suppressed.has(draft.signature));
  const diff = diffRuns({
    current: active.map((draft) => ({ signature: draft.signature, title: draft.title, severity: draft.severity, category: draft.category, url: draft.url })),
    previous: previousFindings
      .filter((item): item is typeof item & { signature: string } => Boolean(item.signature))
      .map((item) => ({ signature: item.signature, title: item.title, severity: item.severity, category: item.category, url: item.url })),
    previousRunId: previousRun?.id ?? null,
    olderSignatures: olderSignatures.map((item) => item.signature).filter((item): item is string => Boolean(item)),
  });

  const createdFindings: Array<{
    id: string;
    title: string;
    severity: Severity;
    category: Category;
    recommendation?: string | null;
    confidence: number;
    suppressed: boolean;
  }> = [];
  for (const draft of merged) {
    const isSuppressed = suppressed.has(draft.signature);
    const finding = await deps.prisma.finding.create({
      data: {
        organizationId: input.organizationId,
        runId: input.runId,
        projectId: input.projectId,
        testRunId: draft.testRunId,
        pageId: draft.pageId,
        title: draft.title.slice(0, 240),
        description: draft.description,
        severity: draft.severity,
        category: draft.category,
        confidence: draft.confidence,
        expected: draft.expected,
        actual: draft.actual,
        recommendation: draft.recommendation,
        steps: draft.steps as unknown as Prisma.InputJsonValue | undefined,
        signature: draft.signature,
        component: draft.component,
        url: draft.url,
        rootCauseHypothesis: draft.rootCauseHypothesis,
        suppressed: isSuppressed,
        status: isSuppressed ? 'DISMISSED' : 'OPEN',
        change: diff.changes.get(draft.signature) ?? 'NEW',
      },
    });
    createdFindings.push({ ...finding, suppressed: isSuppressed });
    if (draft.testRunId) {
      const shots = await deps.prisma.evidence.findMany({
        where: { testRunId: draft.testRunId, type: 'SCREENSHOT' },
        take: 3,
      });
      for (const shot of shots) {
        await deps.prisma.evidence.update({ where: { id: shot.id }, data: { findingId: finding.id } });
      }
    }
  }
  const visibleFindings = createdFindings.filter((item) => !item.suppressed);

  // 7. Coverage, score, export, report.
  const testedFlowNames = executions.map((item) => item.flowName).filter((item): item is string => Boolean(item));
  const successfulFlowNames = executions
    .filter((item) => item.result.status === 'PASSED')
    .map((item) => item.flowName)
    .filter((item): item is string => Boolean(item));
  const failedFlowNames = executions
    .filter((item) => item.result.status !== 'PASSED' && item.result.status !== 'SKIPPED')
    .map((item) => item.flowName)
    .filter((item): item is string => Boolean(item));
  const coverage = coverageFrom({
    discoveredFlows: flows.length,
    testedFlowNames,
    successfulFlowNames,
    failedFlowNames,
  });
  const usages = await deps.prisma.aiUsage.findMany({ where: { runId: input.runId } });
  const aiCostUsd = usages.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
  const storageBytesEstimate =
    (await deps.prisma.evidence.aggregate({ where: { runId: input.runId }, _sum: { byteLength: true } }))._sum.byteLength ?? 0;
  const breakdown = scoreBreakdown({ findings: visibleFindings, screensExplored: states.length });
  const score = breakdown.score;

  const exportKey = `runs/${input.runId}/snaghunt.spec.ts`;
  try {
    const exportable = executions
      .filter((item) => item.result.status !== 'SKIPPED' || item.draft.mutates)
      .map((item) => item.draft);
    await deps.storage.put({
      key: exportKey,
      body: Buffer.from(
        exportPlaywrightSpec(exportable, { baseUrl, projectName: run.project.name, runId: input.runId }),
      ),
      contentType: 'text/plain; charset=utf-8',
    });
  } catch (error) {
    deps.logger.warn({ runId: input.runId, err: error }, 'playwright export failed');
  }

  let blockedDuringExploration: BlockedRequest[] = [];
  try {
    blockedDuringExploration = JSON.parse(
      (await deps.storage.get(`runs/${input.runId}/blocked-requests.json`)).toString('utf8'),
    ) as BlockedRequest[];
  } catch {
    blockedDuringExploration = [];
  }
  const blockedAll = [...blockedDuringExploration, ...blockedDuringTests];

  const counts = { critical: 0, high: 0 };
  for (const item of visibleFindings) {
    if (item.severity === 'CRITICAL') counts.critical += 1;
    if (item.severity === 'HIGH') counts.high += 1;
  }
  const diffSummary = diff.previousRunId
    ? ` Since the previous run: ${diff.newFindings.length} new, ${diff.regressed.length} regressed, ${diff.fixed.length} fixed.`
    : ' This is the first completed run for this project, so there is nothing to compare against yet.';
  let summary = `Health score ${score}/100 with ${counts.critical} critical and ${counts.high} high findings across ${states.length} screens.${diffSummary}`;
  if (router.current().name !== 'heuristic') {
    try {
      const text = await router.generateText({
        messages: [
          {
            role: 'system',
            content:
              'Write a short executive summary of an application audit in 3 sentences. Use only the provided numbers. Lead with what changed since the previous run when that data exists. Do not invent counts or change the score.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              score,
              screens: states.length,
              findings: visibleFindings.length,
              critical: counts.critical,
              high: counts.high,
              sincePreviousRun: diff.previousRunId
                ? { new: diff.newFindings.length, regressed: diff.regressed.length, fixed: diff.fixed.length }
                : null,
              tests: { passed, failed, flaky },
              coverage,
            }),
          },
        ],
        model: router.modelFor('summary'),
        maxTokens: 250,
      });
      summary = text.content;
      await recordAiUsage(deps, input, 'report_summary', { ...text, promptVersion: REPORT_SUMMARY_PROMPT_VERSION });
    } catch {
      /* keep deterministic summary */
    }
  }

  const base: ReportPayload = new ReportGenerator().build({
    score,
    findings: visibleFindings,
    coverage,
    testedFlows: [...new Set(testedFlowNames)],
    cost: { aiCostUsd, browserDurationMs: browserMs, storageBytesEstimate },
    summary,
  });
  const byClass = (cls: string) =>
    executions.filter((item) => item.result.failureClass === cls).map((item) => ({ name: item.draft.name, error: item.result.errorMessage ?? null }));
  const payload = {
    ...base,
    version: 2,
    scoreBreakdown: breakdown,
    diff: serializeDiff(diff),
    safety: {
      mode: safetyMode,
      requestedMode: run.project.safetyMode,
      blockedCount: blockedAll.length,
      blockedSample: blockedAll.slice(0, 15),
    },
    tests: {
      total: executions.length,
      passed,
      failed,
      flaky,
      skipped: executions.filter((item) => item.result.status === 'SKIPPED').map((item) => ({ name: item.draft.name, reason: item.result.errorMessage ?? null })),
      appBugs: byClass('APP_BUG').length,
      needsRepair: byClass('TEST_BUG'),
      environment: byClass('ENVIRONMENT'),
      flakyTests: executions.filter((item) => item.result.flaky).map((item) => item.draft.name),
      quarantined: executions.filter((item) => item.quarantined).map((item) => item.draft.name),
      bySource: countBy(executions.map((item) => item.draft.source ?? 'generated')),
    },
    intents: compiled.intents.map((item) => {
      const execution = executions.find((entry) => entry.draft.intentId === item.intentId);
      return {
        id: item.intentId,
        text: item.text,
        status: item.status,
        reason: item.reason ?? null,
        result: execution ? (execution.result.flaky ? 'FLAKY' : execution.result.status) : null,
        detail: execution?.result.errorMessage ?? null,
      };
    }),
    links: { checked: linkReport.checked, broken: linkReport.broken.length, skippedUnsafe: linkReport.skippedUnsafe },
    category: { detected: detected.category, used: category, signals: detected.signals },
    environment: {
      kind: permissions.kind,
      mode: permissions.mode,
      transactionsAllowed: permissions.transactionsAllowed,
      transactionsReason: permissions.transactionsReason,
      paymentAllowed: permissions.paymentAllowed,
      paymentReason: permissions.paymentReason,
    },
    interactions: interactions
      ? {
          ...interactions,
          screens: interactions.screens.map((screen) => ({ ...screen, controls: screen.controls.slice(0, 120) })),
        }
      : null,
    journeys,
    exportKey,
    suppressedCount: createdFindings.length - visibleFindings.length,
    baseUrl,
    replayOfRunId: run.replayOfRunId,
  };

  await deps.prisma.report.upsert({
    where: { runId: input.runId },
    create: {
      organizationId: input.organizationId,
      runId: input.runId,
      projectId: input.projectId,
      qualityScore: score,
      summary,
      payload: payload as unknown as Prisma.InputJsonValue,
      promptVersion: REPORT_SUMMARY_PROMPT_VERSION,
      model: router.current().name,
    },
    update: {
      qualityScore: score,
      summary,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });

  // Quick-scan snags that the full audit found again are folded into the full findings.
  await reconcileQuickFindings(deps, input.runId).catch((error) =>
    deps.logger.warn({ runId: input.runId, err: error }, 'could not merge quick scan findings'),
  );

  try {
    await buildHtmlReport(deps, input.runId);
  } catch (error) {
    deps.logger.warn({ runId: input.runId, err: error }, 'HTML report failed');
  }

  const startedAt = run.startedAt ?? run.createdAt;
  await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'analyze' });
  await deps.prisma.run.updateMany({
    where: { id: input.runId, status: { not: 'CANCELLED' } },
    data: {
      status: 'COMPLETED',
      qualityScore: score,
      aiCostUsd,
      previousRunId: previousRun?.id ?? null,
      browserDurationMs: Math.max(browserMs, Date.now() - startedAt.getTime()),
      storageBytesEstimate,
      currentAction: null,
      completedAt: new Date(),
    },
  });
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'stage',
    message: `Audit complete. Score ${score}/100 with ${visibleFindings.length} findings.${diffSummary}`,
  });
}

async function recordAiUsage(
  deps: AuditDependencies,
  input: { runId: string; organizationId: string },
  purpose: string,
  usage: {
    model?: string;
    promptVersion?: string;
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
    estimatedCostUsd?: number;
  },
): Promise<void> {
  if (!usage.model || usage.model === 'heuristic') {
    return;
  }
  await deps.prisma.aiUsage.create({
    data: {
      organizationId: input.organizationId,
      runId: input.runId,
      purpose,
      promptVersion: usage.promptVersion,
      model: usage.model,
      promptTokens: usage.promptTokens ?? 0,
      completionTokens: usage.completionTokens ?? 0,
      latencyMs: usage.latencyMs ?? 0,
      estimatedCostUsd: usage.estimatedCostUsd ?? 0,
    },
  });
}

/**
 * A failing test and the page-level signal it triggered describe one bug. Keep
 * the test finding (it has steps and evidence) and drop page-level BUG drafts
 * on the same path that report the same HTTP 5xx or uncaught error.
 */
function collapseRootCauses(drafts: FindingDraft[]): FindingDraft[] {
  const testEvidence = drafts
    .filter((draft) => draft.signature.startsWith('test|') && draft.evidenceText)
    .map((draft) => draft.evidenceText as string);
  const serverErrorPaths = new Set(
    drafts.filter((draft) => /^page\|[^|]*\|http_500\|/.test(draft.signature)).map((draft) => draft.signature.split('|')[1]),
  );
  return drafts.filter((draft) => {
    if (draft.signature.startsWith('page|')) {
      const key = draft.description.slice(0, 120);
      return !testEvidence.some((text) => text.includes(key));
    }
    if (draft.signature.startsWith('link|')) {
      // "Broken link to /reports (500)" and "/reports returns 500" are one bug.
      const [, path, status] = draft.signature.split('|');
      return !(Number(status) >= 500 && serverErrorPaths.has(path ?? ''));
    }
    return true;
  });
}

function maxSeverity(left: Severity, right: Severity): Severity {
  const order: Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  return order.indexOf(left) >= order.indexOf(right) ? left : right;
}

function uniqueByName(tests: GeneratedTestCase[]): GeneratedTestCase[] {
  const seen = new Set<string>();
  return tests.filter((test) => {
    const key = `${test.category}:${test.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countBy(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item] = (out[item] ?? 0) + 1;
  return out;
}

function sameSite(url: string, targetHost: string): boolean {
  try {
    const host = new URL(url).host;
    if (host === targetHost) return true;
    const base = targetHost.replace(/^www\./, '');
    return host.endsWith(`.${base}`) || host === base;
  } catch {
    return false;
  }
}

function pathOf(url?: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseSelectors(value: unknown) {
  const parsed = selectorMetaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function telemetryFingerprint(screenshotKey: string): string {
  const match = screenshotKey.match(/screenshots\/(.+)\.png$/);
  return match?.[1] ?? 'unknown';
}

async function isCancelled(deps: AuditDependencies, runId: string): Promise<boolean> {
  const latest = await deps.prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
  return !latest || latest.status === 'CANCELLED';
}

/** "/users/12/edit?x=1" → "/users/:id/edit?x=1": pages built from one template compare equal. */
function routeTemplate(text: string): string {
  return text.replace(/\/(\d+|[0-9a-f]{8,}|[0-9a-f-]{36})(?=[/?#\s.,)"']|$)/gi, '/:id');
}
