import { assertSafeNavigationTarget, UnsafeTargetError } from '@auditor/shared/ssrf';
import { LIVE_PAYMENT_KEY_PATTERN, TEST_PAYMENT_KEY_PATTERN } from '@auditor/shared';
import type { BrowserContext, Page, Request, Route } from 'playwright';

/**
 * Network-level safety for audits. Every request the browser makes passes
 * through here, so the rules hold no matter what a button says: an unlabeled
 * "✕", a "Yes" in a confirm dialog or text in another language all end up as
 * HTTP requests, and those are what we inspect.
 *
 * Modes:
 * - READ_ONLY: only GET/HEAD/OPTIONS leave the browser. POST bodies that are
 *   read-only GraphQL queries are allowed so SPAs still render. Mutations are
 *   allowed during the login step only, and only to the target origin.
 * - FULL: mutations are allowed, except to blocked paths and payment providers.
 *
 * In every mode: SSRF rules apply, payment providers never receive a mutating
 * request, and project-defined blocked paths are enforced.
 */
export type SafetyMode = 'READ_ONLY' | 'FULL';
export type SafetyPhase = 'auth' | 'audit';

export interface SafetyPolicy {
  mode: SafetyMode;
  allowPrivate: boolean;
  /** Origin of the application under test, e.g. https://shop.example.com */
  targetOrigin: string;
  /** Path patterns (with * wildcards) that never receive a mutating request. */
  blockedPathPatterns?: string[];
  /** Hostname lookups for SSRF checks; tests inject a fake. */
  resolver?: (hostname: string) => Promise<string[]>;
  /**
   * Orders and bookings may be placed (staging environments in FULL mode only).
   * Lifts the default checkout/order path blocks; project-defined blocked
   * paths and account-destroying paths stay blocked.
   */
  allowTransactions?: boolean;
  /**
   * Payment providers may be called, but only with sandbox credentials: a
   * request carrying a live key is blocked, and so is one that carries no
   * recognisable sandbox key.
   */
  allowSandboxPayments?: boolean;
}

export interface BlockedRequest {
  method: string;
  url: string;
  reason: string;
  at: string;
  /** Playwright resource type: document, xhr, fetch, ping, script... */
  resourceType?: string;
}

/**
 * Analytics and performance beacons. They POST, but they only record that a
 * page was viewed; they do not change the application's data. Blocking them
 * breaks nothing for the audit but makes every page look like it "needed" a
 * write, so they are let through even in read-only mode.
 */
const TELEMETRY = [
  /\/cdn-cgi\/(rum|beacon|challenge-platform)\b/i,
  /\/\.well-known\/shopify\/monorail/i,
  /\/(g|j|r)\/collect\b/i,
  /\/collect\?v=\d/i,
  /\/api\/(collect|telemetry|analytics)(\/|\?|$)/i,
  /\/(rum|beacon|vitals)(\/|\?|$)/i,
  /\/api\/\d+\/envelope\b/i,
];
const TELEMETRY_HOSTS = [
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'doubleclick.net',
  'facebook.com',
  'connect.facebook.net',
  'clarity.ms',
  'hotjar.com',
  'hotjar.io',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'sentry.io',
  'datadoghq.com',
  'newrelic.com',
  'nr-data.net',
  'cloudflareinsights.com',
  'tiktok.com',
  'snapchat.com',
  'bing.com',
  'pinterest.com',
];

export function isTelemetryRequest(url: URL, resourceType?: string): boolean {
  if (resourceType === 'ping' || resourceType === 'beacon') return true;
  const host = url.hostname.toLowerCase();
  if (TELEMETRY_HOSTS.some((item) => host === item || host.endsWith(`.${item}`))) return true;
  const path = `${url.pathname}${url.search}`;
  return TELEMETRY.some((pattern) => pattern.test(path));
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Payment processors and checkout hosts. A mutating request to these is never sent. */
const PAYMENT_HOSTS = [
  'stripe.com',
  'stripe.network',
  'paypal.com',
  'braintreegateway.com',
  'braintree-api.com',
  'adyen.com',
  'razorpay.com',
  'paytm.in',
  'paytm.com',
  'cashfree.com',
  'payu.in',
  'payumoney.com',
  'squareup.com',
  'checkout.com',
  'klarna.com',
  'afterpay.com',
  'authorize.net',
  'phonepe.com',
  'juspay.in',
  'ccavenue.com',
  'billdesk.com',
  'instamojo.com',
  'mollie.com',
  '2checkout.com',
  'worldpay.com',
];

/** Paths that are never written to, even when transactions are allowed. */
export const ALWAYS_BLOCKED_PATH_PATTERNS = ['*delete-account*', '*close-account*', '*deactivate*', '*unsubscribe*'];

/** Same-origin paths that are blocked for mutations unless the project explicitly removes them. */
export const DEFAULT_BLOCKED_PATH_PATTERNS = [
  '*checkout*',
  '*payment*',
  '*/pay',
  '*/pay/*',
  '*place-order*',
  '*placeorder*',
  '*place_order*',
  '*purchase*',
  '*/orders/create*',
  '*/order/create*',
  '*/order/confirm*',
  '*delete-account*',
  '*close-account*',
  '*deactivate*',
  '*unsubscribe*',
];

export class SafetyGuard {
  readonly blocked: BlockedRequest[] = [];
  private phase: SafetyPhase = 'audit';
  private readonly dnsCache = new Map<string, Promise<string | null>>();
  private readonly patterns: RegExp[];
  private readonly targetHost: string;

  constructor(private readonly policy: SafetyPolicy) {
    const defaults = policy.allowTransactions ? ALWAYS_BLOCKED_PATH_PATTERNS : DEFAULT_BLOCKED_PATH_PATTERNS;
    this.patterns = [...defaults, ...(policy.blockedPathPatterns ?? [])].map(globToRegExp);
    this.targetHost = new URL(policy.targetOrigin).host;
  }

  setPhase(phase: SafetyPhase): void {
    this.phase = phase;
  }

  get mode(): SafetyMode {
    return this.policy.mode;
  }

  async install(target: Page | BrowserContext): Promise<void> {
    await target.route('**/*', (route) => this.handle(route));
  }

  /** Pure decision function, exported for unit tests. Returns a reason when the request must be blocked. */
  async decide(
    request: Pick<Request, 'method' | 'url' | 'postData'> & { resourceType?: () => string; headers?: () => Record<string, string> },
  ): Promise<string | null> {
    const url = request.url();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 'Unparseable URL';
    }
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') {
      return null;
    }
    const ssrf = await this.ssrfReason(url, `${parsed.protocol}//${parsed.host}`);
    if (ssrf) {
      return ssrf;
    }

    const method = request.method().toUpperCase();
    if (!MUTATING.has(method)) {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    if (isTelemetryRequest(parsed, request.resourceType?.())) {
      return null;
    }
    const evidence = `${url}\n${request.postData() ?? ''}\n${request.headers?.().authorization ?? ''}`;
    if (LIVE_PAYMENT_KEY_PATTERN.test(evidence)) {
      // Never send anything that carries live payment credentials.
      return 'Request carries a live payment key; real payments are never made';
    }
    if (PAYMENT_HOSTS.some((item) => host === item || host.endsWith(`.${item}`))) {
      if (!this.policy.allowSandboxPayments) {
        return `Mutating request to payment provider ${host} is blocked (sandbox payments are not enabled)`;
      }
      if (!TEST_PAYMENT_KEY_PATTERN.test(evidence)) {
        return `Payment request to ${host} has no recognisable sandbox key, so it is blocked`;
      }
      return null;
    }

    const sameSite = parsed.host === this.targetHost;
    if (sameSite) {
      const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
      const hit = this.patterns.find((pattern) => pattern.test(path));
      if (hit) {
        return `Path ${parsed.pathname} matches a blocked pattern`;
      }
    }

    if (this.policy.mode === 'FULL') {
      return null;
    }

    if (this.phase === 'auth' && sameSite) {
      return null;
    }
    if (isReadOnlyGraphQl(request.postData())) {
      return null;
    }
    return `Read-only mode blocks ${method} requests`;
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    let reason: string | null;
    try {
      reason = await this.decide(request);
    } catch {
      reason = 'Safety check failed';
    }
    if (!reason) {
      await route.continue().catch(() => undefined);
      return;
    }
    if (this.blocked.length < 500) {
      this.blocked.push({
        method: request.method(),
        url: request.url().slice(0, 500),
        reason,
        at: new Date().toISOString(),
        resourceType: request.resourceType(),
      });
    }
    if (request.isNavigationRequest() && request.method().toUpperCase() !== 'GET') {
      // A blocked form post: show a clear page instead of a network error so the
      // explorer sees "nothing happened" and moves on.
      await route
        .fulfill({
          status: 409,
          headers: { 'x-testcrew-blocked': '1' },
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><title>Blocked by TestCrew</title><h1>Blocked by TestCrew safety mode</h1><p>${escapeHtml(reason)}</p>`,
        })
        .catch(() => undefined);
      return;
    }
    await route.abort('blockedbyclient').catch(() => undefined);
  }

  private ssrfReason(url: string, originKey: string): Promise<string | null> {
    const key = originKey.toLowerCase();
    let pending = this.dnsCache.get(key);
    if (!pending) {
      pending = assertSafeNavigationTarget(url, { allowPrivate: this.policy.allowPrivate, resolver: this.policy.resolver })
        .then(() => null)
        .catch((error: unknown) => (error instanceof UnsafeTargetError ? error.message : 'Unsafe target'));
      this.dnsCache.set(key, pending);
    }
    return pending;
  }
}

export async function installSafetyGuard(target: Page | BrowserContext, policy: SafetyPolicy): Promise<SafetyGuard> {
  const guard = new SafetyGuard(policy);
  await guard.install(target);
  return guard;
}

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function isReadOnlyGraphQl(body: string | null): boolean {
  if (!body) {
    return false;
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (items.length === 0) return false;
    return items.every((item) => {
      if (!item || typeof item !== 'object') return false;
      const query = (item as { query?: unknown }).query;
      if (typeof query !== 'string') return false;
      const trimmed = query.replace(/#[^\n]*/g, '').trim();
      return !/\bmutation\b/i.test(trimmed) && !/\bsubscription\b/i.test(trimmed) && (/^query\b/i.test(trimmed) || trimmed.startsWith('{'));
    });
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
