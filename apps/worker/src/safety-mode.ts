import { assertSafeNavigationTarget, isPrivateOrReservedIp, isBlockedHostname } from '@auditor/shared/ssrf';
import { isSandboxTestCard, type EnvironmentKind, type SafetyMode, type TestPlan } from '@auditor/shared';
import { isIP } from 'node:net';
import type { AuditDependencies } from './engine.js';

/**
 * Decides the safety mode a run actually uses.
 *
 * FULL (mutating) mode against a public host needs proof of ownership: the
 * project's verified host must equal the host being audited. Local and private
 * targets (a developer's own machine, the fixture app) are exempt because the
 * person running the worker controls them. Anything else is downgraded to
 * READ_ONLY with a visible event, never silently.
 */
export async function resolveSafetyMode(input: {
  requested: SafetyMode;
  targetUrl: string;
  verifiedHost: string | null;
  verifiedAt: Date | null;
  /** Every host proven to belong to the project (production and staging). */
  verifiedHosts?: string[];
  allowPrivate: boolean;
}): Promise<{ mode: SafetyMode; downgraded: boolean; message: string }> {
  if (input.requested === 'READ_ONLY') {
    return { mode: 'READ_ONLY', downgraded: false, message: 'Safety mode: read-only. Requests that change data are blocked.' };
  }
  const host = new URL(input.targetUrl).host.toLowerCase();
  const hostname = new URL(input.targetUrl).hostname.toLowerCase();
  if (input.allowPrivate && isLocalTarget(hostname)) {
    return { mode: 'FULL', downgraded: false, message: `Safety mode: full, on private target ${host}. Payment and blocked paths stay blocked.` };
  }
  const verified = new Set((input.verifiedHosts ?? []).map((item) => item.toLowerCase()));
  if (input.verifiedAt && input.verifiedHost) verified.add(input.verifiedHost.toLowerCase());
  if (verified.has(host)) {
    return { mode: 'FULL', downgraded: false, message: `Safety mode: full, on verified domain ${host}. Payment and blocked paths stay blocked.` };
  }
  return {
    mode: 'READ_ONLY',
    downgraded: true,
    message: `Full mode was requested but ${host} is not verified for this project, so this run is read-only. Verify the domain in project settings to allow data changes.`,
  };
}

export interface RunPermissions {
  kind: EnvironmentKind;
  mode: SafetyMode;
  transactionsAllowed: boolean;
  transactionsReason: string;
  paymentAllowed: boolean;
  paymentReason: string;
}

/**
 * What a run may do beyond browsing. Each rule must hold; the first that fails
 * is reported so people see exactly why orders or payments were not tested.
 */
export function resolveRunPermissions(input: { kind: EnvironmentKind; mode: SafetyMode; plan: TestPlan }): RunPermissions {
  const base = { kind: input.kind, mode: input.mode };
  let transactionsReason = 'Orders and bookings are allowed on this staging environment.';
  let transactionsAllowed = true;
  if (!input.plan.transactions.enabled) {
    transactionsAllowed = false;
    transactionsReason = 'Orders and bookings are turned off in the test plan.';
  } else if (input.kind !== 'STAGING') {
    transactionsAllowed = false;
    transactionsReason = 'Orders and bookings only run on a Staging environment; this is Production.';
  } else if (input.mode !== 'FULL') {
    transactionsAllowed = false;
    transactionsReason = 'Orders and bookings need Full mode; this staging run is read-only.';
  }
  let paymentAllowed = transactionsAllowed;
  let paymentReason = 'Payment uses a sandbox test card; live payment keys are blocked.';
  if (!transactionsAllowed) {
    paymentAllowed = false;
    paymentReason = 'Payment is never reached because orders are not allowed on this run.';
  } else if (input.plan.payment.mode !== 'sandbox') {
    paymentAllowed = false;
    paymentReason = 'The test plan never pays (payment mode is "never").';
  } else if (!isSandboxTestCard(input.plan.payment.provider, input.plan.payment.cardNumber)) {
    paymentAllowed = false;
    paymentReason = 'The saved card is not a published sandbox test card.';
  } else if (input.plan.transactions.stopBefore === 'payment') {
    paymentAllowed = false;
    paymentReason = 'The test plan stops before payment.';
  }
  return { ...base, transactionsAllowed, transactionsReason, paymentAllowed, paymentReason };
}

function isLocalTarget(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) {
    return isPrivateOrReservedIp(bare);
  }
  return isBlockedHostname(bare);
}

/**
 * Calls the project's reset hook so every FULL run starts from known data.
 * A failing hook is reported but does not stop the run.
 */
export async function callResetHook(
  deps: Pick<AuditDependencies, 'prisma' | 'logger'>,
  input: { runId: string; organizationId: string; url: string; allowPrivate: boolean },
): Promise<void> {
  const started = Date.now();
  let message: string;
  let kind = 'info';
  try {
    await assertSafeNavigationTarget(input.url, { allowPrivate: input.allowPrivate });
    const response = await fetch(input.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-testcrew-run-id': input.runId },
      body: JSON.stringify({ runId: input.runId, event: 'before_audit' }),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) {
      message = `Reset hook returned HTTP ${response.status} in ${Date.now() - started} ms; the app starts from known data.`;
    } else {
      kind = 'warning';
      message = `Reset hook returned HTTP ${response.status}. Continuing, but data from earlier runs may affect results.`;
    }
  } catch (error) {
    kind = 'warning';
    message = `Reset hook failed: ${error instanceof Error ? error.message : 'unknown error'}. Continuing without a reset.`;
  }
  deps.logger.info({ runId: input.runId }, message);
  await deps.prisma.runEvent.create({
    data: { organizationId: input.organizationId, runId: input.runId, kind, message: message.slice(0, 2000) },
  });
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
