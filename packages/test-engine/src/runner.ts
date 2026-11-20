import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BrowserManager,
  ConsoleMonitor,
  installSafetyGuard,
  locatorFromSelectors,
  NetworkMonitor,
  ScreenshotManager,
  type BlockedRequest,
  type SafetyGuard,
  type SafetyMode,
} from '@auditor/browser';
import type { FailureClass, GeneratedTestCase, TestStep } from '@auditor/shared';
import type { BrowserContext, Locator, Page } from 'playwright';
import { AssertionEngine, expandTemplate, type AssertionResult } from './assertions.js';

export interface ArtifactStore {
  put(input: { key: string; body: Buffer; contentType: string }): Promise<{ key: string }>;
}

export const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

export interface StoredEvidence {
  type: 'SCREENSHOT' | 'LOG' | 'JSON' | 'VIDEO' | 'HAR';
  key: string;
  contentType: string;
  fileName: string;
  byteLength: number;
}

export interface TestRunExecution {
  status: 'PASSED' | 'FAILED' | 'ERROR' | 'SKIPPED';
  /** Why the test failed: a real application bug, a broken test, the environment, or flakiness. */
  failureClass?: FailureClass;
  /** True when the first attempt failed and a retry passed. */
  flaky?: boolean;
  errorMessage?: string;
  durationMs: number;
  retryCount: number;
  assertions: AssertionResult[];
  actualResults: string[];
  screenshotBeforeKey?: string;
  screenshotFailureKey?: string;
  screenshotAfterKey?: string;
  traceKey?: string;
  videoKey?: string;
  consoleKey?: string;
  networkKey?: string;
  evidence: StoredEvidence[];
  url?: string;
  httpFailures: Array<{ url: string; status?: number; error?: string }>;
  consoleErrors: string[];
  pageErrors: string[];
  blockedRequests: BlockedRequest[];
}

export interface RunnerSafety {
  mode: SafetyMode;
  blockedPathPatterns?: string[];
}

export class TestRunner {
  private readonly assertions = new AssertionEngine();

  constructor(
    private readonly options: {
      storage: ArtifactStore;
      allowPrivateTargets: boolean;
      recordVideo?: boolean;
      timeoutMs?: number;
      /** Extra attempts after a failure. A pass on retry marks the test flaky. Default 1. */
      retries?: number;
      safety?: RunnerSafety;
      /** Called with each new test page, e.g. to stream it live. */
      onPage?: (page: Page) => Promise<void>;
      /** Called before each step with the element box it targets, if any. */
      onStep?: (step: TestStep, box: { x: number; y: number; width: number; height: number } | null) => Promise<void>;
    },
  ) {}

  async run(input: {
    runId: string;
    testId: string;
    test: GeneratedTestCase;
    storageState?: unknown;
    credentials?: { username: string; password: string };
    baseUrl: string;
  }): Promise<TestRunExecution> {
    if (input.test.mutates && (this.options.safety?.mode ?? 'FULL') === 'READ_ONLY') {
      return skipped('Test changes data and the project is in read-only safety mode');
    }
    const retries = Math.max(0, this.options.retries ?? 1);
    const attempts: TestRunExecution[] = [];
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const result = await this.runOnce(input, attempt);
      attempts.push(result);
      if (result.status === 'PASSED' || result.status === 'SKIPPED') {
        break;
      }
      if (classifyFailure(result) === 'TEST_BUG' && result.status === 'ERROR' && attempt === 0 && !isTimingError(result)) {
        // A selector that does not exist will not appear on retry; save the browser time.
        break;
      }
    }
    const last = attempts.at(-1) as TestRunExecution;
    const first = attempts[0] as TestRunExecution;
    if (last.status === 'PASSED' && first.status !== 'PASSED') {
      return {
        ...last,
        flaky: true,
        failureClass: 'FLAKY',
        errorMessage: `Passed on retry ${last.retryCount}; first attempt: ${first.errorMessage ?? first.status}`,
        evidence: attempts.flatMap((item) => item.evidence),
        screenshotFailureKey: first.screenshotFailureKey,
        traceKey: first.traceKey ?? last.traceKey,
      };
    }
    if ((last.status === 'FAILED' || last.status === 'ERROR') && last.blockedRequests.some(
        (item) =>
          /Read-only mode/.test(item.reason) &&
          sameHost(item.url, input.baseUrl) &&
          // Only a blocked page load, form post or API call can explain the failure.
          ['document', 'xhr', 'fetch', 'other', undefined].includes(item.resourceType),
      )) {
      // The test tried to change data and the guard stopped it, so its result says nothing about the app.
      return {
        ...skipped('Needs FULL safety mode: the test sends requests that change data, and read-only mode blocked them'),
        blockedRequests: last.blockedRequests,
        evidence: attempts.flatMap((item) => item.evidence),
        durationMs: attempts.reduce((sum, item) => sum + item.durationMs, 0),
      };
    }
    if (last.status === 'FAILED' || last.status === 'ERROR') {
      return {
        ...last,
        failureClass: classifyFailure(last),
        evidence: attempts.flatMap((item) => item.evidence),
      };
    }
    return last;
  }

  private async runOnce(
    input: {
      runId: string;
      testId: string;
      test: GeneratedTestCase;
      storageState?: unknown;
      credentials?: { username: string; password: string };
      baseUrl: string;
    },
    attempt: number,
  ): Promise<TestRunExecution> {
    const manager = new BrowserManager();
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const started = Date.now();
    const evidence: StoredEvidence[] = [];
    const screenshots = new ScreenshotManager();
    const videoDir = this.options.recordVideo ? await mkdtemp(join(tmpdir(), 'auditor-video-')) : null;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let guard: SafetyGuard | undefined;
    let tracingStarted = false;
    const consoleMonitor = new ConsoleMonitor();
    const networkMonitor = new NetworkMonitor();
    const vars: Record<string, string> = {};
    const result: TestRunExecution = {
      status: 'PASSED',
      durationMs: 0,
      retryCount: attempt,
      assertions: [],
      actualResults: [],
      evidence,
      httpFailures: [],
      consoleErrors: [],
      pageErrors: [],
      blockedRequests: [],
    };

    try {
      context = await manager.createContext({
        viewport: VIEWPORTS[input.test.viewport ?? 'desktop'],
        ...(input.test.requiresAuth === false ? {} : input.storageState ? { storageState: input.storageState as never } : {}),
        ...(videoDir ? { recordVideo: { dir: videoDir } } : {}),
      });
      guard = await installSafetyGuard(context, {
        mode: this.options.safety?.mode ?? 'FULL',
        allowPrivate: this.options.allowPrivateTargets,
        targetOrigin: new URL(input.baseUrl).origin,
        blockedPathPatterns: this.options.safety?.blockedPathPatterns,
      });
      // Tests that log in on purpose (authentication scenarios) need the login POST.
      guard.setPhase(input.test.requiresAuth === false ? 'auth' : 'audit');
      page = await manager.createPage(context);
      await this.options.onPage?.(page).catch(() => undefined);
      await context.tracing.start({ screenshots: true, snapshots: true });
      tracingStarted = true;
      consoleMonitor.attach(page);
      networkMonitor.attach(page);

      const before = await screenshots.capture(page);
      result.screenshotBeforeKey = await this.store(
        evidence,
        `runs/${input.runId}/tests/${input.testId}/before-${attempt}.png`,
        before,
        'image/png',
        'before.png',
        'SCREENSHOT',
      );

      const deadline = Date.now() + timeoutMs;
      for (const testStep of input.test.steps) {
        if (Date.now() > deadline) {
          throw new Error('Test timed out');
        }
        if (this.options.onStep) {
          const target = testStep.selectors ?? testStep.assertion?.selectors;
          const box = target
            ? await locatorFromSelectors(page, target)
                .first()
                .boundingBox({ timeout: 800 })
                .catch(() => null)
            : null;
          await this.options.onStep(testStep, box).catch(() => undefined);
        }
        await this.executeStep(page, testStep, input, result, consoleMonitor, networkMonitor, vars);
        if (result.status === 'FAILED') {
          const failure = await screenshots.capture(page);
          result.screenshotFailureKey = await this.store(
            evidence,
            `runs/${input.runId}/tests/${input.testId}/failure-${attempt}.png`,
            failure,
            'image/png',
            'failure.png',
            'SCREENSHOT',
          );
          break;
        }
      }

      const network = networkMonitor.snapshot();
      const consoleMessages = consoleMonitor.snapshot();
      result.httpFailures = network.failures.filter((item) => !isBlockedByGuard(item.error));
      result.consoleErrors = consoleMessages.filter((item) => item.type === 'error').map((item) => item.text);
      result.pageErrors = consoleMessages.filter((item) => item.type === 'pageerror').map((item) => item.text);
      result.url = page.url();

      const consoleBody = Buffer.from(JSON.stringify(consoleMessages, null, 2));
      const networkBody = Buffer.from(JSON.stringify(network, null, 2));
      result.consoleKey = await this.store(
        evidence,
        `runs/${input.runId}/tests/${input.testId}/console-${attempt}.json`,
        consoleBody,
        'application/json',
        'console.json',
        'LOG',
      );
      result.networkKey = await this.store(
        evidence,
        `runs/${input.runId}/tests/${input.testId}/network-${attempt}.json`,
        networkBody,
        'application/json',
        'network.json',
        'JSON',
      );

      const after = await screenshots.capture(page);
      result.screenshotAfterKey = await this.store(
        evidence,
        `runs/${input.runId}/tests/${input.testId}/after-${attempt}.png`,
        after,
        'image/png',
        'after.png',
        'SCREENSHOT',
      );
    } catch (error) {
      result.status = 'ERROR';
      result.errorMessage = error instanceof Error ? error.message : 'Test execution failed';
      result.actualResults.push(result.errorMessage);
      if (page) {
        result.url = page.url();
        try {
          const failure = await screenshots.capture(page);
          result.screenshotFailureKey = await this.store(
            evidence,
            `runs/${input.runId}/tests/${input.testId}/failure-${attempt}.png`,
            failure,
            'image/png',
            'failure.png',
            'SCREENSHOT',
          );
        } catch {
          /* screenshot is best-effort */
        }
        const network = networkMonitor.snapshot();
        result.httpFailures = network.failures.filter((item) => !isBlockedByGuard(item.error));
        const consoleMessages = consoleMonitor.snapshot();
        result.consoleErrors = consoleMessages.filter((item) => item.type === 'error').map((item) => item.text);
        result.pageErrors = consoleMessages.filter((item) => item.type === 'pageerror').map((item) => item.text);
      }
    } finally {
      result.blockedRequests = guard ? [...guard.blocked] : [];
      if (context && tracingStarted) {
        try {
          if (result.status === 'PASSED') {
            await context.tracing.stop();
          } else {
            const tracePath = join(tmpdir(), `auditor-trace-${input.testId}-${attempt}.zip`);
            await context.tracing.stop({ path: tracePath });
            const trace = await readFile(tracePath);
            result.traceKey = await this.store(
              evidence,
              `runs/${input.runId}/tests/${input.testId}/trace-${attempt}.zip`,
              trace,
              'application/zip',
              'trace.zip',
              'HAR',
            );
            await rm(tracePath, { force: true }).catch(() => undefined);
          }
        } catch {
          await context.tracing.stop().catch(() => undefined);
        }
      }
      const video = page?.video();
      await context?.close().catch(() => undefined);
      if (video && this.options.recordVideo) {
        try {
          const videoPath = await video.path();
          const body = await readFile(videoPath);
          result.videoKey = await this.store(
            evidence,
            `runs/${input.runId}/tests/${input.testId}/video-${attempt}.webm`,
            body,
            'video/webm',
            'video.webm',
            'VIDEO',
          );
        } catch {
          /* video is optional */
        }
      }
      await manager.close().catch(() => undefined);
      if (videoDir) {
        await rm(videoDir, { recursive: true, force: true }).catch(() => undefined);
      }
      result.durationMs = Date.now() - started;
    }

    return result;
  }

  private async store(
    evidence: StoredEvidence[],
    key: string,
    body: Buffer,
    contentType: string,
    fileName: string,
    type: StoredEvidence['type'],
  ): Promise<string> {
    await this.options.storage.put({ key, body, contentType });
    evidence.push({ type, key, contentType, fileName, byteLength: body.byteLength });
    return key;
  }

  private async executeStep(
    page: Page,
    testStep: TestStep,
    input: { credentials?: { username: string; password: string }; baseUrl: string },
    result: TestRunExecution,
    consoleMonitor: ConsoleMonitor,
    networkMonitor: NetworkMonitor,
    vars: Record<string, string>,
  ): Promise<void> {
    const value = resolveValue(testStep.value, input.credentials, vars);
    const timeout = testStep.timeoutMs ?? 8_000;
    if (['navigate', 'reload', 'back', 'click'].includes(testStep.type)) {
      // "The destination should not throw" is about this step's result, not the
      // page the test started on (that page has its own test).
      consoleMonitor.mark();
    }
    if (testStep.type === 'navigate') {
      const href = testStep.href ?? testStep.value ?? input.baseUrl;
      await page.goto(href, { waitUntil: 'domcontentloaded', timeout: Math.max(timeout, 15_000) });
      await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
      return;
    }
    if (testStep.type === 'reload') {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: Math.max(timeout, 15_000) });
      await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
      return;
    }
    if (testStep.type === 'back') {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: Math.max(timeout, 15_000) });
      return;
    }
    if (testStep.type === 'wait') {
      if (testStep.selectors) {
        await locatorFromSelectors(page, testStep.selectors).first().waitFor({ timeout });
      } else {
        await page.waitForTimeout(Math.min(timeout, 2_000));
      }
      return;
    }
    if (testStep.type === 'capture') {
      const name = testStep.captureAs ?? 'value';
      if (!testStep.selectors) {
        vars[name] = await page.title();
        return;
      }
      const locator = locatorFromSelectors(page, testStep.selectors);
      if (testStep.captureMode === 'count') {
        vars[name] = String(await locator.count());
      } else if (testStep.captureMode === 'value') {
        vars[name] = await locator.first().inputValue({ timeout }).catch(() => '');
      } else {
        const text = await locator
          .first()
          .textContent({ timeout })
          .catch(() => null);
        vars[name] = (text ?? '').replace(/\s+/g, ' ').trim();
      }
      return;
    }
    if (testStep.type === 'assert' && testStep.assertion) {
      const spec =
        typeof testStep.assertion.expected === 'string'
          ? { ...testStep.assertion, expected: expandTemplate(testStep.assertion.expected, vars) }
          : testStep.assertion;
      if (spec.kind === 'element_text' && spec.selectors) {
        // Give dynamic content (cart badges, totals) a moment to update.
        await locatorFromSelectors(page, spec.selectors)
          .first()
          .waitFor({ state: 'attached', timeout: Math.min(timeout, 5_000) })
          .catch(() => undefined);
      }
      // Pages change asynchronously (client-side routing, data loading), so
      // state-based assertions are retried until they pass or time runs out,
      // like Playwright's own web-first assertions. Error checks run once.
      const retryable = !['http', 'console_error', 'page_error'].includes(spec.kind);
      const assertDeadline = Date.now() + (retryable ? Math.min(timeout, 6_000) : 0);
      let assertion = this.assertions.evaluate(
        spec,
        await this.contextFor(page, { ...testStep, assertion: spec }, consoleMonitor, networkMonitor),
      );
      while (!assertion.passed && Date.now() < assertDeadline) {
        await page.waitForTimeout(250);
        assertion = this.assertions.evaluate(
          spec,
          await this.contextFor(page, { ...testStep, assertion: spec }, consoleMonitor, networkMonitor),
        );
      }
      result.assertions.push(assertion);
      result.actualResults.push(assertion.message);
      if (!assertion.passed) {
        result.status = 'FAILED';
        result.errorMessage = assertion.message;
      }
      return;
    }
    if (!testStep.selectors) {
      throw new Error(`Step ${testStep.type} is missing a discovered selector`);
    }
    const locator = await visibleTarget(page, locatorFromSelectors(page, testStep.selectors), timeout);
    if (testStep.type === 'type') {
      await locator.fill(value ?? '');
      return;
    }
    if (testStep.type === 'select') {
      await locator.selectOption(value ?? { index: 0 });
      return;
    }
    if (testStep.type === 'upload') {
      await locator.setInputFiles(value ?? '');
      return;
    }
    await locator.click({ timeout });
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => undefined);
  }

  private async contextFor(
    page: Page,
    testStep: TestStep,
    consoleMonitor: ConsoleMonitor,
    networkMonitor: NetworkMonitor,
  ) {
    const selectors = testStep.assertion?.selectors ?? testStep.selectors;
    const locator = selectors ? locatorFromSelectors(page, selectors).first() : null;
    const all = selectors ? locatorFromSelectors(page, selectors) : null;
    const exists = locator ? (await locator.count()) > 0 : false;
    const consoleMessages = consoleMonitor.snapshot();
    return {
      url: page.url(),
      title: await page.title(),
      text: await page.locator('body').innerText().catch(() => ''),
      elementExists: exists,
      elementVisible: exists && locator ? await locator.isVisible().catch(() => false) : false,
      elementText: exists && locator ? await locator.innerText({ timeout: 2_000 }).catch(() => null) : null,
      attribute:
        exists && locator && testStep.assertion?.attribute
          ? await locator.getAttribute(testStep.assertion.attribute).catch(() => null)
          : null,
      value: exists && locator ? await locator.inputValue({ timeout: 1_000 }).catch(() => null) : null,
      count: all ? await all.count() : 0,
      httpFailures: networkMonitor.snapshot().failures.filter((item) => !isBlockedByGuard(item.error)),
      consoleErrors: consoleMessages.filter((item) => item.type === 'error').map((item) => item.text),
      pageErrors: consoleMonitor
        .sinceMark()
        .filter((item) => item.type === 'pageerror')
        .map((item) => item.text),
    };
  }
}

/**
 * Sorts a failed attempt into one bucket. Only APP_BUG results become bug
 * findings; TEST_BUG and ENVIRONMENT are reported separately so a broken
 * generated test or a slow network never shows up as a product defect.
 */
export function classifyFailure(result: Pick<TestRunExecution, 'status' | 'errorMessage' | 'httpFailures' | 'pageErrors' | 'actualResults' | 'assertions'>): FailureClass {
  const message = `${result.errorMessage ?? ''} ${(result.actualResults ?? []).join(' ')}`;
  if (result.httpFailures.some((item) => (item.status ?? 0) >= 500 && (item.status ?? 0) !== 502 && (item.status ?? 0) !== 503 && (item.status ?? 0) !== 504)) {
    return 'APP_BUG';
  }
  if (result.pageErrors.length > 0 && result.status === 'FAILED') {
    return 'APP_BUG';
  }
  if (/net::ERR_(NAME|CONNECTION|INTERNET|ADDRESS|TIMED_OUT|NETWORK)|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) {
    return 'ENVIRONMENT';
  }
  if (result.httpFailures.some((item) => item.status === 502 || item.status === 503 || item.status === 504 || item.status === 429)) {
    return 'ENVIRONMENT';
  }
  if (result.status === 'ERROR') {
    if (/waiting for (locator|getBy|selector)|strict mode violation|element is not (visible|attached|enabled)|missing a discovered selector|not found|Target page, context or browser has been closed/i.test(message)) {
      return 'TEST_BUG';
    }
    if (/Timeout|timed out/i.test(message)) {
      return /page\.goto|navigat/i.test(message) ? 'ENVIRONMENT' : 'TEST_BUG';
    }
    return 'TEST_BUG';
  }
  return 'APP_BUG';
}

function sameHost(url: string, base: string): boolean {
  try {
    return new URL(url).host === new URL(base).host;
  } catch {
    return false;
  }
}

function isTimingError(result: TestRunExecution): boolean {
  return /Timeout|timed out/i.test(result.errorMessage ?? '');
}

function isBlockedByGuard(error?: string): boolean {
  return /ERR_BLOCKED_BY_CLIENT|blockedbyclient/i.test(error ?? '');
}

function skipped(reason: string): TestRunExecution {
  return {
    status: 'SKIPPED',
    errorMessage: reason,
    durationMs: 0,
    retryCount: 0,
    assertions: [],
    actualResults: [reason],
    evidence: [],
    httpFailures: [],
    consoleErrors: [],
    pageErrors: [],
    blockedRequests: [],
  };
}

function resolveValue(
  value: string | undefined,
  credentials: { username: string; password: string } | undefined,
  vars: Record<string, string>,
): string | undefined {
  if (!value) {
    return value;
  }
  return expandTemplate(
    value
      .replaceAll('{{credential.username}}', credentials?.username ?? '')
      .replaceAll('{{credential.password}}', credentials?.password ?? ''),
    vars,
  );
}

/**
 * The element a step acts on, preferring a visible match. Responsive sites often
 * render two copies of a control (a mobile and a desktop search box) and hide
 * one; when the recorded selector only matches the hidden copy, use the visible
 * input of the same kind instead of failing the test for a reason that is not
 * the app's fault.
 */
async function visibleTarget(page: Page, candidates: Locator, timeout: number): Promise<Locator> {
  const visible = candidates.filter({ visible: true }).first();
  const quick = Math.min(timeout, 2_500);
  if (await visible.waitFor({ state: 'visible', timeout: quick }).then(() => true, () => false)) {
    return visible;
  }
  const hidden = candidates.first();
  const twin = await hidden
    .evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type');
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return null;
      return type ? `${tag}[type="${type.replace(/"/g, '')}"]` : tag;
    }, undefined, { timeout: 1_000 })
    .catch(() => null);
  if (twin) {
    const alternative = page.locator(twin).filter({ visible: true }).first();
    if (await alternative.waitFor({ state: 'visible', timeout: 1_500 }).then(() => true, () => false)) {
      return alternative;
    }
  }
  await visible.waitFor({ state: 'visible', timeout: Math.max(0, timeout - quick) });
  return visible;
}
