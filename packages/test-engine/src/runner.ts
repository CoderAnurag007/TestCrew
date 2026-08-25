import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BrowserManager,
  ConsoleMonitor,
  installNavigationGuard,
  locatorFromSelectors,
  NetworkMonitor,
  ScreenshotManager,
} from '@auditor/browser';
import type { GeneratedTestCase, TestStep } from '@auditor/shared';
import type { BrowserContext, Page } from 'playwright';
import { AssertionEngine, type AssertionResult } from './assertions.js';

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
}

export class TestRunner {
  private readonly assertions = new AssertionEngine();

  constructor(
    private readonly options: {
      storage: ArtifactStore;
      allowPrivateTargets: boolean;
      recordVideo?: boolean;
      timeoutMs?: number;
      retries?: number;
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
    const retries = this.options.retries ?? 1;
    let last: TestRunExecution | undefined;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      last = await this.runOnce(input, attempt);
      if (last.status !== 'ERROR') {
        return last;
      }
    }
    return last as TestRunExecution;
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
    let tracingStarted = false;
    const consoleMonitor = new ConsoleMonitor();
    const networkMonitor = new NetworkMonitor();
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
    };

    try {
      context = await manager.createContext({
        viewport: VIEWPORTS[input.test.viewport ?? 'desktop'],
        ...(input.test.requiresAuth === false ? {} : input.storageState ? { storageState: input.storageState as never } : {}),
        ...(videoDir ? { recordVideo: { dir: videoDir } } : {}),
      });
      page = await manager.createPage(context);
      await installNavigationGuard(page, { allowPrivate: this.options.allowPrivateTargets });
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
        await this.executeStep(page, testStep, input, result, consoleMonitor, networkMonitor);
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
      result.httpFailures = network.failures;
      result.consoleErrors = consoleMessages.filter((item) => item.type === 'error').map((item) => item.text);
      result.pageErrors = consoleMessages.filter((item) => item.type === 'error').map((item) => item.text);
      result.url = page.url();

      const consoleBody = Buffer.from(JSON.stringify(consoleMessages, null, 2));
      const networkBody = Buffer.from(JSON.stringify(network, null, 2));
      result.consoleKey = await this.store(
        evidence,
        `runs/${input.runId}/tests/${input.testId}/console.json`,
        consoleBody,
        'application/json',
        'console.json',
        'LOG',
      );
      result.networkKey = await this.store(
        evidence,
        `runs/${input.runId}/tests/${input.testId}/network.json`,
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
      }
    } finally {
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
              `runs/${input.runId}/tests/${input.testId}/trace.zip`,
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
            `runs/${input.runId}/tests/${input.testId}/video.webm`,
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
  ): Promise<void> {
    const value = resolveValue(testStep.value, input.credentials);
    const timeout = testStep.timeoutMs ?? 8_000;
    if (testStep.type === 'navigate') {
      const href = testStep.href ?? testStep.value ?? input.baseUrl;
      await page.goto(href, { waitUntil: 'domcontentloaded', timeout });
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
    if (testStep.type === 'assert' && testStep.assertion) {
      const context = await this.contextFor(page, testStep, consoleMonitor, networkMonitor);
      const assertion = this.assertions.evaluate(testStep.assertion, context);
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
    const locator = locatorFromSelectors(page, testStep.selectors).first();
    await locator.waitFor({ state: 'visible', timeout });
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
  }

  private async contextFor(
    page: Page,
    testStep: TestStep,
    consoleMonitor: ConsoleMonitor,
    networkMonitor: NetworkMonitor,
  ) {
    const locator = testStep.selectors ? locatorFromSelectors(page, testStep.selectors).first() : null;
    const exists = locator ? (await locator.count()) > 0 : false;
    const consoleMessages = consoleMonitor.snapshot();
    return {
      url: page.url(),
      title: await page.title(),
      text: await page.locator('body').innerText().catch(() => ''),
      elementExists: exists,
      elementVisible: exists && locator ? await locator.isVisible().catch(() => false) : false,
      attribute: locator && testStep.assertion?.attribute ? await locator.getAttribute(testStep.assertion.attribute) : null,
      value: locator ? await locator.inputValue().catch(() => null) : null,
      count: locator ? await locator.count() : 0,
      httpFailures: networkMonitor.snapshot().failures,
      consoleErrors: consoleMessages.filter((item) => item.type === 'error').map((item) => item.text),
      pageErrors: consoleMessages.filter((item) => item.type === 'error').map((item) => item.text),
    };
  }
}

function resolveValue(
  value: string | undefined,
  credentials?: { username: string; password: string },
): string | undefined {
  if (!value) {
    return value;
  }
  return value
    .replaceAll('{{credential.username}}', credentials?.username ?? '')
    .replaceAll('{{credential.password}}', credentials?.password ?? '');
}
