import type { ObjectStorage } from '@auditor/analyzer';
import { createModelRouter, ExplorerAgent, RecordingExplorer, type ExplorerLike, type ModelRouter, type RecordedDecision } from '@auditor/ai';
import {
  BrowserManager,
  executeCandidateAction,
  locatorFromSelectors,
  installSafetyGuard,
  PageObserver,
  UsernamePasswordAuthenticator,
  waitForPageSettle,
  waitForSpaSettle,
  LiveStreamer,
  type LiveAction,
  type SafetyGuard,
  runWithDevice,
} from '@auditor/browser';
import { orgUsage } from './plan-usage.js';
import { asStringArray, callResetHook, resolveSafetyMode } from './safety-mode.js';
import type { Prisma, PrismaClient, SecretStore } from '@auditor/database';
import {
  ActionExtractor,
  describeAction,
  fingerprintState,
  isPlaceholderHref,
  nameForState,
  shouldStopExploration,
  StateGraph,
} from '@auditor/flow-engine';
import { catalogFromSemantic } from '@auditor/test-engine';
import type { CandidateAction, DiscoveredElement } from '@auditor/shared';
import {
  DISCOVER_APPLICATION_JOB,
  EXPLORE_STATE_JOB,
  isTerminalRunStatus,
  type AuditJobData,
  type ExplorationLimits,
  type RunStatus,
} from '@auditor/shared';
import { assertSafeNavigationTarget, UnsafeTargetError } from '@auditor/shared/ssrf';
import { UnrecoverableError } from 'bullmq';
import type { BrowserContext, Page } from 'playwright';

/** Writes the newest live frame and its metadata where the API can serve them. */
export function createLivePublisher(deps: Pick<AuditDependencies, 'storage'>, runId: string, phase: () => string) {
  return async (frame: { seq: number; at: string; url: string; viewport: { width: number; height: number }; action: LiveAction | null; jpeg: Buffer }) => {
    await deps.storage.put({ key: `runs/${runId}/live/frame.jpg`, body: frame.jpeg, contentType: 'image/jpeg' });
    await deps.storage.put({
      key: `runs/${runId}/live/meta.json`,
      body: Buffer.from(
        JSON.stringify({ seq: frame.seq, at: frame.at, url: frame.url, viewport: frame.viewport, action: frame.action, phase: phase() }),
      ),
      contentType: 'application/json',
    });
  };
}

export interface QueuePort {
  add(name: string, data: unknown, opts?: { jobId?: string }): Promise<unknown>;
}

export interface AuditLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface AuditDependencies {
  prisma: PrismaClient;
  secrets: SecretStore;
  storage: ObjectStorage;
  explorer: ExplorerLike;
  ai?: ModelRouter;
  explorationQueue?: QueuePort;
  logger: AuditLogger;
}

export class AuthenticationRequiredError extends Error {
  readonly code = 'AUTHENTICATION_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationRequiredError';
  }
}

export async function appendEvent(
  prisma: PrismaClient,
  input: { organizationId: string; runId: string; kind: string; message: string; url?: string | null },
): Promise<void> {
  await prisma.runEvent.create({
    data: {
      organizationId: input.organizationId,
      runId: input.runId,
      kind: input.kind,
      message: input.message.slice(0, 2000),
      url: input.url,
    },
  });
}

export async function setRunStatus(
  prisma: PrismaClient,
  runId: string,
  status: RunStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  // A run the user cancelled stays cancelled: later stages of an in-flight
  // audit must never overwrite that status.
  await prisma.run.updateMany({
    where: { id: runId, status: { not: 'CANCELLED' } },
    data: { status, ...extra },
  });
}

/** True when the user cancelled the run (or it no longer exists). */
export async function isRunCancelled(prisma: PrismaClient, runId: string): Promise<boolean> {
  const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
  return !run || run.status === 'CANCELLED';
}

export async function completeStage(
  prisma: PrismaClient,
  input: { organizationId: string; runId: string; name: string; status?: 'COMPLETED' | 'FAILED' | 'SKIPPED'; error?: string },
): Promise<void> {
  const existing = await prisma.runStage.findFirst({
    where: { runId: input.runId, name: input.name },
  });
  const now = new Date();
  if (existing) {
    await prisma.runStage.update({
      where: { id: existing.id },
      data: {
        status: input.status ?? 'COMPLETED',
        errorMessage: input.error,
        completedAt: now,
        startedAt: existing.startedAt ?? now,
      },
    });
    return;
  }
  await prisma.runStage.create({
    data: {
      organizationId: input.organizationId,
      runId: input.runId,
      name: input.name,
      status: input.status ?? 'COMPLETED',
      errorMessage: input.error,
      startedAt: now,
      completedAt: now,
    },
  });
}

export async function startStage(
  prisma: PrismaClient,
  input: { organizationId: string; runId: string; name: string },
): Promise<void> {
  const now = new Date();
  const existing = await prisma.runStage.findFirst({
    where: { runId: input.runId, name: input.name },
  });
  if (existing) {
    await prisma.runStage.update({
      where: { id: existing.id },
      data: { status: 'RUNNING', startedAt: existing.startedAt ?? now },
    });
    return;
  }
  await prisma.runStage.create({
    data: {
      organizationId: input.organizationId,
      runId: input.runId,
      name: input.name,
      status: 'RUNNING',
      startedAt: now,
    },
  });
}

/**
 * Once a workspace has used its monthly AI budget, its audits keep running on
 * the built-in rules instead of the AI, so one account can't run up the bill.
 */
async function withinAiBudget(deps: AuditDependencies, job: AuditJobData): Promise<AuditDependencies> {
  const usage = await orgUsage(deps.prisma, job.organizationId).catch(() => null);
  if (!usage || usage.aiSpendUsd < usage.limits.aiBudgetUsd) return deps;
  deps.logger.warn({ runId: job.runId, spent: usage.aiSpendUsd, budget: usage.limits.aiBudgetUsd }, 'monthly AI budget used up; running without AI');
  await appendEvent(deps.prisma, {
    organizationId: job.organizationId,
    runId: job.runId,
    kind: 'info',
    message: 'This workspace has used its AI budget for the month, so this audit uses the built-in checks only.',
  }).catch(() => undefined);
  const rules = createModelRouter({ provider: 'heuristic', model: 'heuristic' });
  return { ...deps, ai: rules, explorer: new ExplorerAgent(rules) };
}

export async function executeAuditRun(
  deps: AuditDependencies,
  job: AuditJobData,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  // Every browser opened during this run uses the run's device (desktop, phone, Safari, iPhone).
  const target = await deps.prisma.run.findUnique({ where: { id: job.runId }, select: { device: true } });
  return runWithDevice(target?.device, async () => executeAuditRunOnDevice(await withinAiBudget(deps, job), job, options));
}

async function executeAuditRunOnDevice(
  deps: AuditDependencies,
  job: AuditJobData,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const run = await deps.prisma.run.findUnique({
    where: { id: job.runId },
    include: { project: true, environment: true },
  });
  if (!run || run.status === 'CANCELLED') {
    return;
  }

  const targetUrl = run.baseUrlOverride ?? run.environment?.baseUrl ?? run.project.baseUrl;
  const limits: ExplorationLimits = {
    maxPages: run.project.maxPages,
    maxActions: run.project.maxActions,
    maxDepth: run.project.maxDepth,
    maxDurationMs: run.project.maxDurationMs,
    allowDestructive: run.project.allowDestructive,
  };

  const manager = new BrowserManager();
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let guard: SafetyGuard | undefined;
  let livePhase = 'starting';
  const live = new LiveStreamer(createLivePublisher(deps, job.runId, () => livePhase), { fps: 2 });

  try {
    await setRunStatus(deps.prisma, run.id, 'INITIALIZING', { startedAt: run.startedAt ?? new Date() });
    await startStage(deps.prisma, { organizationId: run.organizationId, runId: run.id, name: 'initialize' });
    await appendEvent(deps.prisma, {
      organizationId: run.organizationId,
      runId: run.id,
      kind: 'stage',
      message: 'Initializing isolated browser context',
      url: targetUrl,
    });

    try {
      await assertSafeNavigationTarget(targetUrl, { allowPrivate: run.project.allowPrivateTargets });
    } catch (error) {
      const message = error instanceof UnsafeTargetError ? error.message : 'Target URL failed SSRF validation';
      throw new UnrecoverableError(message);
    }

    const safety = await resolveSafetyMode({
      // An environment can override the project's mode (e.g. production read-only, staging full).
      requested: run.environment?.safetyMode ?? run.project.safetyMode,
      targetUrl,
      verifiedHost: run.project.verifiedHost,
      verifiedAt: run.project.verifiedAt,
      verifiedHosts: asStringArray(run.project.verifiedHosts),
      allowPrivate: run.project.allowPrivateTargets,
    });
    await deps.prisma.run.update({ where: { id: run.id }, data: { effectiveSafetyMode: safety.mode } });
    await appendEvent(deps.prisma, {
      organizationId: run.organizationId,
      runId: run.id,
      kind: safety.downgraded ? 'warning' : 'info',
      message: safety.message,
      url: targetUrl,
    });
    if (safety.mode === 'FULL' && run.project.resetHookUrl) {
      await callResetHook(deps, {
        runId: run.id,
        organizationId: run.organizationId,
        url: run.project.resetHookUrl,
        allowPrivate: run.project.allowPrivateTargets,
      });
    }

    const credential = await deps.prisma.credential.findFirst({
      where: { projectId: run.projectId, organizationId: run.organizationId },
      // A saved session (STORAGE_STATE) wins over a password: it is how SSO/MFA apps are audited.
      orderBy: [{ type: 'desc' }, { createdAt: 'asc' }],
    });
    let presetStorageState: unknown;
    if (credential?.type === 'STORAGE_STATE') {
      if (!credential.secretCiphertext) {
        throw new UnrecoverableError('Stored session is missing its encrypted state');
      }
      try {
        presetStorageState = JSON.parse(await deps.secrets.decrypt(credential.secretCiphertext));
      } catch {
        throw new UnrecoverableError('Stored session could not be decrypted or is not valid JSON');
      }
    }

    context = await manager.createContext(presetStorageState ? { storageState: presetStorageState as never } : {});
    guard = await installSafetyGuard(context, {
      mode: safety.mode,
      allowPrivate: run.project.allowPrivateTargets,
      targetOrigin: new URL(targetUrl).origin,
      blockedPathPatterns: asStringArray(run.project.blockedPathPatterns),
    });
    guard.setPhase('auth');
    page = await manager.createPage(context);
    await live.attach(page);
    livePhase = 'opening';
    await live.setAction({ kind: 'navigate', label: `Opening ${targetUrl}` });
    const observer = new PageObserver();
    observer.attach(page);

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForPageSettle(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Navigation failed';
      if (/net::|Timeout|NS_ERROR/i.test(message)) {
        throw error;
      }
      throw new UnrecoverableError(`Could not open target application: ${message}`);
    }

    await completeStage(deps.prisma, { organizationId: run.organizationId, runId: run.id, name: 'initialize' });

    const preAuth = await observer.observe(page);
    await deps.storage.put({
      key: `runs/${run.id}/login-semantic.json`,
      body: Buffer.from(JSON.stringify(preAuth.semantic)),
      contentType: 'application/json',
    });
    await deps.storage.put({
      key: `runs/${run.id}/ui-catalog.json`,
      body: Buffer.from(JSON.stringify(catalogFromSemantic(preAuth.semantic))),
      contentType: 'application/json',
    });

    await setRunStatus(deps.prisma, run.id, 'AUTHENTICATING', { currentUrl: page.url() });
    await startStage(deps.prisma, { organizationId: run.organizationId, runId: run.id, name: 'authenticate' });
    await appendEvent(deps.prisma, {
      organizationId: run.organizationId,
      runId: run.id,
      kind: 'stage',
      message: 'Checking authentication',
      url: page.url(),
    });

    livePhase = 'authenticating';
    await live.setAction({ kind: 'info', label: 'Checking whether a login is needed' });
    const authenticator = new UsernamePasswordAuthenticator();
    const login = await authenticator.detectLogin(page);

    if (login.detected && credential?.type === 'STORAGE_STATE') {
      await setRunStatus(deps.prisma, run.id, 'FAILED', {
        errorMessage:
          'AUTHENTICATION_REQUIRED: the saved browser session was rejected (it has probably expired). Upload a fresh storage state.',
        currentAction: 'authentication-required',
        currentUrl: page.url(),
        completedAt: new Date(),
      });
      throw new UnrecoverableError('Saved browser session was rejected; a login page is still shown');
    }

    if (login.detected && !credential) {
      const screenshotKey = `runs/${run.id}/login.png`;
      await deps.storage.put({
        key: screenshotKey,
        body: preAuth.screenshot,
        contentType: 'image/png',
      });
      await completeStage(deps.prisma, {
        organizationId: run.organizationId,
        runId: run.id,
        name: 'authenticate',
        status: 'FAILED',
        error: 'AUTHENTICATION_REQUIRED',
      });
      await setRunStatus(deps.prisma, run.id, 'AUTHENTICATING', {
        errorMessage: 'AUTHENTICATION_REQUIRED: login page detected but no credentials are configured',
        currentAction: 'authentication-required',
        currentUrl: page.url(),
        lastScreenshotKey: screenshotKey,
      });
      throw new AuthenticationRequiredError(
        'Login page detected but no credentials are configured. Add a USERNAME_PASSWORD credential to continue.',
      );
    }

    if (credential && credential.type !== 'STORAGE_STATE') {
      if (credential.type !== 'USERNAME_PASSWORD') {
        await setRunStatus(deps.prisma, run.id, 'AUTHENTICATING', {
          errorMessage: `AUTHENTICATION_REQUIRED: unsupported authentication type ${credential.type}`,
          currentAction: 'authentication-required',
        });
        throw new AuthenticationRequiredError(`Unsupported authentication type: ${credential.type}`);
      }
      if (!credential.secretCiphertext) {
        throw new UnrecoverableError('Stored credential is missing an encrypted secret');
      }
      const password = await deps.secrets.decrypt(credential.secretCiphertext);
      deps.logger.info({ runId: run.id, username: credential.username }, 'submitting username/password authentication');
      const result = await authenticator.authenticate(page, {
        username: credential.username,
        password,
        baseUrl: targetUrl,
      });
      if (!result.authenticated) {
        const screenshotKey = `runs/${run.id}/login-failed.png`;
        await deps.storage
          .put({
            key: screenshotKey,
            body: await page.screenshot({ type: 'png' }),
            contentType: 'image/png',
          })
          .catch(() => undefined);
        await setRunStatus(deps.prisma, run.id, 'FAILED', {
          errorMessage: result.reason ?? 'Authentication failed',
          currentAction: 'authentication-required',
          currentUrl: page.url(),
          lastScreenshotKey: screenshotKey,
          completedAt: new Date(),
        }).catch(() => undefined);
        throw new UnrecoverableError(result.reason ?? 'Authentication failed');
      }
    }

    await completeStage(deps.prisma, { organizationId: run.organizationId, runId: run.id, name: 'authenticate' });
    guard.setPhase('audit');

    const storageState = await context.storageState();
    const storageStateKey = `runs/${run.id}/storage-state.json`;
    await deps.storage.put({
      key: storageStateKey,
      body: Buffer.from(JSON.stringify(storageState)),
      contentType: 'application/json',
    });
    await deps.prisma.run.update({
      where: { id: run.id },
      data: { storageStateKey },
    });

    let replay: RecordedDecision[] = [];
    if (run.replayOfRunId) {
      try {
        replay = JSON.parse(
          (await deps.storage.get(`runs/${run.replayOfRunId}/ai-decisions.json`)).toString('utf8'),
        ) as RecordedDecision[];
        await appendEvent(deps.prisma, {
          organizationId: run.organizationId,
          runId: run.id,
          kind: 'info',
          message: `Replaying ${replay.length} recorded exploration decisions from run ${run.replayOfRunId}`,
        });
      } catch {
        await appendEvent(deps.prisma, {
          organizationId: run.organizationId,
          runId: run.id,
          kind: 'warning',
          message: `Run ${run.replayOfRunId} has no recorded decisions; exploring normally`,
        });
      }
    }
    const recorder = new RecordingExplorer(deps.explorer, replay);
    const activeGuard = guard;
    livePhase = 'exploring';

    await discoverAndExplore(
      { ...deps, explorer: recorder },
      {
        runId: run.id,
        organizationId: run.organizationId,
        projectId: run.projectId,
        page,
        observer,
        limits,
        signal: options.signal,
        live,
        beforePipeline: async () => {
          livePhase = 'testing';
          await live.setAction({ kind: 'info', label: 'Exploration finished. Generating tests' });
          await live.stop();
          await deps.storage.put({
            key: `runs/${run.id}/ai-decisions.json`,
            body: Buffer.from(JSON.stringify(recorder.recorded)),
            contentType: 'application/json',
          });
          await deps.storage.put({
            key: `runs/${run.id}/blocked-requests.json`,
            body: Buffer.from(JSON.stringify(activeGuard.blocked)),
            contentType: 'application/json',
          });
          if (run.replayOfRunId) {
            await appendEvent(deps.prisma, {
              organizationId: run.organizationId,
              runId: run.id,
              kind: 'info',
              message: `Replay reused ${recorder.replayHits} recorded decisions; ${recorder.replayMisses} screens differed and were explored fresh`,
            });
          }
        },
      },
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      await appendEvent(deps.prisma, {
        organizationId: run.organizationId,
        runId: run.id,
        kind: 'error',
        message: error.message,
        url: page?.url(),
      }).catch(() => undefined);
      deps.logger.warn({ runId: run.id }, error.message);
      return;
    }
    const message = error instanceof Error ? error.message : 'Audit failed';
    deps.logger.error({ runId: run.id, err: error }, 'audit failed');
    await appendEvent(deps.prisma, {
      organizationId: run.organizationId,
      runId: run.id,
      kind: 'error',
      message,
      url: page?.url(),
    }).catch(() => undefined);
    await setRunStatus(deps.prisma, run.id, 'FAILED', {
      errorMessage: message.slice(0, 2000),
      completedAt: new Date(),
    }).catch(() => undefined);
    if (error instanceof UnrecoverableError || error instanceof UnsafeTargetError) {
      throw error instanceof UnrecoverableError ? error : new UnrecoverableError(message);
    }
    throw error;
  } finally {
    await live.stop().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await manager.close().catch(() => undefined);
  }
}

async function discoverAndExplore(
  deps: AuditDependencies,
  input: {
    runId: string;
    organizationId: string;
    projectId: string;
    page: Page;
    observer: PageObserver;
    limits: ExplorationLimits;
    signal?: AbortSignal;
    beforePipeline?: () => Promise<void>;
    live?: LiveStreamer;
  },
): Promise<void> {
  const graph = new StateGraph();
  const extractor = new ActionExtractor();
  const blocked = new Set<string>();
  const startedAt = Date.now();
  const visitedPages = new Set<string>();
  let depth = 0;
  let actionsExecuted = 0;

  await setRunStatus(deps.prisma, input.runId, 'DISCOVERING', { currentUrl: input.page.url() });
  await startStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'discover' });

  const persistObservation = async (depthValue: number) => {
    const observation = await input.observer.observe(input.page);
    const fingerprint = fingerprintState(observation.semantic);
    const screenshotKey = `runs/${input.runId}/screenshots/${fingerprint}.png`;
    const domKey = `runs/${input.runId}/dom/${fingerprint}.html`;
    const a11yKey = `runs/${input.runId}/a11y/${fingerprint}.json`;
    await deps.storage.put({ key: screenshotKey, body: observation.screenshot, contentType: 'image/png' });
    await deps.storage.put({
      key: domKey,
      body: Buffer.from(observation.dom),
      contentType: 'text/html',
    });
    await deps.storage.put({
      key: a11yKey,
      body: Buffer.from(JSON.stringify(observation.accessibilityTree)),
      contentType: 'application/json',
    });
    const telemetryKey = `runs/${input.runId}/telemetry/${fingerprint}.json`;
    await deps.storage.put({
      key: telemetryKey,
      body: Buffer.from(
        JSON.stringify({
          console: observation.console,
          networkFailures: observation.networkFailures,
          pageErrors: observation.pageErrors.map((item) => item.text),
          brokenImages: observation.semantic.brokenImages ?? [],
          url: observation.semantic.url,
        }),
      ),
      contentType: 'application/json',
    });

    const pageRow = await deps.prisma.page.findFirst({
      where: { runId: input.runId, url: observation.semantic.url },
    });
    const pageRecord = pageRow
      ? await deps.prisma.page.update({
          where: { id: pageRow.id },
          data: {
            title: observation.semantic.title,
            screenshotKey,
            domStorageKey: domKey,
            a11yStorageKey: a11yKey,
          },
        })
      : await deps.prisma.page.create({
          data: {
            organizationId: input.organizationId,
            runId: input.runId,
            projectId: input.projectId,
            url: observation.semantic.url,
            title: observation.semantic.title,
            screenshotKey,
            domStorageKey: domKey,
            a11yStorageKey: a11yKey,
          },
        });
    visitedPages.add(observation.semantic.url);

    const knownFingerprint = graph.hasState(fingerprint);
    const actions = extractor.extract(observation.semantic, { allowDestructive: input.limits.allowDestructive });
    const graphState = graph.addState({
      fingerprint,
      url: observation.semantic.url,
      title: observation.semantic.title,
      screenshotKey,
      depth: depthValue,
        metadata: {
          route: observation.semantic.route,
          modalOpen: observation.semantic.modalOpen,
          importantText: observation.semantic.importantText,
          contentSignature: observation.semantic.contentSignature,
          elements: observation.semantic.elements,
          listItems: observation.semantic.listItems ?? [],
          brokenImages: observation.semantic.brokenImages ?? [],
        },
      availableActionKeys: actions.map((action) => action.stableKey),
    });

    await deps.prisma.state.upsert({
      where: { runId_fingerprint: { runId: input.runId, fingerprint } },
      create: {
        organizationId: input.organizationId,
        runId: input.runId,
        pageId: pageRecord.id,
        name: nameForState(observation.semantic).slice(0, 160),
        fingerprint,
        url: observation.semantic.url,
        title: observation.semantic.title,
        screenshotKey,
        metadata: {
          route: observation.semantic.route,
          modalOpen: observation.semantic.modalOpen,
          importantText: observation.semantic.importantText,
          contentSignature: observation.semantic.contentSignature,
          elements: observation.semantic.elements,
          listItems: observation.semantic.listItems ?? [],
          brokenImages: observation.semantic.brokenImages ?? [],
        },
        visited: false,
        depth: depthValue,
      },
      update: {
        name: nameForState(observation.semantic).slice(0, 160),
        url: observation.semantic.url,
        title: observation.semantic.title,
        screenshotKey,
        metadata: {
          route: observation.semantic.route,
          modalOpen: observation.semantic.modalOpen,
          importantText: observation.semantic.importantText,
          contentSignature: observation.semantic.contentSignature,
          elements: observation.semantic.elements,
          listItems: observation.semantic.listItems ?? [],
          brokenImages: observation.semantic.brokenImages ?? [],
        },
      },
    });

    if (!knownFingerprint) {
      await deps.prisma.evidence.create({
        data: {
          organizationId: input.organizationId,
          runId: input.runId,
          type: 'SCREENSHOT',
          storageKey: screenshotKey,
          contentType: 'image/png',
          fileName: `${fingerprint}.png`,
          byteLength: observation.screenshot.byteLength,
        },
      });
    }

    const catalogKey = `runs/${input.runId}/ui-catalog.json`;
    let existingCatalog: DiscoveredElement[] = [];
    try {
      existingCatalog = JSON.parse((await deps.storage.get(catalogKey)).toString('utf8')) as DiscoveredElement[];
    } catch {
      existingCatalog = [];
    }
    const observed = catalogFromSemantic(observation.semantic);
    await deps.storage.put({
      key: catalogKey,
      body: Buffer.from(JSON.stringify([...existingCatalog, ...observed])),
      contentType: 'application/json',
    });

    await deps.prisma.run.update({
      where: { id: input.runId },
      data: {
        currentUrl: observation.semantic.url,
        pagesDiscovered: Math.max(visitedPages.size, graph.listStates().length),
        statesDiscovered: graph.listStates().length,
        lastScreenshotKey: screenshotKey,
      },
    });

    return { observation, fingerprint, graphState, actions, pageRecord };
  };

  const initial = await persistObservation(0);
  graph.markVisited(initial.fingerprint, initial.actions.map((action) => action.stableKey));
  await deps.prisma.state.update({
    where: { runId_fingerprint: { runId: input.runId, fingerprint: initial.fingerprint } },
    data: { visited: true },
  });
  await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'discover' });
  if (deps.explorationQueue) {
    await deps.explorationQueue.add(DISCOVER_APPLICATION_JOB, {
      runId: input.runId,
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
    await deps.explorationQueue.add(EXPLORE_STATE_JOB, {
      runId: input.runId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      fingerprint: initial.fingerprint,
      stateId: initial.graphState.id,
    });
  }

  await setRunStatus(deps.prisma, input.runId, 'EXPLORING');
  await startStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'explore' });

  const tried = new Set<string>();
  const preferKeys = new Set<string>();
  let current = initial;
  // Screens seen so far and the actions they offered, so the explorer can go back
  // to a screen with untried actions when it reaches a dead end (an error page,
  // a screen without navigation) instead of stopping.
  const frontier = new Map<string, { url: string; actions: CandidateAction[] }>();
  const backtrackVisits = new Map<string, number>();
  frontier.set(initial.fingerprint, { url: initial.observation.semantic.url, actions: initial.actions });

  const explorable = (action: CandidateAction) =>
    !tried.has(action.stableKey) &&
    !blocked.has(action.stableKey) &&
    action.category !== 'chrome' &&
    action.category !== 'other' &&
    (action.type !== 'fill' || action.category === 'search');

  const backtrack = async (): Promise<typeof initial | null> => {
    for (const [fingerprint, entry] of frontier) {
      if (fingerprint === current.fingerprint) continue;
      if ((backtrackVisits.get(fingerprint) ?? 0) >= 2) continue;
      if (!entry.actions.some(explorable)) continue;
      backtrackVisits.set(fingerprint, (backtrackVisits.get(fingerprint) ?? 0) + 1);
      try {
        await input.page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await waitForSpaSettle(input.page);
      } catch {
        continue;
      }
      actionsExecuted += 1;
      await input.live?.setAction({ kind: 'navigate', label: `Back to ${entry.url}` });
      await appendEvent(deps.prisma, {
        organizationId: input.organizationId,
        runId: input.runId,
        kind: 'info',
        message: `Went back to ${entry.url} to explore what is left there`,
        url: entry.url,
      });
      const observed = await persistObservation(graph.listStates().length);
      frontier.set(observed.fingerprint, { url: observed.observation.semantic.url, actions: observed.actions });
      return observed;
    }
    return null;
  };

  const sameOriginHref = (href: string): string | null => {
    try {
      const target = new URL(href, input.page.url());
      const currentUrl = new URL(input.page.url());
      if (target.origin !== currentUrl.origin) {
        return null;
      }
      if (target.pathname === currentUrl.pathname && target.hash === currentUrl.hash && target.search === currentUrl.search) {
        return null;
      }
      return target.toString();
    } catch {
      return null;
    }
  };

  while (true) {
    if (input.signal?.aborted) {
      break;
    }
    const latest = await deps.prisma.run.findUnique({ where: { id: input.runId } });
    if (!latest || isTerminalRunStatus(latest.status) || latest.status === 'CANCELLED') {
      break;
    }
    const halt = shouldStopExploration(
      {
        pagesVisited: Math.max(visitedPages.size, graph.listStates().length),
        actionsExecuted,
        depth: 0,
        startedAt,
      },
      input.limits,
    );
    if (halt.stop) {
      await appendEvent(deps.prisma, {
        organizationId: input.organizationId,
        runId: input.runId,
        kind: 'info',
        message: `Exploration stopped: ${halt.reason}`,
        url: input.page.url(),
      });
      break;
    }

    const remaining = current.actions.filter(
      (action) => !tried.has(action.stableKey) && !blocked.has(action.stableKey),
    );
    const preferred = remaining.filter((action) => preferKeys.has(action.stableKey));
    const expanders = remaining.filter((action) => action.category === 'menu');
    const leaves = remaining.filter((action) => action.category === 'navigation');
    const searches = remaining.filter((action) => action.category === 'search' && action.type === 'fill');
    const available =
      preferred.length > 0
        ? preferred
        : expanders.length > 0
          ? expanders
          : leaves.length > 0
            ? leaves
            : searches.length > 0
              ? searches
              : remaining.filter(
                  (action) =>
                    action.category !== 'chrome' &&
                    action.type !== 'fill' &&
                    action.category !== 'other',
                );
    if (available.length === 0) {
      graph.markVisited(current.fingerprint);
      const next = await backtrack();
      if (!next) {
        break;
      }
      current = next;
      continue;
    }

    const decision = await deps.explorer.choose({
      page: current.observation.semantic,
      actions: available,
      blockedKeys: blocked,
      preferKeys,
    });
    const chosen = available.find((action) => action.id === decision.chosenActionId) ?? available[0];
    if (!chosen) {
      graph.markVisited(current.fingerprint);
      break;
    }

    const actionSummary = describeAction(chosen);
    await deps.prisma.run.update({
      where: { id: input.runId },
      data: { currentAction: actionSummary, currentUrl: input.page.url() },
    });
    await appendEvent(deps.prisma, {
      organizationId: input.organizationId,
      runId: input.runId,
      kind: 'action',
      message: actionSummary,
      url: input.page.url(),
    });

    if (input.live) {
      const box =
        chosen.type === 'goto' || chosen.type === 'dismiss'
          ? null
          : await LiveStreamer.boxOf(locatorFor(input.page, chosen));
      await input.live.setAction({
        kind: chosen.type === 'fill' ? 'type' : chosen.type === 'select' ? 'select' : chosen.type === 'goto' ? 'navigate' : 'click',
        label: actionSummary,
        box,
      });
    }
    const keysBefore = new Set(current.actions.map((action) => action.stableKey));
    const viewBefore = current.fingerprint;
    const started = Date.now();
    let success = true;
    try {
      await executeCandidateAction(input.page, chosen);
      await input.page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await waitForSpaSettle(input.page);
    } catch {
      success = false;
    }
    actionsExecuted += 1;
    tried.add(chosen.stableKey);
    depth = Math.max(depth, graph.listStates().length);

    let after = await persistObservation(graph.listStates().length);
    if (after.fingerprint === viewBefore && !isPlaceholderHref(chosen.href)) {
      const target = sameOriginHref(chosen.href ?? '');
      if (target) {
        try {
          await input.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          await waitForSpaSettle(input.page);
          after = await persistObservation(graph.listStates().length);
          success = true;
        } catch {
          /* click already recorded */
        }
      }
    }

    const newKeys = after.actions.filter((action) => !keysBefore.has(action.stableKey)).map((action) => action.stableKey);
    const viewChanged = after.fingerprint !== viewBefore;

    if (viewChanged) {
      preferKeys.delete(chosen.stableKey);
      graph.addTransition({
        sourceState: current.graphState,
        destinationState: after.graphState,
        action: {
          type: chosen.type,
          target: chosen.target,
          input: chosen.type === 'fill' ? chosen.input : null,
          riskLevel: chosen.riskLevel,
          reason: decision.reason,
          stableKey: chosen.stableKey,
          success,
          durationMs: Date.now() - started,
        },
      });
      const screenName = nameForState(after.observation.semantic);
      await deps.prisma.run.update({
        where: { id: input.runId },
        data: { currentAction: `Reached ${screenName}`, currentUrl: after.observation.semantic.url },
      });
      await appendEvent(deps.prisma, {
        organizationId: input.organizationId,
        runId: input.runId,
        kind: 'page',
        message: `Reached ${screenName}`,
        url: after.observation.semantic.url,
      });
    } else if (newKeys.length > 0) {
      for (const key of newKeys) {
        preferKeys.add(key);
      }
      await appendEvent(deps.prisma, {
        organizationId: input.organizationId,
        runId: input.runId,
        kind: 'info',
        message: `Expanded "${chosen.label}" and found ${newKeys.length} more menu items`,
        url: after.observation.semantic.url,
      });
    } else {
      blocked.add(chosen.stableKey);
      preferKeys.delete(chosen.stableKey);
    }

    const sourceState = await deps.prisma.state.findUniqueOrThrow({
      where: { runId_fingerprint: { runId: input.runId, fingerprint: current.fingerprint } },
    });
    const destinationState = await deps.prisma.state.findUniqueOrThrow({
      where: { runId_fingerprint: { runId: input.runId, fingerprint: after.fingerprint } },
    });
    const persistedAction = await deps.prisma.action.create({
      data: {
        organizationId: input.organizationId,
        runId: input.runId,
        type: chosen.type,
        selector: chosen.target,
        value: chosen.type === 'fill' ? chosen.input : null,
        target: chosen.target,
        input: chosen.type === 'fill' ? chosen.input : null,
        sourceStateId: sourceState.id,
        destinationStateId: destinationState.id,
        success,
        durationMs: Date.now() - started,
        riskLevel: chosen.riskLevel,
        reason: decision.reason,
        label: chosen.label,
        category: chosen.category,
        href: chosen.href,
        selectors: chosen.selectors as Prisma.InputJsonValue,
      },
    });
    if (viewChanged && sourceState.id !== destinationState.id) {
      await deps.prisma.stateEdge.create({
        data: {
          organizationId: input.organizationId,
          runId: input.runId,
          fromStateId: sourceState.id,
          toStateId: destinationState.id,
          actionId: persistedAction.id,
        },
      });
    }
    await deps.prisma.state.update({
      where: { runId_fingerprint: { runId: input.runId, fingerprint: after.fingerprint } },
      data: { visited: true },
    });
    await deps.prisma.run.update({
      where: { id: input.runId },
      data: {
        actionsExecuted,
        statesDiscovered: graph.listStates().length,
        pagesDiscovered: Math.max(visitedPages.size, graph.listStates().length),
      },
    });
    frontier.set(after.fingerprint, { url: after.observation.semantic.url, actions: after.actions });
    current = after;
  }

  if (await isRunCancelled(deps.prisma, input.runId)) {
    await input.live?.setAction({ kind: 'info', label: 'Run cancelled' });
    await appendEvent(deps.prisma, {
      organizationId: input.organizationId,
      runId: input.runId,
      kind: 'info',
      message: 'Run cancelled; stopped before generating tests',
    });
    return;
  }
  await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'explore' });
  await setRunStatus(deps.prisma, input.runId, 'FINALIZING');
  await startStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'finalize' });

  const routes = new Set(
    graph.listStates().map((state) => {
      const metadata = (state.metadata ?? {}) as { route?: string; importantText?: unknown; modalOpen?: boolean };
      const headings = Array.isArray(metadata.importantText) ? metadata.importantText.map(String) : [];
      try {
        return nameForState({
          url: state.url,
          title: state.title,
          route: metadata.route || new URL(state.url).pathname,
          modalOpen: metadata.modalOpen === true,
          importantText: headings,
          elements: [],
        });
      } catch {
        return state.title || 'Root';
      }
    }),
  );
  let flows = 0;
  for (const route of routes) {
    await deps.prisma.flow.create({
      data: {
        organizationId: input.organizationId,
        runId: input.runId,
        projectId: input.projectId,
        name: route || 'Root',
        description: `Discovered application area ${route}`,
      },
    });
    flows += 1;
  }

  await completeStage(deps.prisma, { organizationId: input.organizationId, runId: input.runId, name: 'finalize' });
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'stage',
    message: `Exploration complete with ${graph.listStates().length} states`,
    url: input.page.url(),
  });
  await deps.prisma.run.update({
    where: { id: input.runId },
    data: {
      flowsDiscovered: flows,
      statesDiscovered: graph.listStates().length,
      pagesDiscovered: Math.max(visitedPages.size, graph.listStates().length),
      actionsExecuted,
      currentAction: null,
    },
  });

  await input.beforePipeline?.();
  const { runPostExplorationPipeline } = await import('./pipeline.js');
  await runPostExplorationPipeline(deps, {
    runId: input.runId,
    organizationId: input.organizationId,
    projectId: input.projectId,
  });
}

export async function processDiscoverJob(
  deps: AuditDependencies,
  data: AuditJobData & { storageStateKey?: string },
): Promise<void> {
  const run = await deps.prisma.run.findUnique({ where: { id: data.runId } });
  if (!run || isTerminalRunStatus(run.status) || run.status === 'EXPLORING' || run.status === 'DISCOVERING') {
    return;
  }
  await executeAuditRun(deps, data);
}

export async function processExploreStateJob(
  deps: AuditDependencies,
  data: AuditJobData,
): Promise<void> {
  const run = await deps.prisma.run.findUnique({ where: { id: data.runId } });
  if (!run || isTerminalRunStatus(run.status)) {
    return;
  }
  if (run.status === 'QUEUED' || run.status === 'INITIALIZING' || run.status === 'AUTHENTICATING') {
    await executeAuditRun(deps, data);
  }
}

function locatorFor(page: Page, action: CandidateAction) {
  return locatorFromSelectors(page, action.selectors).first();
}
