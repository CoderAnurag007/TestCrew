import { BrowserManager, installSafetyGuard, type LiveStreamer } from '@auditor/browser';
import type { CustomJourney, JourneyResult, ResolvedCategory, TestPlan } from '@auditor/shared';
import type { RunPermissions } from '../safety-mode.js';
import { runCustomJourney } from './custom.js';
import { PACKS, type JourneyDefinition, type JourneyRequirement, type SharedState } from './packs.js';
import { JourneyContext, type StoredShot } from './toolkit.js';

export interface JourneyRunInput {
  category: ResolvedCategory;
  plan: TestPlan;
  permissions: RunPermissions;
  baseUrl: string;
  storageState?: unknown;
  allowPrivate: boolean;
  blockedPathPatterns: string[];
  token: string;
  budgetMs: number;
  live?: LiveStreamer;
  saveShot: (journeyId: string, name: string, body: Buffer) => Promise<StoredShot>;
  onProgress?: (message: string) => Promise<void>;
}

const JOURNEY_TIMEOUT_MS = 150_000;

/**
 * Runs the category's journeys (plus the generic ones and the project's custom
 * journeys). Each journey gets a fresh browser context with the audit's
 * session and its own safety guard: transactions and sandbox payments are only
 * allowed for the journeys that need them, and only when the run permits it.
 */
export async function runJourneys(input: JourneyRunInput): Promise<JourneyResult[]> {
  const deadline = Date.now() + input.budgetMs;
  const disabled = new Set(input.plan.disabledJourneys);
  const builtIn: JourneyDefinition[] = [
    ...PACKS[input.category],
    ...(input.category === 'generic' ? [] : PACKS.generic),
  ].filter((journey) => !disabled.has(journey.id));
  const custom = input.plan.customJourneys.filter((journey) => journey.enabled);
  const results: JourneyResult[] = [];
  const shared: SharedState = {};
  let transactionsUsed = 0;
  const manager = new BrowserManager();

  try {
    const queue: Array<{ kind: 'pack'; journey: JourneyDefinition } | { kind: 'custom'; journey: CustomJourney }> = [
      ...builtIn.map((journey) => ({ kind: 'pack' as const, journey })),
      ...custom.map((journey) => ({ kind: 'custom' as const, journey })),
    ];
    for (const item of queue) {
      const requires: JourneyRequirement =
        item.kind === 'pack' ? item.journey.requires : item.journey.transactional ? 'transaction' : item.journey.mutates ? 'full' : 'readonly';
      const base = {
        id: item.kind === 'pack' ? item.journey.id : `custom:${item.journey.id}`,
        name: item.journey.name,
        category: item.kind === 'pack' ? item.journey.category : ('custom' as const),
        requires,
      };
      if (Date.now() > deadline) {
        results.push({ ...base, status: 'skipped', reason: 'The journey time budget ran out.', steps: [], durationMs: 0 });
        continue;
      }
      const gate = gateFor(requires, input.permissions);
      if (gate) {
        results.push({ ...base, status: 'blocked', reason: gate, steps: [], durationMs: 0 });
        continue;
      }
      const transactional = requires === 'transaction' || requires === 'payment';
      if (transactional && transactionsUsed >= input.plan.transactions.maxPerRun) {
        results.push({ ...base, status: 'skipped', reason: `The test plan allows ${input.plan.transactions.maxPerRun} order(s) per run.`, steps: [], durationMs: 0 });
        continue;
      }
      if (transactional) transactionsUsed += 1;

      await input.onProgress?.(`Journey: ${base.name}`);
      const started = Date.now();
      const signedOut = item.kind === 'pack' && item.journey.signedOut === true;
      const context = await manager.createContext(input.storageState && !signedOut ? { storageState: input.storageState as never } : {});
      const guard = await installSafetyGuard(context, {
        mode: input.permissions.mode,
        allowPrivate: input.allowPrivate,
        targetOrigin: new URL(input.baseUrl).origin,
        blockedPathPatterns: input.blockedPathPatterns,
        allowTransactions: transactional && input.permissions.transactionsAllowed,
        allowSandboxPayments: requires === 'payment' && input.permissions.paymentAllowed,
      });
      const page = await context.newPage();
      if (input.live) await input.live.attach(page).catch(() => undefined);
      const ctx = new JourneyContext({
        page,
        guard,
        plan: input.plan,
        permissions: input.permissions,
        baseUrl: input.baseUrl,
        token: input.token,
        live: input.live,
        journeyName: base.name,
        saveShot: (name, body) => input.saveShot(base.id, name, body),
      });
      let timedOut = false;
      try {
        const work = item.kind === 'pack' ? item.journey.run(ctx, shared) : runCustomJourney(ctx, item.journey);
        await Promise.race([
          work,
          new Promise<void>((resolve) =>
            setTimeout(() => {
              timedOut = true;
              resolve();
            }, (item.kind === 'pack' && item.journey.timeoutMs) || JOURNEY_TIMEOUT_MS).unref?.(),
          ),
        ]);
      } catch (error) {
        ctx.steps.push({
          index: ctx.steps.length + 1,
          goal: 'Journey stopped',
          status: 'failed',
          detail: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        });
      } finally {
        await context.close().catch(() => undefined);
      }
      results.push({ ...base, ...summarize(ctx.steps, timedOut), steps: ctx.steps, durationMs: Date.now() - started });
    }
  } finally {
    await manager.close().catch(() => undefined);
  }
  return results;
}

function gateFor(requires: JourneyRequirement, permissions: RunPermissions): string | null {
  if (requires === 'readonly') return null;
  if (requires === 'full') return permissions.mode === 'FULL' ? null : 'Needs Full mode; this run is read-only.';
  return permissions.transactionsAllowed ? null : permissions.transactionsReason;
}

function summarize(steps: JourneyResult['steps'], timedOut: boolean): { status: JourneyResult['status']; reason?: string } {
  if (timedOut) return { status: 'partial', reason: 'The journey ran out of time and was stopped.' };
  if (steps.length === 0) return { status: 'skipped', reason: 'No steps ran.' };
  const failedChecks = steps.some((step) => step.checks?.some((check) => !check.passed));
  if (failedChecks) return { status: 'failed' };
  const errored = steps.find((step) => step.status === 'failed');
  if (errored) return { status: 'partial', reason: `A step could not finish: ${errored.detail}` };
  const passed = steps.filter((step) => step.status === 'passed').length;
  const skipped = steps.find((step) => step.status === 'skipped');
  const blocked = steps.find((step) => step.status === 'blocked');
  if (skipped) return passed > 0 ? { status: 'partial', reason: skipped.detail } : { status: 'skipped', reason: skipped.detail };
  if (blocked) return passed > 0 ? { status: 'partial', reason: blocked.detail } : { status: 'blocked', reason: blocked.detail };
  return { status: 'passed' };
}
