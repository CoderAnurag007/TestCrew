import {
  createModelRouter,
  FailureAnalysisAgent,
  REPORT_SUMMARY_PROMPT_VERSION,
  TestGenerationAgent,
  UXAnalysisAgent,
} from '@auditor/ai';
import {
  AccessibilityAnalyzer,
  BugDetector,
  ConfidenceCalculator,
  DuplicateDetector,
  findingSignature,
  ReportGenerator,
  SeverityClassifier,
  VisualAnalyzer,
  calculateQualityScore,
  coverageFrom,
  type ReportPayload,
} from '@auditor/analyzer';
import type { Prisma } from '@auditor/database';
import {
  catalogFromActions,
  catalogFromSemantic,
  mergeCatalogs,
  TestGenerator,
  TestRunner,
  type TestRunExecution,
} from '@auditor/test-engine';
import {
  selectorMetaSchema,
  type DiscoveredElement,
  type GeneratedTestCase,
  type SemanticPage,
} from '@auditor/shared';
import { appendEvent, setRunStatus, startStage, completeStage, type AuditDependencies } from './engine.js';

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

  try {
    const loginRaw = JSON.parse((await deps.storage.get(`runs/${input.runId}/login-semantic.json`)).toString('utf8')) as SemanticPage;
    const loginPage: SemanticPage = {
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
  const baseUrl = run.environment?.baseUrl ?? run.project.baseUrl;
  const generated = await generator.generate({
    catalog,
    flows,
    states,
    semanticPages,
    baseUrl,
    allowDestructive: run.project.allowDestructive,
  });

  if (generated.model) {
    await deps.prisma.aiUsage.create({
      data: {
        organizationId: input.organizationId,
        runId: input.runId,
        purpose: 'test_generation',
        promptVersion: generated.promptVersion,
        model: generated.model,
        promptTokens: generated.promptTokens ?? 0,
        completionTokens: generated.completionTokens ?? 0,
        latencyMs: generated.latencyMs ?? 0,
        estimatedCostUsd: generated.estimatedCostUsd ?? 0,
      },
    });
  }

  const persistedTests: Array<{ id: string; draft: GeneratedTestCase; flowId: string | null }> = [];
  for (const test of generated.tests) {
    const flow = flows.find((item) => item.name === test.flowName) ?? flows[0] ?? null;
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
        promptVersion: generated.promptVersion,
        model: generated.model,
        promptTokens: generated.promptTokens,
        completionTokens: generated.completionTokens,
        latencyMs: generated.latencyMs,
        estimatedCostUsd: generated.estimatedCostUsd,
      },
    });
    persistedTests.push({ id: row.id, draft: test, flowId: flow?.id ?? null });
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
    message: `Executing ${persistedTests.length} generated tests`,
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
    where: { projectId: input.projectId, organizationId: input.organizationId },
    orderBy: { createdAt: 'asc' },
  });
  const credentials =
    credential?.secretCiphertext
      ? {
          username: credential.username,
          password: await deps.secrets.decrypt(credential.secretCiphertext),
        }
      : undefined;

  const runner = new TestRunner({
    storage: deps.storage,
    allowPrivateTargets: run.project.allowPrivateTargets,
    recordVideo: run.project.recordVideo,
    timeoutMs: 15_000,
    retries: 0,
  });

  const executions: Array<{ testId: string; testRunId: string; draft: GeneratedTestCase; result: TestRunExecution; flowName?: string }> = [];
  let passed = 0;
  let failed = 0;
  let browserMs = 0;

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
    const result = await runner.run({
      runId: input.runId,
      testId: test.id,
      test: test.draft,
      storageState,
      credentials,
      baseUrl,
    });
    browserMs += result.durationMs;
    if (result.status === 'PASSED') {
      passed += 1;
    } else if (result.status === 'FAILED' || result.status === 'ERROR') {
      failed += 1;
    }
    await deps.prisma.testRun.update({
      where: { id: testRun.id },
      data: {
        status: result.status,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
        retryCount: result.retryCount,
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
    });
    await appendEvent(deps.prisma, {
      organizationId: input.organizationId,
      runId: input.runId,
      kind: 'test',
      message: `Finished "${test.draft.name}": ${result.status}`,
    });
  }

  await deps.prisma.run.update({
    where: { id: input.runId },
    data: { testsPassed: passed, testsFailed: failed },
  });
  await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'execute-tests' });

  await setRunStatus(deps.prisma, input.runId, 'ANALYZING', { currentAction: 'analyzing' });
  await startStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'analyze' });
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'stage',
    message: 'Analyzing failures, UX, accessibility, and visual issues',
  });

  const bugDetector = new BugDetector();
  const confidence = new ConfidenceCalculator();
  const duplicates = new DuplicateDetector();
  const a11y = new AccessibilityAnalyzer();
  const visual = new VisualAnalyzer();
  const drafts: Array<{
    title: string;
    description: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
    category: 'BUG' | 'UX' | 'ACCESSIBILITY' | 'SECURITY' | 'PERFORMANCE' | 'VISUAL';
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
  }> = [];

  for (const execution of executions) {
    if (execution.result.status === 'PASSED') {
      continue;
    }
    if (isSelectorInfrastructureFailure(execution.result)) {
      continue;
    }
    const signals = bugDetector.detect({
      httpFailures: execution.result.httpFailures,
      pageErrors: execution.result.pageErrors,
      consoleErrors: execution.result.consoleErrors,
      assertionMessage: execution.result.errorMessage,
      timeout: /timeout/i.test(execution.result.errorMessage ?? ''),
      url: execution.result.url,
    });
    const analysis = await failureAgent.analyze({
      testName: execution.draft.name,
      category: execution.draft.category,
      steps: execution.draft.steps,
      expected: execution.draft.expectedResults,
      actual: execution.result.actualResults.join('\n') || execution.result.errorMessage || 'Unexpected failure',
      errorMessage: execution.result.errorMessage,
      url: execution.result.url,
      console: execution.result.consoleErrors,
      network: execution.result.httpFailures,
      httpFailures: execution.result.httpFailures,
      pageErrors: execution.result.pageErrors,
      screenshotAvailable: Boolean(execution.result.screenshotFailureKey),
    });
    if (analysis.model) {
      await deps.prisma.aiUsage.create({
        data: {
          organizationId: input.organizationId,
          runId: input.runId,
          purpose: 'failure_analysis',
          promptVersion: analysis.promptVersion,
          model: analysis.model,
          promptTokens: analysis.promptTokens,
          completionTokens: analysis.completionTokens,
          latencyMs: analysis.latencyMs,
          estimatedCostUsd: analysis.estimatedCostUsd,
        },
      });
    }
    drafts.push({
      title: analysis.analysis.title,
      description: analysis.analysis.summary,
      severity: analysis.analysis.severity,
      category: analysis.analysis.category,
      confidence: confidence.calculate({
        deterministic: signals.length > 0,
        screenshot: Boolean(execution.result.screenshotFailureKey),
        console: execution.result.consoleErrors.length > 0,
        network: execution.result.httpFailures.length > 0,
        reproduced: true,
      }),
      expected: analysis.analysis.expected,
      actual: analysis.analysis.actual,
      recommendation: analysis.analysis.recommendation,
      steps: execution.draft.steps,
      signature: findingSignature({
        title: analysis.analysis.title,
        url: execution.result.url,
        category: analysis.analysis.category,
        error: execution.result.errorMessage,
      }),
      url: execution.result.url,
      rootCauseHypothesis: analysis.analysis.rootCauseHypothesis,
      testRunId: execution.testRunId,
    });
  }

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
        signature: findingSignature({ title: issue.title, url: issue.url, category: 'ACCESSIBILITY', component: issue.component }),
        component: issue.component,
        url: issue.url,
        pageId: page.id,
      });
    }
    if (semantic) {
      for (const issue of visual.analyze([semantic], { viewport: 'desktop' })) {
        drafts.push({
          title: issue.title,
          description: issue.description,
          severity: 'LOW',
          category: 'VISUAL',
          confidence: issue.confidence,
          recommendation: issue.recommendation,
          signature: findingSignature({ title: issue.title, url: issue.url, category: 'VISUAL' }),
          url: issue.url,
          pageId: page.id,
        });
      }
    }
    if (page.screenshotKey) {
      try {
        const telemetry = JSON.parse(
          (await deps.storage.get(`runs/${input.runId}/telemetry/${telemetryFingerprint(page.screenshotKey)}.json`)).toString(
            'utf8',
          ),
        ) as { pageErrors?: string[]; networkFailures?: Array<{ url: string; status?: number }> };
        const signals = bugDetector.detect({
          pageErrors: telemetry.pageErrors,
          httpFailures: telemetry.networkFailures,
          url: page.url,
        });
        for (const signal of signals) {
          drafts.push({
            title: signal.message.slice(0, 240),
            description: signal.message,
            severity: new SeverityClassifier().classify([signal]),
            category: 'BUG',
            confidence: confidence.calculate({ deterministic: true, network: signal.kind.startsWith('http'), console: signal.kind === 'uncaught_js' }),
            recommendation: 'Inspect the captured console and network evidence for this page.',
            signature: findingSignature({ title: signal.message, url: page.url, category: 'BUG', error: signal.message }),
            url: page.url,
            pageId: page.id,
          });
        }
      } catch {
        /* telemetry is best-effort */
      }
    }
  }

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
  if (ux.model) {
    await deps.prisma.aiUsage.create({
      data: {
        organizationId: input.organizationId,
        runId: input.runId,
        purpose: 'ux_analysis',
        promptVersion: ux.promptVersion,
        model: ux.model,
        promptTokens: ux.promptTokens,
        completionTokens: ux.completionTokens,
        latencyMs: ux.latencyMs,
        estimatedCostUsd: ux.estimatedCostUsd,
      },
    });
  }
  for (const finding of ux.analysis.findings) {
    drafts.push({
      title: finding.title,
      description: finding.description,
      severity: 'LOW',
      category: 'UX',
      confidence: finding.confidence,
      recommendation: finding.recommendation,
      signature: findingSignature({ title: finding.title, url: finding.url, category: 'UX', component: finding.component }),
      component: finding.component,
      url: finding.url,
    });
  }

  const merged = duplicates.merge(drafts);
  const createdFindings: Array<{
    id: string;
    title: string;
    severity: (typeof drafts)[number]['severity'];
    category: (typeof drafts)[number]['category'];
    recommendation?: string | null;
  }> = [];
  for (const draft of merged) {
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
      },
    });
    createdFindings.push(finding);
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

  const testedFlowNames = executions.map((item) => item.flowName).filter((item): item is string => Boolean(item));
  const successfulFlowNames = executions
    .filter((item) => item.result.status === 'PASSED')
    .map((item) => item.flowName)
    .filter((item): item is string => Boolean(item));
  const failedFlowNames = executions
    .filter((item) => item.result.status !== 'PASSED')
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
  const storageBytesEstimate = (
    await deps.prisma.evidence.aggregate({ where: { runId: input.runId }, _sum: { byteLength: true } })
  )._sum.byteLength ?? 0;
  const score = calculateQualityScore({
    findings: createdFindings,
    testsPassed: passed,
    testsFailed: failed,
    coverage,
  });

  let summary = `Quality score ${score}/100 with ${createdFindings.filter((item) => item.severity === 'CRITICAL').length} critical and ${createdFindings.filter((item) => item.severity === 'HIGH').length} high findings.`;
  if (router.current().name !== 'heuristic') {
    try {
      const text = await router.generateText({
        messages: [
          {
            role: 'system',
            content:
              'Write a short executive summary of an application audit. Use only the provided numeric statistics. Do not invent counts or change the quality score.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              score,
              findings: createdFindings.length,
              coverage,
              passed,
              failed,
            }),
          },
        ],
        model: router.modelFor('summary'),
        maxTokens: 250,
      });
      summary = text.content;
      await deps.prisma.aiUsage.create({
        data: {
          organizationId: input.organizationId,
          runId: input.runId,
          purpose: 'report_summary',
          promptVersion: REPORT_SUMMARY_PROMPT_VERSION,
          model: text.model,
          promptTokens: text.promptTokens ?? 0,
          completionTokens: text.completionTokens ?? 0,
          latencyMs: text.latencyMs ?? 0,
          estimatedCostUsd: text.estimatedCostUsd ?? 0,
        },
      });
    } catch {
      /* keep deterministic summary */
    }
  }

  const payload: ReportPayload = new ReportGenerator().build({
    score,
    findings: createdFindings,
    coverage,
    testedFlows: [...new Set(testedFlowNames)],
    cost: { aiCostUsd, browserDurationMs: browserMs, storageBytesEstimate },
    summary,
  });

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

  const startedAt = run.startedAt ?? run.createdAt;
  await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'analyze' });
  await deps.prisma.run.update({
    where: { id: input.runId },
    data: {
      status: 'COMPLETED',
      qualityScore: score,
      aiCostUsd,
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
    message: `Audit complete. Score ${score}/100 with ${createdFindings.length} findings.`,
  });
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

function isSelectorInfrastructureFailure(result: {
  status: string;
  errorMessage?: string;
  actualResults?: string[];
  httpFailures: Array<{ status?: number }>;
  pageErrors: string[];
}): boolean {
  if (result.httpFailures.some((item) => (item.status ?? 0) >= 500)) {
    return false;
  }
  if (result.pageErrors.length > 0) {
    return false;
  }
  const message = `${result.errorMessage ?? ''} ${(result.actualResults ?? []).join(' ')}`;
  return /timeout|waiting for locator|strict mode violation|element is not visible|not found/i.test(message);
}
