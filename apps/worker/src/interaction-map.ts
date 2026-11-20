import { BrowserManager, detectBotCheck, installSafetyGuard, isThirdPartyTrackerError, LiveStreamer, waitForSpaSettle, type SafetyGuard } from '@auditor/browser';
import type {
  ControlOutcome,
  ControlProbe,
  InteractionMap,
  OverlayReport,
  SafetyMode,
  ScreenMap,
} from '@auditor/shared';
import type { BrowserContext, Download, Locator, Page } from 'playwright';

/**
 * Interaction map: on every explored screen, find each control, click it once
 * on a freshly loaded page, and record what it does. Popups are explored (a few
 * of their own controls are tried), then closed the way a person would (their
 * close button), checked to be closed, and reopened to test Escape.
 *
 * Everything runs behind the same safety guard as the rest of the audit, never
 * places orders (even on staging), and skips logout and destructive controls.
 */

interface RawControl {
  key: string;
  occurrence: number;
  label: string;
  role: string | null;
  tag: string;
  type: string | null;
  href: string | null;
  inNav: boolean;
}

interface RawOverlay {
  signature: string;
  title: string;
  kind: OverlayReport['kind'];
  area: number;
}

export interface InteractionMapInput {
  screens: Array<{ url: string; title: string }>;
  baseUrl: string;
  storageState?: unknown;
  safety: { mode: SafetyMode; allowPrivate: boolean; blockedPathPatterns: string[] };
  allowDestructive: boolean;
  maxControlsPerScreen: number;
  maxScreens: number;
  budgetMs: number;
  excludeLabels: string[];
  concurrency?: number;
  live?: LiveStreamer;
  onProgress?: (message: string) => Promise<void>;
}

const NEVER_PROBE = /\b(log ?out|sign ?out|logoff|delete|remove|destroy|deactivate|unsubscribe|close account|place order|pay now|buy now|confirm order|complete (order|purchase)|submit order)\b/i;
const CLOSE_LABEL = /^(×|✕|✖|x|close|close dialog|close modal|dismiss|cancel|no,? thanks|not now|maybe later|got it|done|ok|back|skip|hide|minimi[sz]e|collapse)$|\bclose\b|\bdismiss\b|\bminimi[sz]e\b/i;
/** Page loads that failed for network reasons: the site or connection, not the control. */
const NETWORK_FAILURE = /net::ERR_|interrupted by another navigation|chrome-error:|Navigation failed|Target page, context or browser has been closed|ECONNRESET|socket hang up/i;
const CONSENT_REJECT = /^(reject( all| optional)?|decline( all)?|deny|necessary only|only necessary|essential only|use necessary cookies only|refuse)$/i;

const CONTROLS_SCRIPT = `(scopeSelector) => {
  const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
  if (!scope) return [];
  const selector = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="switch"], [role="checkbox"], [role="option"], summary, select, input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"]';
  const isVisible = (el) => {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0;
  };
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label') || el.getAttribute('title');
    let text = (aria || el.innerText || el.textContent || el.value || '').replace(/\\s+/g, ' ').trim();
    if (!text) {
      const img = el.querySelector('img[alt]');
      if (img) text = img.getAttribute('alt') || '';
    }
    if (!text && el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) text = (label.textContent || '').trim();
    }
    return text.slice(0, 80);
  };
  const counts = new Map();
  const out = [];
  for (const el of scope.querySelectorAll(selector)) {
    if (!isVisible(el)) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    const tag = el.tagName.toLowerCase();
    const label = nameOf(el);
    const href = tag === 'a' ? el.getAttribute('href') : null;
    const role = el.getAttribute('role');
    const type = el.getAttribute('type');
    const key = [tag, role || '', label, href || '', type || ''].join('|');
    const occurrence = counts.get(key) || 0;
    counts.set(key, occurrence + 1);
    out.push({ key, occurrence, label, role, tag, type, href, inNav: Boolean(el.closest('nav, header, footer, [role="navigation"], aside')) });
  }
  return out;
}`;

/** Marks the element matching key/occurrence (inside scope) with data-testcrew-probe and reports whether it exists. */
const MARK_SCRIPT = `([scopeSelector, key, occurrence]) => {
  document.querySelectorAll('[data-testcrew-probe]').forEach((el) => el.removeAttribute('data-testcrew-probe'));
  const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
  if (!scope) return false;
  const selector = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="switch"], [role="checkbox"], [role="option"], summary, select, input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"]';
  const isVisible = (el) => {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0;
  };
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label') || el.getAttribute('title');
    let text = (aria || el.innerText || el.textContent || el.value || '').replace(/\\s+/g, ' ').trim();
    if (!text) {
      const img = el.querySelector('img[alt]');
      if (img) text = img.getAttribute('alt') || '';
    }
    if (!text && el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) text = (label.textContent || '').trim();
    }
    return text.slice(0, 80);
  };
  let seen = 0;
  for (const el of scope.querySelectorAll(selector)) {
    if (!isVisible(el)) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    const tag = el.tagName.toLowerCase();
    const k = [tag, el.getAttribute('role') || '', nameOf(el), tag === 'a' ? el.getAttribute('href') || '' : '', el.getAttribute('type') || ''].join('|');
    if (k !== key) continue;
    if (seen === occurrence) {
      el.setAttribute('data-testcrew-probe', '1');
      return true;
    }
    seen += 1;
  }
  return false;
}`;

const OVERLAYS_SCRIPT = `() => {
  const vw = innerWidth, vh = innerHeight;
  const seen = new Set();
  const out = [];
  const consider = (el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) return;
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 60) return;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return;
    const heading = el.querySelector('h1, h2, h3, h4, [role="heading"], legend, .modal-title, [class*="title"]');
    const title = ((el.getAttribute('aria-label') || (heading && heading.textContent) || el.textContent || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    const area = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const fullWidth = r.width >= vw * 0.9;
    let kind = 'dialog';
    if (fullWidth && (r.top >= vh * 0.55 || r.bottom <= vh * 0.35) && r.height < vh * 0.5) kind = 'banner';
    else if ((r.left <= 2 || r.right >= vw - 2) && r.height >= vh * 0.7 && r.width < vw * 0.7) kind = 'drawer';
    else if (area < vw * vh * 0.12) kind = 'popover';
    // Identity is structural (tag, id, classes) so a header whose text changes
    // (cart count 0 -> 1) is not mistaken for a newly opened popup.
    const classes = (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean).slice(0, 4).join('.');
    const role = el.getAttribute('role') || '';
    const signature = [el.tagName, el.id || '', classes, role].join('|') + (el.id || classes ? '' : '|' + title.slice(0, 30));
    out.push({ signature, title, kind, area, el });
  };
  for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"], [data-state="open"][role], .modal.show, .modal.in, [class*="modal"][class*="open"], [class*="drawer"][class*="open"], [class*="popover"], [class*="dropdown-menu"].show')) consider(el);
  for (const el of document.body.querySelectorAll('body > div, body > aside, body > section, [style*="position: fixed"], [style*="position:fixed"]')) {
    const style = getComputedStyle(el);
    if ((style.position === 'fixed' || style.position === 'absolute') && Number(style.zIndex) >= 10) consider(el);
  }
  document.querySelectorAll('[data-testcrew-overlay]').forEach((el) => el.removeAttribute('data-testcrew-overlay'));
  return out.map((item, index) => {
    item.el.setAttribute('data-testcrew-overlay', String(index));
    return { signature: item.signature, title: item.title, kind: item.kind, area: item.area };
  });
}`;

const STATE_SCRIPT = `() => {
  const main = document.querySelector('main, [role="main"]') || document.body;
  const text = ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 8000);
  const expanded = Array.from(document.querySelectorAll('[aria-expanded="true"]')).length;
  const controls = document.querySelectorAll('a[href], button, [role="button"], input, select, textarea').length;
  // Where keyboard focus is, but only for text entry (a clicked button focusing itself is not an effect).
  const active = document.activeElement;
  let focused = null;
  if (active && active !== document.body) {
    const tag = active.tagName.toLowerCase();
    if (active.hasAttribute('data-testcrew-probe')) focused = 'probe:';
    else if (tag === 'textarea' || active.isContentEditable || (tag === 'input' && !['button', 'submit', 'checkbox', 'radio', 'hidden'].includes(active.type))) {
      const name = active.getAttribute('aria-label') || active.getAttribute('placeholder') || active.getAttribute('name') || tag;
      focused = 'the "' + String(name).slice(0, 40) + '" field';
    }
  }
  // How the page looks: theme classes and attributes on <html>/<body>, and the page colours.
  // A theme switch changes these without changing any text.
  const root = document.documentElement;
  const body = document.body;
  const attrs = (el) => el ? [el.className && typeof el.className === 'string' ? el.className : '', el.getAttribute('data-theme') || '', el.getAttribute('data-mode') || '', el.getAttribute('data-color-scheme') || '', el.style.colorScheme || ''].join('|') : '';
  const look = [attrs(root), attrs(body), body ? getComputedStyle(body).backgroundColor : '', body ? getComputedStyle(body).color : ''].join('#');
  // Toggle state of the control being probed (switches, pressed buttons, tabs).
  const probe = document.querySelector('[data-testcrew-probe="1"]');
  const toggled = probe ? [probe.getAttribute('aria-pressed'), probe.getAttribute('aria-checked'), probe.getAttribute('aria-selected'), probe.getAttribute('data-state')].join('|') : '';
  return { url: location.href, text, mainLength: ((main && main.innerText) || '').length, expanded, controls, scrollY: Math.round(scrollY), focused, look, toggled };
}`;

interface PageState {
  url: string;
  text: string;
  mainLength: number;
  expanded: number;
  controls: number;
  scrollY: number;
  focused: string | null;
  look?: string;
  toggled?: string;
}

interface WorkItem {
  screen: ScreenMap;
  control: RawControl;
}

export async function buildInteractionMap(input: InteractionMapInput): Promise<InteractionMap> {
  const started = Date.now();
  const deadline = started + input.budgetMs;
  const manager = new BrowserManager();
  const exclude = input.excludeLabels.map((item) => item.toLowerCase());
  const screens: ScreenMap[] = [];
  const perScreen: WorkItem[][] = [];
  const probedKeys = new Set<string>();
  let truncated = false;

  try {
    // 1. Scan each screen for its controls.
    const scanner = await openWorker(manager, input);
    const webScreens = input.screens.filter((screen) => /^https?:\/\//i.test(screen.url));
    for (const screen of webScreens.slice(0, input.maxScreens)) {
      if (Date.now() > deadline) {
        truncated = true;
        break;
      }
      const map: ScreenMap = { url: screen.url, title: screen.title, controlsFound: 0, controls: [] };
      screens.push(map);
      const queue: WorkItem[] = [];
      perScreen.push(queue);
      try {
        await openFresh(scanner.page, screen.url);
        const controls = (await scanner.page.evaluate(`(${CONTROLS_SCRIPT})(null)`)) as RawControl[];
        map.controlsFound = controls.length;
        // In-page controls first; site-wide navigation once for the whole site.
        const ordered = [...controls.filter((item) => !item.inNav), ...controls.filter((item) => item.inNav)];
        let taken = 0;
        for (const control of ordered) {
          if (taken >= input.maxControlsPerScreen) {
            truncated = true;
            break;
          }
          // Site-wide navigation, and any link to the same place, behaves the same on
          // every page: probe it once. Footers built from plain divs count too.
          const destination = control.href && !control.href.startsWith('#') ? absoluteUrl(control.href, screen.url) : null;
          const globalKey = destination
            ? `link|${control.label.toLowerCase()}|${destination}`
            : control.inNav
              ? `nav|${control.key}`
              : `${pathOf(screen.url)}|${control.key}|${control.occurrence}`;
          if (probedKeys.has(globalKey)) continue;
          probedKeys.add(globalKey);
          if (!control.label && !control.href) continue;
          const lower = control.label.toLowerCase();
          if (NEVER_PROBE.test(control.label) && !(input.allowDestructive && !/log ?out|sign ?out|place order|pay now|buy now|order/i.test(control.label))) {
            map.controls.push(skipped(control, 'Skipped: could sign out, delete data or place an order'));
            continue;
          }
          if (exclude.some((item) => lower.includes(item))) {
            map.controls.push(skipped(control, 'Skipped by the test plan'));
            continue;
          }
          if (control.href && isExternal(control.href, screen.url)) {
            map.controls.push({ ...skipped(control, `Links to another site: ${control.href.slice(0, 120)}`), outcome: 'navigates', destination: control.href });
            continue;
          }
          if (control.href && /^(mailto|tel|sms|javascript:void)/i.test(control.href)) {
            map.controls.push(skipped(control, `Opens ${control.href.split(':')[0]}`));
            continue;
          }
          queue.push({ screen: map, control });
          taken += 1;
        }
      } catch (error) {
        // A screen that will not load here is a gap in coverage, not a broken control.
        map.controls.push({
          label: '(screen)',
          role: null,
          kind: 'screen',
          selector: '',
          outcome: 'skipped',
          detail: `Not tested: the screen did not load (${message(error).split('\n')[0]?.slice(0, 160)})`,
          durationMs: 0,
        });
      }
    }
    await scanner.context.close().catch(() => undefined);
    // Take one control from each screen in turn, so a time budget that runs out
    // still leaves every screen partly covered instead of the first few fully.
    const queue: WorkItem[] = [];
    for (let round = 0; perScreen.some((list) => round < list.length); round += 1) {
      for (const list of perScreen) {
        const item = list[round];
        if (item) queue.push(item);
      }
    }
    await input.onProgress?.(`Interaction map: probing ${queue.length} controls on ${screens.length} screens`);

    // 2. Probe controls in parallel, each on a fresh page.
    const workers = await Promise.all(
      Array.from({ length: Math.max(1, Math.min(input.concurrency ?? 3, 4)) }, () => openWorker(manager, input)),
    );
    if (input.live && workers[0]) {
      await input.live.attach(workers[0].page).catch(() => undefined);
    }
    let index = 0;
    let done = 0;
    await Promise.all(
      workers.map(async (worker, workerIndex) => {
        while (index < queue.length) {
          if (Date.now() > deadline) {
            truncated = true;
            return;
          }
          const item = queue[index];
          index += 1;
          if (!item) continue;
          const result = await probeControl(worker, item, input, workerIndex === 0 ? input.live : undefined);
          item.screen.controls.push(result);
          done += 1;
          if (done % 15 === 0) {
            await input.onProgress?.(`Interaction map: ${done} of ${queue.length} controls probed`);
          }
        }
      }),
    );
    if (index < queue.length) truncated = true;
    await Promise.all(workers.map((worker) => worker.context.close().catch(() => undefined)));
  } finally {
    await manager.close().catch(() => undefined);
  }

  const totals = Object.fromEntries(
    (['navigates', 'opens_overlay', 'changes_content', 'expands', 'opens_window', 'downloads', 'submits', 'blocked_by_safety', 'no_effect', 'error', 'skipped'] as ControlOutcome[]).map(
      (outcome) => [outcome, 0],
    ),
  ) as Record<ControlOutcome, number>;
  let probed = 0;
  for (const screen of screens) {
    for (const control of screen.controls) {
      totals[control.outcome] += 1;
      if (control.outcome !== 'skipped') probed += 1;
    }
  }
  return { screens, totals, probed, durationMs: Date.now() - started, truncated };
}

interface Worker {
  context: BrowserContext;
  page: Page;
  guard: SafetyGuard;
  pageErrors: string[];
  popups: Page[];
  downloads: Download[];
  mutating: Array<{ method: string; url: string; status: number | null }>;
  documentStatus: number | null;
  /** Main-frame document loads since the action, including a reload of the same URL. */
  documentLoads: number;
}

async function openWorker(manager: BrowserManager, input: InteractionMapInput): Promise<Worker> {
  const context = await manager.createContext({
    acceptDownloads: true,
    ...(input.storageState ? { storageState: input.storageState as never } : {}),
  });
  const guard = await installSafetyGuard(context, {
    mode: input.safety.mode,
    allowPrivate: input.safety.allowPrivate,
    targetOrigin: new URL(input.baseUrl).origin,
    blockedPathPatterns: input.safety.blockedPathPatterns,
    // Probing never places orders or pays, even where journeys may.
    allowTransactions: false,
    allowSandboxPayments: false,
  });
  const page = await context.newPage();
  const worker: Worker = { context, page, guard, pageErrors: [], popups: [], downloads: [], mutating: [], documentStatus: null, documentLoads: 0 };
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) worker.documentLoads += 1;
  });
  page.on('pageerror', (error) => {
    if (!isThirdPartyTrackerError(error.message)) worker.pageErrors.push(error.message.slice(0, 300));
  });
  page.on('download', (download) => worker.downloads.push(download));
  context.on('page', (popup) => {
    if (popup !== page) worker.popups.push(popup);
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      worker.documentStatus = response.status();
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      worker.mutating.push({ method: request.method(), url: request.url(), status: response.status() });
    }
  });
  return worker;
}

async function openFresh(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await waitForSpaSettle(page, 6_000).catch(() => undefined);
  const bot = await detectBotCheck(page);
  if (bot) throw new Error(`Bot check: ${bot}`);
  await rejectCookieBanner(page);
}

/** Choose the privacy-preserving option on a cookie banner so it does not cover the page. */
async function rejectCookieBanner(page: Page): Promise<void> {
  try {
    const buttons = page.getByRole('button');
    const count = Math.min(await buttons.count(), 80);
    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      const text = ((await button.innerText({ timeout: 300 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      if (CONSENT_REJECT.test(text) && (await button.isVisible().catch(() => false))) {
        await button.click({ timeout: 2_000 }).catch(() => undefined);
        await page.waitForTimeout(300);
        return;
      }
    }
  } catch {
    /* no banner */
  }
}

async function markControl(page: Page, scope: string | null, control: RawControl): Promise<Locator | null> {
  const found = (await page.evaluate(`(${MARK_SCRIPT})(${JSON.stringify([scope, control.key, control.occurrence])})`)) as boolean;
  return found ? page.locator('[data-testcrew-probe="1"]').first() : null;
}

async function overlays(page: Page): Promise<RawOverlay[]> {
  return ((await page.evaluate(`(${OVERLAYS_SCRIPT})()`).catch(() => [])) as RawOverlay[]) ?? [];
}

async function state(page: Page): Promise<PageState> {
  return (await page.evaluate(`(${STATE_SCRIPT})()`).catch(() => ({ url: page.url(), text: '', mainLength: 0, expanded: 0, controls: 0, scrollY: 0, focused: null }))) as PageState;
}

async function act(page: Page, target: Locator, control: RawControl): Promise<void> {
  if (control.tag === 'select') {
    const options = await target.locator('option').count();
    await target.selectOption({ index: options > 1 ? 1 : 0 }, { timeout: 4_000 });
    return;
  }
  if (control.tag === 'input' && (control.type === 'checkbox' || control.type === 'radio')) {
    await target.check({ timeout: 4_000, force: false });
    return;
  }
  await target.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
  await target.click({ timeout: 4_000 });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 4_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle', { timeout: 1_500 }).catch(() => undefined);
}

async function probeControl(worker: Worker, item: WorkItem, input: InteractionMapInput, live?: LiveStreamer): Promise<ControlProbe> {
  const { page } = worker;
  const control = item.control;
  const started = Date.now();
  const base: Omit<ControlProbe, 'outcome' | 'detail' | 'durationMs'> = {
    label: control.label || control.href || control.tag,
    role: control.role,
    kind: control.tag === 'a' ? 'link' : control.tag === 'select' ? 'select' : control.type ?? control.role ?? control.tag,
    selector: control.key,
  };
  try {
    try {
      await openFresh(page, item.screen.url);
    } catch (error) {
      if (!NETWORK_FAILURE.test(message(error)) && !/Timeout/i.test(message(error))) throw error;
      // Sites throttle bursts of page loads; wait and try once more before giving up.
      await page.waitForTimeout(3_000);
      try {
        await openFresh(page, item.screen.url);
      } catch (retryError) {
        return {
          ...base,
          outcome: 'skipped',
          detail: `Not tested: the screen did not load (${message(retryError).split('\n')[0]?.slice(0, 120)})`,
          durationMs: Date.now() - started,
        };
      }
    }
    const target = await markControl(page, null, control);
    if (!target || !(await target.isVisible().catch(() => false))) {
      return { ...base, outcome: 'skipped', detail: 'Not visible after reloading the screen', durationMs: Date.now() - started };
    }
    const before = await state(page);
    const overlaysBefore = await overlays(page);
    worker.pageErrors.length = 0;
    worker.popups.length = 0;
    worker.downloads.length = 0;
    worker.mutating.length = 0;
    worker.documentStatus = null;
    worker.documentLoads = 0;
    const blockedBefore = worker.guard.blocked.length;
    const expandedBefore = await target.getAttribute('aria-expanded').catch(() => null);

    if (live) {
      const box = await LiveStreamer.boxOf(target);
      await live.setAction({ kind: 'click', label: `Trying "${base.label}" on ${pathOf(item.screen.url)}`, box, phase: 'probing' });
    }
    await act(page, target, control);
    await settle(page);
    const pointsElsewhere = Boolean(control.tag === 'a' && control.href && !control.href.startsWith('#') && absoluteUrl(control.href, before.url) !== absoluteUrl(before.url, before.url));
    if (pointsElsewhere && page.url() === before.url) {
      // Slow sites (and client-side routers) may still be on their way to the next page.
      await page.waitForURL((url) => url.href !== before.url, { timeout: 5_000 }).catch(() => undefined);
    }
    if (worker.documentLoads > 0) {
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
    }

    const after = await state(page);
    if (after.url.startsWith('chrome-error:')) {
      return {
        ...base,
        outcome: 'skipped',
        detail: 'Not tested: the next page failed to load (network error)',
        durationMs: Date.now() - started,
      };
    }
    const done = (outcome: ControlOutcome, detail: string, extra: Partial<ControlProbe> = {}): ControlProbe => ({
      ...base,
      outcome,
      detail,
      ...extra,
      durationMs: Date.now() - started,
    });

    if (worker.pageErrors.length > 0) {
      return done('error', `Uncaught error: ${worker.pageErrors[0]}`, { error: worker.pageErrors[0] });
    }
    const serverError = worker.mutating.find((request) => (request.status ?? 0) >= 500);
    if (serverError) {
      return done('error', `${serverError.method} ${pathOf(serverError.url)} answered ${serverError.status}`, { error: `HTTP ${serverError.status}` });
    }
    if (worker.popups.length > 0) {
      const popup = worker.popups[0];
      const url = popup?.url() ?? '';
      await Promise.all(worker.popups.map((item) => item.close().catch(() => undefined)));
      return done('opens_window', `Opens a new window: ${url.slice(0, 160)}`, { destination: url });
    }
    if (worker.downloads.length > 0) {
      const name = worker.downloads[0]?.suggestedFilename() ?? 'file';
      await Promise.all(worker.downloads.map((item) => item.cancel().catch(() => undefined)));
      return done('downloads', `Starts a download: ${name}`);
    }
    const newBlocked = worker.guard.blocked.slice(blockedBefore).find((request) => sameHost(request.url, input.baseUrl));
    if (newBlocked) {
      return done('blocked_by_safety', `Would send ${newBlocked.method} ${pathOf(newBlocked.url)}; ${newBlocked.reason}`, {
        blockedRequest: `${newBlocked.method} ${newBlocked.url.slice(0, 200)}`,
      });
    }
    if (navigated(before.url, after.url)) {
      const status = worker.documentStatus ?? 200;
      return done(
        status >= 400 ? 'error' : 'navigates',
        `Goes to ${pathOf(after.url)}${status >= 400 ? ` which answers HTTP ${status}` : ''}`,
        { destination: after.url, status, ...(status >= 400 ? { error: `HTTP ${status}` } : {}) },
      );
    }
    const overlaysAfter = await overlays(page);
    const known = new Set(overlaysBefore.map((overlay) => overlay.signature));
    const opened = overlaysAfter.filter((overlay) => !known.has(overlay.signature) && overlay.kind !== 'banner').sort((a, b) => b.area - a.area)[0];
    if (opened) {
      const report = await exploreOverlay(worker, item, control, opened, live);
      const closing = report.closed
        ? `closed with ${{ close_button: 'its close button', control: 'one of its own buttons', escape: 'Escape', backdrop: 'a click outside', none: 'nothing' }[report.closedBy]}`
        : 'could not be closed';
      return done('opens_overlay', `Opens ${report.kind} "${report.title || 'untitled'}" (${closing}${report.escapeCloses === false ? '; Escape does not close it' : ''})`, {
        overlay: report,
      });
    }
    // After a reload or re-render the marked element is gone; never wait for it
    // (Playwright would wait its full default timeout for each check).
    const marked = page.locator('[data-testcrew-probe="1"]').first();
    const stillMarked = (await marked.count().catch(() => 0)) > 0;
    const expandedAfter = stillMarked ? await marked.getAttribute('aria-expanded', { timeout: 1_000 }).catch(() => null) : null;
    if ((expandedBefore === 'false' && expandedAfter === 'true') || after.expanded > before.expanded || after.controls > before.controls + 2) {
      return done('expands', `Reveals ${Math.max(0, after.controls - before.controls)} more controls`);
    }
    const change = describeChange(before.text, after.text);
    if (change) {
      return done('changes_content', change, { change });
    }
    if (before.look && after.look && before.look !== after.look) {
      // Theme switches (dark/light mode), contrast or font-size toggles restyle the page without new text.
      const themed = /dark|light|theme/i.test(`${control.label} ${after.look}`);
      const detail = themed ? "Switches the page's colour theme" : "Changes the page's appearance";
      return done('changes_content', detail, { change: detail });
    }
    if (before.toggled !== undefined && after.toggled !== undefined && before.toggled !== after.toggled && (hasToggle(before.toggled) || hasToggle(after.toggled))) {
      const detail = 'Switches its own on/off state';
      return done('changes_content', detail, { change: detail });
    }
    if (Math.abs(after.scrollY - before.scrollY) > 40) {
      // Table-of-contents links and "back to top" buttons scroll the page.
      const detail = after.scrollY > before.scrollY ? 'Scrolls down the page to a section' : 'Scrolls up the page';
      return done('changes_content', detail, { change: detail });
    }
    if (after.focused && after.focused !== before.focused && !after.focused.startsWith('probe:')) {
      const detail = `Moves focus to ${after.focused}`;
      return done('changes_content', detail, { change: detail });
    }
    // A submit button whose form is invalid (required fields empty) is stopped by
    // the browser's own validation; that is correct behaviour, not a dead button.
    const invalidForm =
      stillMarked &&
      (await marked
        .evaluate(
          (el) => {
            const form = (el as { form?: { checkValidity(): boolean } | null }).form;
            return Boolean(form && !form.checkValidity());
          },
          undefined,
          { timeout: 1_000 },
        )
        .catch(() => false));
    if (invalidForm) {
      return done('submits', "Stopped by the form's own validation (required fields are empty)");
    }
    if (worker.documentLoads > 0) {
      // A link to the current page, or a GET form that resubmits the same values.
      const status = worker.documentStatus ?? 200;
      return done(status >= 400 ? 'error' : 'navigates', status >= 400 ? `Reloads this page, which answers HTTP ${status}` : 'Reloads this page', {
        destination: after.url,
        status,
        ...(status >= 400 ? { error: `HTTP ${status}` } : {}),
      });
    }
    const value = stillMarked
      ? await marked
          .evaluate(
            (el) => {
              const field = el as { tagName: string; type?: string; checked?: boolean; selectedOptions?: ArrayLike<{ textContent: string | null }> };
              if (field.tagName === 'SELECT') return `Chooses "${(field.selectedOptions?.[0]?.textContent ?? '').trim()}"`;
              if (field.type === 'checkbox' || field.type === 'radio') return field.checked ? 'Turns it on' : 'Turns it off';
              return null;
            },
            undefined,
            { timeout: 1_000 },
          )
          .catch(() => null)
      : null;
    if (value) {
      // A dropdown or checkbox that takes the value works, even if nothing else on the page reacts.
      return done('changes_content', value, { change: value });
    }
    const write = worker.mutating.find((request) => sameHost(request.url, input.baseUrl));
    if (write) {
      return done('submits', `Sends ${write.method} ${pathOf(write.url)} (HTTP ${write.status ?? '?'}) with no visible change`);
    }
    if (/(^|\|)(true|on|active|checked)(\||$)/.test(before.toggled ?? '')) {
      // A segmented choice (theme, view, tab) that is already the current one: pressing it
      // again is supposed to do nothing.
      return done('skipped', 'Already the selected option, so pressing it again changes nothing');
    }
    return done('no_effect', 'Nothing visible happened (no navigation, popup or content change)');
  } catch (error) {
    const text = message(error);
    if (/intercepts pointer events/i.test(text)) {
      return { ...base, outcome: 'skipped', detail: 'Not tested: another element covers it, so it cannot be clicked', durationMs: Date.now() - started };
    }
    if (/not visible|outside of the viewport|Timeout/i.test(text)) {
      return { ...base, outcome: 'skipped', detail: `Could not click it: ${text.split('\n')[0]?.slice(0, 160)}`, durationMs: Date.now() - started };
    }
    if (text.startsWith('Bot check:')) {
      return { ...base, outcome: 'skipped', detail: `Not tested: ${text.slice('Bot check: '.length, 200)} (never bypassed)`, durationMs: Date.now() - started };
    }
    if (NETWORK_FAILURE.test(text)) {
      // The page or connection failed, not the control: never reported as an app bug.
      return { ...base, outcome: 'skipped', detail: `Not tested: the page failed to load (${text.split('\n')[0]?.slice(0, 120)})`, durationMs: Date.now() - started };
    }
    return { ...base, outcome: 'error', detail: text.slice(0, 300), error: text.slice(0, 300), durationMs: Date.now() - started };
  }
}

/**
 * Inside an opened popup: try a few of its controls, then close it with its own
 * close button and confirm it is gone; finally reopen it and check Escape.
 */
async function exploreOverlay(
  worker: Worker,
  item: WorkItem,
  trigger: RawControl,
  overlay: RawOverlay,
  live?: LiveStreamer,
): Promise<OverlayReport> {
  const { page } = worker;
  const report: OverlayReport = {
    title: overlay.title,
    kind: overlay.kind === 'banner' ? 'popover' : overlay.kind,
    controls: 0,
    probed: [],
    closedBy: 'none',
    closed: false,
    escapeCloses: null,
  };
  const scope = await scopeFor(page, overlay.signature);
  if (!scope) return report;
  const controls = ((await page.evaluate(`(${CONTROLS_SCRIPT})(${JSON.stringify(scope)})`)) as RawControl[]) ?? [];
  report.controls = controls.length;
  const closeControl = controls.find((control) => CLOSE_LABEL.test(control.label.trim()));

  const reopen = async (): Promise<string | null> => {
    await openFresh(page, item.screen.url);
    const again = await markControl(page, null, trigger);
    if (!again) return null;
    await act(page, again, trigger);
    await settle(page);
    const current = await overlays(page);
    const match = current.find((candidate) => candidate.signature === overlay.signature) ?? current.find((candidate) => candidate.title === overlay.title);
    return match ? scopeFor(page, match.signature) : null;
  };

  // Try a few controls inside the popup (selects, tabs, options, buttons that are not close/submit-to-order).
  let currentScope: string | null = scope;
  for (const control of controls.filter((candidate) => candidate !== closeControl && !NEVER_PROBE.test(candidate.label)).slice(0, 6)) {
    if (!currentScope) break;
    try {
      const target = await markControl(page, currentScope, control);
      if (!target) continue;
      if (live) {
        await live.setAction({ kind: 'click', label: `In "${overlay.title || 'popup'}": "${control.label}"`, box: await LiveStreamer.boxOf(target), phase: 'probing' });
      }
      const urlBefore = page.url();
      const textBefore = (await state(page)).text;
      await act(page, target, control);
      await settle(page);
      const stillOpen = (await overlays(page)).some((candidate) => candidate.signature === overlay.signature);
      if (navigated(urlBefore, page.url())) {
        report.probed.push({ label: control.label, outcome: 'navigates', detail: `Goes to ${pathOf(page.url())}` });
        currentScope = await reopen();
      } else if (!stillOpen) {
        report.probed.push({ label: control.label, outcome: 'changes_content', detail: 'Closes the popup' });
        currentScope = await reopen();
      } else {
        const change = describeChange(textBefore, (await state(page)).text);
        report.probed.push({
          label: control.label,
          outcome: change ? 'changes_content' : control.tag === 'select' ? 'changes_content' : 'no_effect',
          detail: change ?? (control.tag === 'select' ? 'Selects an option' : 'Nothing visible happened'),
        });
      }
    } catch (error) {
      report.probed.push({ label: control.label, outcome: 'skipped', detail: message(error).split('\n')[0]?.slice(0, 120) ?? 'failed' });
    }
  }
  const closedByOwnControl = report.probed.some((probe) => probe.detail === 'Closes the popup');
  if (!currentScope) {
    currentScope = await reopen();
    if (!currentScope) {
      // It would not reopen (some widgets remember being dismissed), but one of
      // its own controls was already seen closing it.
      if (closedByOwnControl) {
        report.closed = true;
        report.closedBy = 'control';
      }
      return report;
    }
  }

  // Close it the way a person would: its close button, else Escape, else a click outside.
  const isOpen = async () => (await overlays(page)).some((candidate) => candidate.signature === overlay.signature);
  if (closeControl) {
    const button = await markControl(page, currentScope, closeControl);
    if (button) {
      if (live) await live.setAction({ kind: 'click', label: `Closing "${overlay.title || 'popup'}"`, box: await LiveStreamer.boxOf(button), phase: 'probing' });
      await button.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      if (!(await isOpen())) {
        report.closed = true;
        report.closedBy = 'close_button';
      }
    }
  }
  if (!report.closed) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    if (!(await isOpen())) {
      report.closed = true;
      report.closedBy = 'escape';
      report.escapeCloses = true;
    }
  }
  if (!report.closed && report.probed.some((probe) => probe.detail === 'Closes the popup')) {
    // An icon-only close button (or "Minimize") was already seen closing it.
    report.closed = true;
    report.closedBy = 'control';
  }
  if (!report.closed) {
    await page.mouse.click(4, 4).catch(() => undefined);
    await page.waitForTimeout(500);
    if (!(await isOpen())) {
      report.closed = true;
      report.closedBy = 'backdrop';
    }
  }

  // Dialogs and drawers should also close with Escape (keyboard users).
  if (report.escapeCloses === null && report.closedBy !== 'none' && (report.kind === 'dialog' || report.kind === 'drawer')) {
    const reopened = await reopen();
    if (reopened) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      report.escapeCloses = !(await isOpen());
    }
  }
  return report;
}

async function scopeFor(page: Page, signature: string): Promise<string | null> {
  const list = await overlays(page);
  const index = list.findIndex((candidate) => candidate.signature === signature);
  return index >= 0 ? `[data-testcrew-overlay="${index}"]` : null;
}

function skipped(control: RawControl, detail: string): ControlProbe {
  return {
    label: control.label || control.href || control.tag,
    role: control.role,
    kind: control.tag === 'a' ? 'link' : control.type ?? control.role ?? control.tag,
    selector: control.key,
    outcome: 'skipped',
    detail,
    durationMs: 0,
  };
}

/** A short human description of what text changed, or null when nothing meaningful did. */
export function describeChange(before: string, after: string): string | null {
  if (before === after) return null;
  const tokens = (text: string) => text.split(/\s+/).filter(Boolean);
  const a = tokens(before);
  const b = tokens(after);
  const count = (list: string[]) => {
    const map = new Map<string, number>();
    for (const token of list) map.set(token, (map.get(token) ?? 0) + 1);
    return map;
  };
  const ca = count(a);
  const cb = count(b);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [token, n] of cb) if ((ca.get(token) ?? 0) < n) added.push(token);
  for (const [token, n] of ca) if ((cb.get(token) ?? 0) < n) removed.push(token);
  // Ignore clocks and counters that tick on their own.
  const meaningful = (list: string[]) => list.filter((token) => !/^\d{1,2}:\d{2}(:\d{2})?$/.test(token));
  const plus = meaningful(added);
  const minus = meaningful(removed);
  if (plus.length === 0 && minus.length === 0) return null;
  if (plus.length + minus.length <= 2 && plus.length === minus.length && plus.every((token) => /\d/.test(token))) {
    return `Changes ${minus.join(' ')} → ${plus.join(' ')}`;
  }
  const show = (list: string[]) => list.slice(0, 8).join(' ').slice(0, 90);
  if (plus.length && minus.length) return `Content changes (+${plus.length} / −${minus.length} words): "${show(plus)}"`;
  if (plus.length) return `Shows new content: "${show(plus)}"`;
  return `Hides content: "${show(minus)}"`;
}

function navigated(before: string, after: string): boolean {
  try {
    const a = new URL(before);
    const b = new URL(after);
    return a.origin !== b.origin || a.pathname !== b.pathname || a.search !== b.search || (a.hash !== b.hash && b.hash.length > 1 && !b.hash.startsWith('#!'));
  } catch {
    return before !== after;
  }
}

function absoluteUrl(href: string, base: string): string {
  try {
    const url = new URL(href, base);
    url.hash = '';
    return url.href;
  } catch {
    return href;
  }
}

function isExternal(href: string, base: string): boolean {
  try {
    return new URL(href, base).host !== new URL(base).host;
  } catch {
    return false;
  }
}

function sameHost(url: string, base: string): boolean {
  try {
    return new URL(url).host === new URL(base).host;
  } catch {
    return false;
  }
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`.slice(0, 120) || '/';
  } catch {
    return url;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A toggle state is only meaningful when the control exposes one (aria-pressed, aria-checked…). */
function hasToggle(state: string | undefined): boolean {
  return Boolean(state && state.replace(/\|/g, '').replace(/null/g, '') !== '');
}
