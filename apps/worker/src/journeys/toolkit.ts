/// <reference lib="dom" />
import { detectBotCheck, LiveStreamer, waitForSpaSettle, type SafetyGuard } from '@auditor/browser';
import {
  classifyField,
  LIVE_PAYMENT_KEY_PATTERN,
  valueFor,
  type ControlRole,
  type CheckExplanation,
  type JourneyStepResult,
  type TestPlan,
} from '@auditor/shared';
import type { Frame, Locator, Page } from 'playwright';
import type { RunPermissions } from '../safety-mode.js';

/**
 * Shared toolkit for business journeys. Controls are found on the live page
 * (never invented): every visible interactive element is scored against the
 * role's patterns and the project's own label hints, and the best match is
 * marked and clicked. Steps record checks, screenshots and the reason when a
 * step is blocked by safety rules or the site does not have that control.
 */

export class BlockedError extends Error {}
export class NotFoundError extends Error {}

export interface StoredShot {
  key: string;
  bytes: number;
}

export interface JourneyContextInit {
  page: Page;
  guard: SafetyGuard;
  plan: TestPlan;
  permissions: RunPermissions;
  baseUrl: string;
  token: string;
  live?: LiveStreamer;
  saveShot: (name: string, body: Buffer) => Promise<StoredShot>;
  journeyName: string;
}

const ROLE_PATTERNS: Record<ControlRole, { text: RegExp; attr?: RegExp; href?: RegExp; avoid?: RegExp; tags?: string[] }> = {
  search: { text: /\bsearch\b/i, attr: /search|\bq\b|query|keyword/i, tags: ['input'] },
  product_link: { text: /.^/, href: /\/(products?|p|item|items|dp|listing|catalog\/[^/]+)\/[^/?#]+/i, tags: ['a'] },
  add_to_cart: {
    text: /\badd (to )?(cart|bag|basket|trolley)\b|^add$|^\+ ?add\b/i,
    attr: /add[-_ ]?to[-_ ]?(cart|bag|basket)|addtocart/i,
    avoid: /wish ?list|favou?rite|compare|buy now/i,
  },
  cart: { text: /^(cart|bag|basket|view cart|my cart|shopping cart|go to cart)\b/i, attr: /cart|basket|bag/i, href: /\/(cart|basket|bag)(\/|$|\?)/i, avoid: /add to/i },
  quantity: { text: /\b(qty|quantity)\b/i, attr: /qty|quantity/i, tags: ['input', 'select'] },
  remove_from_cart: { text: /\b(remove|delete)\b|^×$|^✕$/i, attr: /remove|delete/i, avoid: /coupon|promo/i },
  checkout: { text: /\b(check ?out|proceed to (checkout|buy|payment)|continue to checkout)\b/i, attr: /checkout/i, href: /\/checkout/i },
  continue: { text: /^(continue|next|proceed|save and continue|continue to (shipping|delivery|payment|review)|use this address|deliver here)\b/i },
  place_order: {
    text: /\b(place (your )?order|pay( now)?|complete (order|purchase|booking)|confirm (order|payment|booking)|submit order|buy now|book now)\b/i,
    attr: /place[-_ ]?order|submit[-_ ]?order|pay/i,
  },
  login: { text: /^(log ?in|sign ?in)$/i, href: /\/(login|signin|sign-in)\b/i },
  signup: { text: /\b(sign ?up|register|create (an )?account)\b/i, href: /\/(signup|register|join)\b/i },
  create: { text: /^(\+ ?)?(new|create|add)\b/i, avoid: /add to (cart|bag|basket)/i },
  save: { text: /^(save|update|save changes|submit|apply)\b/i },
  delete: { text: /^(delete|remove)\b/i },
  book: { text: /\b(book( now)?|reserve|schedule|check availability|find (a )?(slot|time|table|room))\b/i },
  select_date: { text: /\b(date|check-?in|arrival|when)\b/i, attr: /date|checkin|arrival/i, tags: ['input', 'button'] },
  select_slot: { text: /^\d{1,2}(:\d{2})?\s?(am|pm)?$|\bavailable\b|\bselect\b/i },
  subscribe: { text: /\b(subscribe|sign me up|join (the )?newsletter|notify me)\b/i },
};

const CANDIDATES_SCRIPT = `(scope) => {
  const root = scope ? document.querySelector(scope) : document;
  if (!root) return [];
  document.querySelectorAll('[data-snaghunt-target]').forEach((el) => el.removeAttribute('data-snaghunt-target'));
  const out = [];
  let index = 0;
  for (const el of root.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="searchbox"], [role="combobox"], summary, label')) {
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05 && r.width > 2 && r.height > 2;
    if (!visible) continue;
    if (el.disabled) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && ['hidden'].includes((el.type || '').toLowerCase())) continue;
    let text = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
    if (!text && el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) text = (label.textContent || '').replace(/\\s+/g, ' ').trim();
    }
    if (!text) {
      const img = el.querySelector('img[alt]');
      if (img) text = img.getAttribute('alt') || '';
    }
    const attrs = [el.id, el.getAttribute('name'), typeof el.className === 'string' ? el.className : '', el.getAttribute('data-testid'), el.getAttribute('data-action'), el.getAttribute('autocomplete'), el.getAttribute('type'), el.getAttribute('placeholder')].filter(Boolean).join(' ');
    el.setAttribute('data-snaghunt-target', String(index));
    out.push({ index, tag, type: (el.getAttribute('type') || '').toLowerCase(), text: text.slice(0, 120), attrs: attrs.slice(0, 300), href: tag === 'a' ? el.getAttribute('href') : null, y: r.top + scrollY });
    index += 1;
  }
  return out;
}`;

interface Candidate {
  index: number;
  tag: string;
  type: string;
  text: string;
  attrs: string;
  href: string | null;
  y: number;
}

export interface Found {
  locator: Locator;
  label: string;
  href: string | null;
  tag: string;
}

export class JourneyContext {
  readonly steps: JourneyStepResult[] = [];
  readonly page: Page;
  readonly plan: TestPlan;
  readonly permissions: RunPermissions;
  readonly baseUrl: string;
  readonly token: string;
  private current: JourneyStepResult | null = null;

  constructor(private readonly init: JourneyContextInit) {
    this.page = init.page;
    this.plan = init.plan;
    this.permissions = init.permissions;
    this.baseUrl = init.baseUrl;
    this.token = init.token;
  }

  /** Runs one step; its outcome (and screenshot) is recorded whatever happens. */
  async step(goal: string, fn: () => Promise<string | void>): Promise<boolean> {
    const record: JourneyStepResult = { index: this.steps.length + 1, goal, status: 'passed', detail: '', checks: [] };
    this.steps.push(record);
    this.current = record;
    await this.init.live?.setAction({ kind: 'info', label: `${this.init.journeyName}: ${goal}`, phase: 'journeys' }).catch(() => undefined);
    try {
      const detail = await fn();
      record.detail = detail ?? record.detail;
      if (record.checks?.some((check) => !check.passed)) {
        record.status = 'failed';
      }
    } catch (error) {
      if (error instanceof BlockedError) {
        record.status = 'blocked';
        record.detail = error.message;
      } else if (error instanceof NotFoundError) {
        record.status = 'skipped';
        record.detail = error.message;
      } else {
        record.status = 'failed';
        record.detail = (error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 300) ?? 'failed';
      }
    } finally {
      record.url = this.page.url();
      try {
        const shot = await this.page.screenshot({ type: 'png', timeout: 5_000 });
        const stored = await this.init.saveShot(`step-${record.index}`, shot);
        record.screenshotKey = stored.key;
      } catch {
        /* screenshot is best effort */
      }
      this.current = null;
    }
    return record.status === 'passed';
  }

  /** Records a check. `explain` is how a failure reads in the report (plain title, summary, steps). */
  check(name: string, passed: boolean, expected?: string | number, actual?: string | number, explain?: CheckExplanation): boolean {
    const target = this.current ?? this.steps.at(-1);
    target?.checks?.push({
      name,
      passed,
      ...(expected !== undefined ? { expected: String(expected) } : {}),
      ...(actual !== undefined ? { actual: String(actual) } : {}),
      ...(!passed && explain ? { explain } : {}),
    });
    return passed;
  }

  /** How many requests the safety guard has blocked so far in this journey. */
  blockedCount(): number {
    return this.init.guard.blocked.length;
  }

  requireFull(): void {
    if (this.permissions.mode !== 'FULL') {
      throw new BlockedError('Needs Full mode: this run is read-only, so data-changing steps are not tested.');
    }
  }

  requireTransactions(): void {
    if (!this.permissions.transactionsAllowed) throw new BlockedError(this.permissions.transactionsReason);
  }

  async goto(pathOrUrl: string): Promise<void> {
    const url = new URL(pathOrUrl, this.baseUrl).toString();
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await waitForSpaSettle(this.page, 6_000).catch(() => undefined);
    await this.assertNoBotCheck();
  }

  async settle(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => undefined);
    await waitForSpaSettle(this.page, 5_000).catch(() => undefined);
    await this.assertNoBotCheck();
  }

  /** Stops the step (as blocked, not failed) when bot protection replaces the page. It is never bypassed. */
  async assertNoBotCheck(): Promise<void> {
    const reason = await detectBotCheck(this.page);
    if (reason) {
      throw new BlockedError(`Blocked by bot protection: ${reason}. Allow the auditor in your bot protection settings to test this page.`);
    }
  }

  /** Best visible control for a role, honouring the project's label hints first. */
  async find(role: ControlRole, options: { scope?: string; within?: Locator; prefer?: 'first' | 'last' } = {}): Promise<Found | null> {
    const list = (await this.page.evaluate(`(${CANDIDATES_SCRIPT})(${JSON.stringify(options.scope ?? null)})`)) as Candidate[];
    const hints = this.plan.controlHints.filter((hint) => hint.role === role).map((hint) => hint.label.trim().toLowerCase());
    const pattern = ROLE_PATTERNS[role];
    let best: { candidate: Candidate; score: number } | null = null;
    for (const candidate of list) {
      const text = candidate.text.trim();
      const lower = text.toLowerCase();
      let score = 0;
      if (hints.length && hints.some((hint) => lower === hint)) score += 100;
      else if (hints.length && hints.some((hint) => lower.includes(hint))) score += 60;
      if (pattern.text.test(text)) score += 40;
      if (pattern.attr?.test(candidate.attrs)) score += 25;
      if (pattern.href && candidate.href && pattern.href.test(candidate.href)) score += 35;
      if (pattern.avoid?.test(`${text} ${candidate.attrs}`)) score -= 80;
      if (pattern.tags && !pattern.tags.includes(candidate.tag)) score -= 30;
      if (score <= 20) continue;
      if (!best || score > best.score || (score === best.score && options.prefer === 'last' && candidate.y > best.candidate.y)) {
        best = { candidate, score };
      }
    }
    if (!best) return null;
    return {
      locator: this.page.locator(`[data-snaghunt-target="${best.candidate.index}"]`).first(),
      label: best.candidate.text || best.candidate.attrs.slice(0, 40),
      href: best.candidate.href,
      tag: best.candidate.tag,
    };
  }

  async mustFind(role: ControlRole, what: string, options?: { scope?: string; prefer?: 'first' | 'last' }): Promise<Found> {
    const found = await this.find(role, options);
    if (!found) {
      throw new NotFoundError(`Could not find ${what} on ${pathOf(this.page.url())}. Add a control hint for "${role}" in the test plan if your app labels it differently.`);
    }
    return found;
  }

  async click(found: Found, label?: string): Promise<void> {
    await this.init.live
      ?.setAction({ kind: 'click', label: `${this.init.journeyName}: ${label ?? `"${found.label}"`}`, box: await LiveStreamer.boxOf(found.locator), phase: 'journeys' })
      .catch(() => undefined);
    await found.locator.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
    await found.locator.click({ timeout: 8_000 });
    await this.settle();
  }

  /** Fills every visible, empty field in the page (or a scope) with the plan's test data. Returns how many were filled. */
  async fillForm(scope?: Locator): Promise<number> {
    const root = scope ?? this.page.locator('body');
    let filled = 0;
    const fields = root.locator('input:visible, textarea:visible, select:visible');
    const count = Math.min(await fields.count(), 60);
    for (let i = 0; i < count; i += 1) {
      const field = fields.nth(i);
      const tag = await field.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
      const type = ((await field.getAttribute('type')) ?? '').toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset', 'file', 'search'].includes(type)) continue;
      if (await field.isDisabled().catch(() => true)) continue;
      const descriptor = await field.evaluate((el) => {
        const id = el.getAttribute('id');
        const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : el.closest('label');
        return {
          name: el.getAttribute('name'),
          label: (label?.textContent ?? el.getAttribute('aria-label') ?? '').trim(),
          placeholder: el.getAttribute('placeholder'),
          autocomplete: el.getAttribute('autocomplete'),
          required: (el as HTMLInputElement).required === true,
          min: el.getAttribute('min'),
          max: el.getAttribute('max'),
          maxLength: (el as HTMLInputElement).maxLength > 0 ? (el as HTMLInputElement).maxLength : null,
          pattern: el.getAttribute('pattern'),
          value: (el as HTMLInputElement).value ?? '',
        };
      });
      if (tag === 'select') {
        const chosen = await this.pickOption(field, descriptor.label || descriptor.name || '');
        if (chosen) filled += 1;
        continue;
      }
      if (type === 'checkbox') {
        if (descriptor.required && !(await field.isChecked())) {
          await field.check({ timeout: 2_000 }).catch(() => undefined);
          filled += 1;
        }
        continue;
      }
      if (type === 'radio') {
        const name = descriptor.name;
        if (name && !(await root.locator(`input[type="radio"][name="${name.replace(/"/g, '\\"')}"]:checked`).count())) {
          await field.check({ timeout: 2_000 }).catch(() => undefined);
          filled += 1;
        }
        continue;
      }
      if (descriptor.value.trim()) continue;
      const value = this.valueForField({ ...descriptor, inputType: type || (tag === 'textarea' ? 'textarea' : 'text'), tag });
      if (value === null) continue;
      await field.fill(value, { timeout: 3_000 }).catch(() => undefined);
      filled += 1;
    }
    return filled;
  }

  /** Value for a field from the plan's test data (address, contact), falling back to field-aware defaults. Never card data. */
  valueForField(field: {
    name: string | null;
    label: string;
    placeholder: string | null;
    autocomplete: string | null;
    inputType: string;
    tag: string;
    min?: string | null;
    max?: string | null;
    maxLength?: number | null;
    pattern?: string | null;
  }): string | null {
    const data = this.plan.testData;
    const descriptor = {
      name: field.name,
      label: field.label,
      placeholder: field.placeholder,
      autocomplete: field.autocomplete,
      inputType: field.inputType,
      tag: field.tag,
      min: field.min,
      max: field.max,
      maxLength: field.maxLength,
      pattern: field.pattern,
    };
    const custom = Object.entries(data.custom).find(([key]) =>
      [field.name, field.label, field.placeholder].some((item) => item && item.toLowerCase().includes(key.toLowerCase())),
    );
    if (custom) return custom[1];
    const kind = classifyField(descriptor);
    const hay = `${field.name ?? ''} ${field.label} ${field.placeholder ?? ''} ${field.autocomplete ?? ''}`.toLowerCase();
    if (kind === 'payment' || kind === 'secret') return null;
    if (kind === 'email') return data.email || `snaghunt+${this.token}@example.com`;
    if (kind === 'phone') return data.phone;
    if (kind === 'postal') return data.postalCode;
    if (kind === 'firstName') return data.firstName;
    if (kind === 'lastName') return data.lastName;
    if (kind === 'fullName') return `${data.firstName} ${data.lastName}`;
    if (kind === 'company') return data.company || `Snaghunt ${this.token}`;
    if (kind === 'street') return /line ?2|address ?2|apartment|suite|apt/.test(hay) ? data.address2 || 'Suite 1' : data.address1;
    if (kind === 'city') return data.city;
    if (kind === 'state') return data.state;
    if (kind === 'country') return data.country;
    if (/coupon|promo|voucher|discount code/.test(hay)) return data.coupon || null;
    return valueFor(descriptor, { token: this.token });
  }

  private async pickOption(select: Locator, label: string): Promise<boolean> {
    const options = await select.locator('option').evaluateAll((items) =>
      items.map((item) => ({ value: (item as HTMLOptionElement).value, text: (item.textContent ?? '').trim(), disabled: (item as HTMLOptionElement).disabled })),
    );
    const usable = options.filter((option) => option.value && !option.disabled && !/^(select|choose|--|please)/i.test(option.text));
    if (usable.length === 0) return false;
    const data = this.plan.testData;
    const wanted = /country/i.test(label) ? data.country : /state|province|region/i.test(label) ? data.state : '';
    const match = wanted ? usable.find((option) => option.text.toLowerCase() === wanted.toLowerCase() || option.value.toLowerCase() === wanted.toLowerCase()) : undefined;
    const current = await select.inputValue().catch(() => '');
    if (!match && usable.some((option) => option.value === current)) return false;
    await select.selectOption((match ?? usable[0])!.value, { timeout: 3_000 }).catch(() => undefined);
    return true;
  }

  /** Number shown on the cart link/badge, or null when the site shows none. */
  async cartCount(): Promise<number | null> {
    return (await this.page.evaluate(`(() => {
      const els = Array.from(document.querySelectorAll('a[href*="cart" i], a[href*="basket" i], a[href*="bag" i], [class*="cart" i], [id*="cart" i], [aria-label*="cart" i], [data-testid*="cart" i]'));
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const text = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).replace(/\\s+/g, ' ');
        const m = text.match(/(\\d{1,4})/);
        if (m && text.length < 80) return Number(m[1]);
      }
      return null;
    })()`)) as number | null;
  }

  /** Refuses to continue when the page is configured with live payment keys. */
  async assertNoLivePayment(): Promise<void> {
    const html = await this.page.content().catch(() => '');
    const frames = this.page.frames().map((frame) => frame.url()).join(' ');
    if (LIVE_PAYMENT_KEY_PATTERN.test(html) || LIVE_PAYMENT_KEY_PATTERN.test(frames)) {
      throw new BlockedError('This page uses live payment keys, so payment is not attempted. Use a staging site in sandbox mode.');
    }
  }

  /** Types the plan's sandbox test card into the card form, including provider iframes. */
  async fillSandboxCard(): Promise<number> {
    const card = this.plan.payment;
    const fields: Array<[RegExp, string]> = [
      [/cc-number|card.?number|cardnumber|\bpan\b/i, card.cardNumber],
      [/cc-exp|expir|exp-?date|mm ?\/ ?yy/i, card.expiry],
      [/cc-csc|cvc|cvv|security code|csc/i, card.cvc],
      [/cc-name|name on card|card ?holder|cardholder/i, card.nameOnCard],
    ];
    let filled = 0;
    const frames: Array<Page | Frame> = [this.page, ...this.page.frames().filter((frame) => frame !== this.page.mainFrame())];
    for (const frame of frames) {
      const inputs = frame.locator('input:visible');
      const count = Math.min(await inputs.count().catch(() => 0), 30);
      for (let i = 0; i < count; i += 1) {
        const input = inputs.nth(i);
        const hay = await input
          .evaluate((el) =>
            [el.getAttribute('name'), el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('id'), el.getAttribute('data-elements-stable-field-name')].join(' '),
          )
          .catch(() => '');
        const match = fields.find(([pattern]) => pattern.test(hay));
        if (!match) continue;
        if ((await input.inputValue().catch(() => 'x')).trim()) continue;
        await input.fill(match[1], { timeout: 3_000 }).catch(() => undefined);
        filled += 1;
      }
    }
    return filled;
  }
}

/** Parses "$1,234.56", "₹1,23,456.00", "1.234,56 €" into a number. */
export function parseMoney(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/\u00a0/g, ' ').match(/-?\(?\s*(?:[A-Z]{3}|[$€£₹¥₩₽])?\s*\d[\d.,\s']*\d|\d/);
  if (!match) return null;
  let raw = match[0].replace(/[^\d.,-]/g, '');
  const negative = raw.startsWith('-') || match[0].includes('(');
  raw = raw.replace(/-/g, '');
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    raw = lastComma > lastDot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (lastComma > -1) {
    raw = raw.length - lastComma - 1 === 2 ? raw.replace(',', '.') : raw.replace(/,/g, '');
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function moneyEqual(a: number | null, b: number | null, tolerance = 0.011): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= tolerance;
}

export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}
