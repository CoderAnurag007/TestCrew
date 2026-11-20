import { installSafetyGuard, isThirdPartyTrackerError, runWithDevice, type BrowserManager, type SafetyPolicy } from '@auditor/browser';
import type { Prisma } from '@auditor/database';
import type { Page } from 'playwright';
import { appendEvent, type AuditDependencies } from './engine.js';

/**
 * A fast first look (about two minutes) before the full audit: the home page and
 * the main links, checked for the problems a visitor notices first. Snags found
 * here are saved straight away, so a new user sees results within minutes instead
 * of waiting for the whole audit. The full audit later replaces any snag it finds
 * again, so nothing is reported twice.
 */

const MAX_PAGES = 8;
const PAGE_TIMEOUT_MS = 15_000;
const BUDGET_MS = 150_000;
const SLOW_MS = 8_000;
const SKIP = /log ?out|sign ?out|delete|remove|unsubscribe|cancel|\.(pdf|zip|jpg|png|mp4)(\?|$)/i;

export const QUICK_PREFIX = 'quick|';

type Snag = {
  kind: 'broken-page' | 'script-error' | 'broken-images' | 'slow-page' | 'phone-overflow';
  url: string;
  title: string;
  description: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'BUG' | 'VISUAL' | 'PERFORMANCE';
  expected: string;
  actual: string;
  recommendation: string;
  steps: string[];
  screenshot?: Buffer;
};

type PageCheck = {
  status: number | null;
  loadMs: number;
  errors: string[];
  brokenImages: string[];
};

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

async function checkPage(page: Page, url: string): Promise<PageCheck> {
  const errors: string[] = [];
  const onError = (error: Error) => {
    if (!isThirdPartyTrackerError(error.message)) errors.push(error.message.split('\n')[0]!.slice(0, 200));
  };
  page.on('pageerror', onError);
  const started = Date.now();
  let status: number | null = null;
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    status = response?.status() ?? null;
    await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => undefined);
  } catch {
    status = null;
  }
  const loadMs = Date.now() - started;
  await page.waitForTimeout(1_200);
  const brokenImages = (await page
    .evaluate(() =>
      Array.from(document.images)
        .filter((img) => {
          const box = img.getBoundingClientRect();
          return img.complete && img.naturalWidth === 0 && box.width > 4 && box.height > 4 && img.currentSrc;
        })
        .map((img) => img.currentSrc)
        .slice(0, 20),
    )
    .catch(() => [])) as string[];
  page.off('pageerror', onError);
  return { status, loadMs, errors, brokenImages };
}

async function mainLinks(page: Page, origin: string): Promise<string[]> {
  const hrefs = (await page
    // Written without named helpers: tsx renames them, and the renamed code
    // fails inside the page ("__name is not defined").
    .evaluate(() => {
      const scoped = Array.from(document.querySelectorAll('header a[href], nav a[href], main a[href], footer a[href]'));
      const anchors = scoped.length ? scoped : Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
        .map((a) => (a as HTMLAnchorElement).href);
    })
    .catch(() => [])) as string[];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const href of hrefs) {
    let parsed: URL;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.origin !== origin || SKIP.test(href)) continue;
    parsed.hash = '';
    const key = parsed.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function snagsFor(url: string, check: PageCheck, isHome: boolean): Snag[] {
  const where = pathOf(url);
  const open = `Open ${url}`;
  const snags: Snag[] = [];
  if (check.status === null || check.status >= 400) {
    const what = check.status ? `answers with error ${check.status}` : 'does not load';
    snags.push({
      kind: 'broken-page',
      url,
      title: isHome ? `The home page ${what}` : `The page ${where} ${what}`,
      description: `Visitors who open ${where}${isHome ? '' : ' from the site’s own links'} get ${check.status ? `an error page (HTTP ${check.status})` : 'nothing: the page did not load within 15 seconds'}.`,
      severity: isHome || (check.status ?? 500) >= 500 ? 'HIGH' : 'MEDIUM',
      category: 'BUG',
      expected: 'The page loads',
      actual: check.status ? `HTTP ${check.status}` : 'No response within 15 seconds',
      recommendation: check.status === 404 ? 'Fix or remove the link, or restore the page.' : 'Check the server logs for this page.',
      steps: isHome ? [open] : ['Open the home page', `Click the link to ${where}`],
    });
  }
  if (check.errors.length) {
    snags.push({
      kind: 'script-error',
      url,
      title: `${isHome ? 'The home page' : `The page ${where}`} hits a script error while loading`,
      description: `The page threw a JavaScript error as it loaded: “${check.errors[0]}”. Parts of the page may not work.`,
      severity: 'MEDIUM',
      category: 'BUG',
      expected: 'No script errors',
      actual: check.errors[0]!,
      recommendation: 'Open the browser console on this page to see where the error comes from.',
      steps: [open, 'Open the browser console'],
    });
  }
  if (check.brokenImages.length) {
    const count = check.brokenImages.length;
    snags.push({
      kind: 'broken-images',
      url,
      title: `${count} image${count === 1 ? '' : 's'} not loading on ${isHome ? 'the home page' : where}`,
      description: `${count === 1 ? 'An image shows' : `${count} images show`} as broken: ${check.brokenImages.slice(0, 3).join(', ')}${count > 3 ? ', …' : ''}.`,
      severity: count >= 3 ? 'MEDIUM' : 'LOW',
      category: 'VISUAL',
      expected: 'Every image loads',
      actual: `${count} broken`,
      recommendation: 'Check that these image files still exist and that the links are right.',
      steps: [open, 'Look for empty or broken image boxes'],
    });
  }
  if (check.status !== null && check.status < 400 && check.loadMs > SLOW_MS) {
    snags.push({
      kind: 'slow-page',
      url,
      title: `${isHome ? 'The home page' : `The page ${where}`} is slow to load`,
      description: `It took ${(check.loadMs / 1000).toFixed(1)} seconds to load. Many visitors leave after about 3 seconds.`,
      severity: 'LOW',
      category: 'PERFORMANCE',
      expected: 'Loads in under 3 seconds',
      actual: `${(check.loadMs / 1000).toFixed(1)} seconds`,
      recommendation: 'Look at large images and slow server responses on this page.',
      steps: [open],
    });
  }
  return snags;
}

/** Checks the home page at phone width in a separate, read-only browser. */
async function phoneCheck(manager: BrowserManager, url: string, policy: SafetyPolicy): Promise<Snag | null> {
  return runWithDevice('phone', async () => {
    const context = await manager.createContext();
    try {
      await installSafetyGuard(context, policy);
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
      await page.waitForTimeout(1_000);
      const size = await page
        .evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }))
        .catch(() => null);
      if (!size || size.page <= size.screen + 8) return null;
      return {
        kind: 'phone-overflow' as const,
        url,
        title: 'The home page is wider than a phone screen',
        description: `On a phone (${size.screen}px wide) the page is ${size.page}px wide, so visitors have to scroll sideways and some content is cut off.`,
        severity: 'MEDIUM' as const,
        category: 'VISUAL' as const,
        expected: `Fits ${size.screen}px`,
        actual: `${size.page}px wide`,
        recommendation: 'Find the element wider than the screen (often a table, image or fixed-width box) and let it shrink or wrap.',
        steps: ['Open the home page on a phone', 'Try scrolling sideways'],
        screenshot: await page.screenshot({ type: 'png' }).catch(() => undefined),
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  });
}

export async function runQuickScan(
  deps: AuditDependencies,
  input: {
    runId: string;
    organizationId: string;
    projectId: string;
    page: Page;
    manager: BrowserManager;
    targetUrl: string;
    device: string;
    policy: SafetyPolicy;
  },
): Promise<number> {
  const started = Date.now();
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'stage',
    message: 'Quick scan: checking the home page and main links first.',
  });
  const origin = new URL(input.targetUrl).origin;
  const snags: Snag[] = [];

  const home = await checkPage(input.page, input.targetUrl);
  const homeShot = await input.page.screenshot({ type: 'png' }).catch(() => undefined);
  for (const snag of snagsFor(input.targetUrl, home, true)) snags.push({ ...snag, screenshot: homeShot });

  const links = home.status && home.status < 400 ? (await mainLinks(input.page, origin)).filter((url) => url !== new URL(input.targetUrl).toString()) : [];
  for (const url of links.slice(0, MAX_PAGES)) {
    if (Date.now() - started > BUDGET_MS) break;
    await deps.prisma.run
      .update({ where: { id: input.runId }, data: { currentUrl: url, currentAction: 'Quick scan' } })
      .catch(() => undefined);
    const check = await checkPage(input.page, url);
    const found = snagsFor(url, check, false);
    const shot = found.length ? await input.page.screenshot({ type: 'png' }).catch(() => undefined) : undefined;
    for (const snag of found) snags.push({ ...snag, screenshot: shot });
  }

  // Desktop audits also get a look at phone width; phone audits already are one.
  if (input.device === 'desktop' || input.device === 'safari') {
    const phone = await phoneCheck(input.manager, input.targetUrl, input.policy).catch(() => null);
    if (phone) snags.push(phone);
  }

  const previous = await previousSignatures(deps, input);
  for (const snag of snags) {
    const signature = `${QUICK_PREFIX}${snag.kind}|${pathOf(snag.url)}`.slice(0, 250);
    const finding = await deps.prisma.finding.create({
      data: {
        organizationId: input.organizationId,
        runId: input.runId,
        projectId: input.projectId,
        title: snag.title.slice(0, 240),
        description: snag.description,
        severity: snag.severity,
        category: snag.category,
        confidence: 0.85,
        expected: snag.expected,
        actual: snag.actual,
        recommendation: snag.recommendation,
        steps: snag.steps as unknown as Prisma.InputJsonValue,
        signature,
        url: snag.url,
        change: previous.has(signature) ? 'RECURRING' : 'NEW',
      },
    });
    if (snag.screenshot) {
      const key = `runs/${input.runId}/quick-${finding.id}.png`;
      await deps.storage.put({ key, body: snag.screenshot, contentType: 'image/png' }).catch(() => undefined);
      await deps.prisma.evidence
        .create({
          data: {
            organizationId: input.organizationId,
            runId: input.runId,
            findingId: finding.id,
            type: 'SCREENSHOT',
            storageKey: key,
            contentType: 'image/png',
            fileName: `${snag.kind}.png`,
            byteLength: snag.screenshot.length,
          },
        })
        .catch(() => undefined);
    }
  }

  const seconds = Math.round((Date.now() - started) / 1000);
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'stage',
    message: snags.length
      ? `Quick scan found ${snags.length} snag${snags.length === 1 ? '' : 's'} in ${seconds} s across ${1 + Math.min(links.length, MAX_PAGES)} pages. The full audit continues.`
      : `Quick scan: ${1 + Math.min(links.length, MAX_PAGES)} pages look fine (${seconds} s). The full audit continues.`,
  });
  // Back to the start page for the full audit.
  await input.page.goto(input.targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
  return snags.length;
}

async function previousSignatures(deps: AuditDependencies, input: { runId: string; projectId: string }): Promise<Set<string>> {
  const previous = await deps.prisma.run.findFirst({
    where: { projectId: input.projectId, status: 'COMPLETED', id: { not: input.runId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!previous) return new Set();
  const rows = await deps.prisma.finding.findMany({
    where: { runId: previous.id, signature: { startsWith: QUICK_PREFIX } },
    select: { signature: true },
  });
  return new Set(rows.map((row) => row.signature).filter((value): value is string => Boolean(value)));
}

/**
 * After the full audit saved its findings: a quick snag that the full audit
 * found again is removed (its screenshot moves to the full finding), so each
 * problem appears once. Quick snags the full audit did not repeat stay.
 */
export async function reconcileQuickFindings(deps: Pick<AuditDependencies, 'prisma'>, runId: string): Promise<number> {
  const all = await deps.prisma.finding.findMany({
    where: { runId },
    select: { id: true, signature: true, category: true, url: true, title: true },
  });
  const quick = all.filter((item) => item.signature?.startsWith(QUICK_PREFIX));
  const full = all.filter((item) => !item.signature?.startsWith(QUICK_PREFIX));
  let removed = 0;
  for (const item of quick) {
    const kind = item.signature!.split('|')[1];
    const path = item.url ? pathOf(item.url) : '';
    const covering = full.find((other) => {
      const otherPath = other.url ? pathOf(other.url) : '';
      if (kind === 'broken-page') return /^link\|/.test(other.signature ?? '') && otherPath === path;
      if (kind === 'broken-images') return /^img/.test(other.signature ?? '') && (otherPath === path || /^img-host/.test(other.signature ?? ''));
      if (kind === 'script-error') return /^page\|/.test(other.signature ?? '') && otherPath === path && /error/i.test(other.title);
      if (kind === 'phone-overflow') return other.category === 'VISUAL' && /overflow|wider/i.test(other.title) && otherPath === path;
      return false;
    });
    if (!covering) continue;
    await deps.prisma.evidence.updateMany({ where: { findingId: item.id }, data: { findingId: covering.id } });
    await deps.prisma.finding.delete({ where: { id: item.id } });
    removed += 1;
  }
  return removed;
}
