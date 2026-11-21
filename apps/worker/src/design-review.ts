import { DesignReviewAgent, DESIGN_REVIEW_PROMPT_VERSION, type DesignPageReview } from '@auditor/ai';
import { installSafetyGuard, runWithDevice, type BrowserManager, type LiveStreamer, type SafetyPolicy } from '@auditor/browser';
import type { Prisma } from '@auditor/database';
import {
  DESIGN_AREA_LABELS,
  DESIGN_COMPONENT_PREFIX,
  DESIGN_SIGNATURE_PREFIX,
  normalizeDesignArea,
  scoreDesign,
  type DesignArea,
  type DesignMark,
  type DesignReport,
} from '@auditor/shared';
import type { BrowserContext, Page } from 'playwright';
import { LAYOUT_SHIFT_SCRIPT, MEASURE_SCRIPT, PRELOAD_SCRIPT, type MeasuredBox, type PageMeasurements } from './design-measure.js';
import { appendEvent, setRunStatus, type AuditDependencies } from './engine.js';
import { mainLinks, pathOf } from './quick-scan.js';

/**
 * Design review: an optional part of an audit. It opens the main pages on a
 * computer and a phone, measures what can be measured (contrast, text size,
 * tap targets, overflow, images, labels, layout shift, consistency) and asks the
 * AI model to review the screenshots like a designer would. Every point names
 * where it is, and the report marks it on the screenshot.
 */

const MAX_PAGES = 6;
const PAGE_TIMEOUT_MS = 20_000;
const BUDGET_MS = 6 * 60_000;
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MAX_SHOT_HEIGHT = { desktop: 4_000, phone: 5_000 };
const SKIP = /log ?out|sign ?out|delete|remove|unsubscribe|cancel|\.(pdf|zip|jpg|png|mp4)(\?|$)/i;

type Shot = 'desktop' | 'phone';

type Capture = {
  measure: PageMeasurements;
  layoutShift: number | null;
  firstScreen: Buffer;
  full: Buffer;
  /** Height of the stored full screenshot, in CSS pixels. */
  fullHeight: number;
};

type ReviewedPage = {
  url: string;
  title: string | null;
  desktop: Capture;
  phone: Capture | null;
  evidence: { desktop: string | null; phone: string | null };
  keys: { desktop: string | null; phone: string | null };
};

export type DesignIssue = {
  key: string;
  area: DesignArea;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  recommendation: string;
  expected?: string;
  actual?: string;
  steps: string[];
  url: string;
  confidence: number;
  marks: Array<{ url: string; shot: Shot; boxes: DesignMark[] }>;
};

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** A box measured in page pixels, as fractions of a stored screenshot. */
export function toMark(box: MeasuredBox, width: number, height: number): DesignMark | null {
  const [x, y, w, h] = box;
  if (y >= height || w <= 0 || h <= 0) return null;
  return { x: clamp(x / width), y: clamp(y / height), w: clamp(w / width), h: clamp(Math.min(h, height - y) / height) };
}

/** A model's [ymin, xmin, ymax, xmax] box (0–1000) on a first-screen shot, moved onto the full-page shot. */
export function aiBoxToMark(box: number[], screenHeight: number, fullHeight: number, fromFullPage: boolean): DesignMark | null {
  const [ymin, xmin, ymax, xmax] = box.map((value) => clamp(value / 1000)) as [number, number, number, number];
  if (ymax <= ymin || xmax <= xmin) return null;
  const scale = fromFullPage ? 1 : screenHeight / fullHeight;
  return { x: xmin, y: clamp(ymin * scale), w: xmax - xmin, h: clamp((ymax - ymin) * scale) };
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

function onPages(urls: string[]): string {
  const paths = [...new Set(urls.map(pathOf))];
  return paths.length === 1 ? `on ${paths[0]}` : `on ${paths.length} pages (${paths.slice(0, 4).join(', ')}${paths.length > 4 ? ', …' : ''})`;
}

/** Turns the measurements of every reviewed page into site-wide issues, one per kind. */
export function measuredIssues(pages: Array<Pick<ReviewedPage, 'url' | 'desktop' | 'phone'>>): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const marksFor = (
    shot: Shot,
    pick: (capture: Capture) => Array<{ box: MeasuredBox }>,
    minimum = 1,
  ): { urls: string[]; count: number; marks: DesignIssue['marks'] } => {
    const urls: string[] = [];
    let count = 0;
    const marks: DesignIssue['marks'] = [];
    for (const page of pages) {
      const capture = shot === 'desktop' ? page.desktop : page.phone;
      if (!capture) continue;
      const items = pick(capture);
      if (items.length < minimum) continue;
      urls.push(page.url);
      count += items.length;
      const boxes = items
        .slice(0, 10)
        .map((item) => toMark(item.box, capture.measure.viewportWidth, capture.fullHeight))
        .filter((mark): mark is DesignMark => Boolean(mark));
      if (boxes.length) marks.push({ url: page.url, shot, boxes });
    }
    return { urls, count, marks };
  };

  const contrast = marksFor('desktop', (capture) => capture.measure.contrast);
  if (contrast.count) {
    const worst = pages
      .flatMap((page) => page.desktop.measure.contrast)
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 3);
    issues.push({
      key: 'contrast',
      area: 'accessibility',
      severity: (worst[0]?.ratio ?? 5) < 2.5 || contrast.count >= 10 ? 'MEDIUM' : 'LOW',
      title: 'Some text is hard to read against its background',
      description: `${plural(contrast.count, 'piece')} of text ${onPages(contrast.urls)} are below the WCAG AA contrast minimum (4.5:1 for normal text, 3:1 for large text). People with weaker eyesight, or anyone in bright light, will struggle to read them.`,
      recommendation: 'Darken the text or change the background until each pair reaches the minimum. A contrast checker shows the ratio as you adjust.',
      expected: 'At least 4.5:1 (3:1 for large text)',
      actual: worst.map((item) => `“${item.text}” ${item.ratio}:1 (${item.fg} on ${item.bg})`).join('; '),
      steps: [`Open ${contrast.urls[0]}`, ...worst.map((item) => `Find “${item.text}”: ${item.fg} text on ${item.bg} is ${item.ratio}:1`)],
      url: contrast.urls[0]!,
      confidence: 0.9,
      marks: contrast.marks,
    });
  }

  const small = marksFor('phone', (capture) => capture.measure.smallText, 3);
  if (small.count) {
    issues.push({
      key: 'small-text',
      area: 'readability',
      severity: small.count >= 15 ? 'MEDIUM' : 'LOW',
      title: 'Some text is too small to read on a phone',
      description: `${plural(small.count, 'piece')} of text ${onPages(small.urls)} are smaller than 12px on a phone, so visitors have to zoom in to read them.`,
      recommendation: 'Use at least 12px for small print and about 16px for body text on phones.',
      expected: '12px or larger',
      actual: `${small.count} smaller`,
      steps: [`Open ${small.urls[0]} on a phone`, 'Look for the small print marked on the screenshot'],
      url: small.urls[0]!,
      confidence: 0.85,
      marks: small.marks,
    });
  }

  const taps = marksFor('phone', (capture) => capture.measure.tapTargets, 3);
  if (taps.count) {
    issues.push({
      key: 'tap-targets',
      area: 'phone',
      severity: taps.count >= 10 ? 'MEDIUM' : 'LOW',
      title: 'Buttons and links are too small to tap on a phone',
      description: `${plural(taps.count, 'button or link', 'buttons and links')} ${onPages(taps.urls)} are smaller than 24×24px, so people tap the wrong thing or miss.`,
      recommendation: 'Make tap areas at least 24×24px (44×44px is better) by adding padding, and keep space between them.',
      expected: 'At least 24×24px',
      actual: pages
        .flatMap((page) => page.phone?.measure.tapTargets ?? [])
        .slice(0, 3)
        .map((item) => `“${item.label}” ${item.width}×${item.height}px`)
        .join('; '),
      steps: [`Open ${taps.urls[0]} on a phone`, 'Try tapping the small links marked on the screenshot'],
      url: taps.urls[0]!,
      confidence: 0.85,
      marks: taps.marks,
    });
  }

  const overflow = marksFor('phone', (capture) => capture.measure.overflow);
  const wide = pages.filter((page) => page.phone && page.phone.measure.docWidth > page.phone.measure.viewportWidth + 8);
  if (wide.length) {
    const first = wide[0]!.phone!.measure;
    issues.push({
      key: 'overflow',
      area: 'phone',
      severity: 'MEDIUM',
      title: 'The page is wider than a phone screen',
      description: `${onPages(wide.map((page) => page.url)).replace(/^on/, 'On')} the page is wider than the phone screen (${first.docWidth}px on a ${first.viewportWidth}px screen), so visitors scroll sideways and some content is cut off.`,
      recommendation: `Find the element that is too wide${first.overflow[0] ? ` (here: ${first.overflow.map((item) => item.label).slice(0, 3).join(', ')})` : ''} and let it shrink or wrap.`,
      expected: `Fits ${first.viewportWidth}px`,
      actual: `${first.docWidth}px wide`,
      steps: [`Open ${wide[0]!.url} on a phone`, 'Try scrolling sideways'],
      url: wide[0]!.url,
      confidence: 0.9,
      marks: overflow.marks,
    });
  }

  const blurry = marksFor('desktop', (capture) => capture.measure.blurryImages);
  if (blurry.count) {
    issues.push({
      key: 'blurry-images',
      area: 'visual',
      severity: blurry.count >= 3 ? 'MEDIUM' : 'LOW',
      title: 'Some images look blurry',
      description: `${plural(blurry.count, 'image')} ${onPages(blurry.urls)} are shown much larger than the file itself, so they look soft or pixelated.`,
      recommendation: 'Upload larger versions (about twice the size they are shown at, for sharp screens) or use srcset.',
      steps: [`Open ${blurry.urls[0]}`, 'Look at the marked images'],
      url: blurry.urls[0]!,
      confidence: 0.8,
      marks: blurry.marks,
    });
  }

  const stretched = marksFor('desktop', (capture) => capture.measure.stretchedImages);
  if (stretched.count) {
    issues.push({
      key: 'stretched-images',
      area: 'visual',
      severity: 'MEDIUM',
      title: 'Some images are stretched or squashed',
      description: `${plural(stretched.count, 'image')} ${onPages(stretched.urls)} are shown at a different shape than the picture itself, so they look distorted.`,
      recommendation: 'Keep the original shape, or crop with object-fit: cover instead of stretching.',
      steps: [`Open ${stretched.urls[0]}`, 'Look at the marked images'],
      url: stretched.urls[0]!,
      confidence: 0.8,
      marks: stretched.marks,
    });
  }

  const alt = marksFor('desktop', (capture) => capture.measure.missingAlt);
  if (alt.count) {
    issues.push({
      key: 'missing-alt',
      area: 'accessibility',
      severity: alt.count >= 5 ? 'MEDIUM' : 'LOW',
      title: 'Images have no description for screen readers',
      description: `${plural(alt.count, 'image')} ${onPages(alt.urls)} have no alt text, so blind visitors and search engines don’t know what they show.`,
      recommendation: 'Add a short alt text to each image that carries meaning, and alt="" to purely decorative ones.',
      steps: [`Open ${alt.urls[0]}`, 'Check the marked images for an alt attribute'],
      url: alt.urls[0]!,
      confidence: 0.9,
      marks: alt.marks,
    });
  }

  const fields = marksFor('desktop', (capture) => capture.measure.unlabeledFields);
  if (fields.count) {
    issues.push({
      key: 'unlabeled-fields',
      area: 'accessibility',
      severity: 'MEDIUM',
      title: 'Form fields have no label',
      description: `${plural(fields.count, 'form field')} ${onPages(fields.urls)} have no label (a placeholder alone disappears as soon as someone types, and screen readers may not announce it).`,
      recommendation: 'Give each field a visible <label>, or at least an aria-label.',
      actual: pages
        .flatMap((page) => page.desktop.measure.unlabeledFields)
        .slice(0, 3)
        .map((item) => `“${item.label}”`)
        .join(', '),
      steps: [`Open ${fields.urls[0]}`, 'Look at the marked fields'],
      url: fields.urls[0]!,
      confidence: 0.85,
      marks: fields.marks,
    });
  }

  const home = pages[0];
  if (home && home.desktop.measure.h1Count === 0) {
    issues.push({
      key: 'no-heading',
      area: 'accessibility',
      severity: 'LOW',
      title: 'The home page has no main heading',
      description: 'There is no visible <h1> on the home page. Screen readers and search engines use it to tell what the page is about.',
      recommendation: 'Mark the main headline of the page as an <h1>.',
      steps: [`Open ${home.url}`],
      url: home.url,
      confidence: 0.8,
      marks: [],
    });
  }

  const typefaces = typefacesOf(pages);
  if (typefaces.length > 3) {
    issues.push({
      key: 'typefaces',
      area: 'consistency',
      severity: 'LOW',
      title: `The site uses ${typefaces.length} different typefaces`,
      description: `Text is set in ${typefaces.slice(0, 6).join(', ')}. More than two or three typefaces makes a site look less polished.`,
      recommendation: 'Pick one typeface for text and at most one for headings, and use them everywhere.',
      steps: [`Open ${pages[0]!.url}`],
      url: pages[0]!.url,
      confidence: 0.75,
      marks: [],
    });
  }

  const buttonStyles = Math.max(0, ...pages.map((page) => page.desktop.measure.buttonStyles));
  if (buttonStyles > 6) {
    const page = pages.find((item) => item.desktop.measure.buttonStyles === buttonStyles)!;
    issues.push({
      key: 'button-styles',
      area: 'consistency',
      severity: 'LOW',
      title: 'Buttons come in many different styles',
      description: `${pathOf(page.url)} has ${buttonStyles} different button styles (colour, corners or size). Visitors learn what is clickable faster when buttons look alike.`,
      recommendation: 'Settle on a main and a secondary button style and use them everywhere.',
      steps: [`Open ${page.url}`],
      url: page.url,
      confidence: 0.7,
      marks: [],
    });
  }

  const shifts = pages.map((page) => ({ url: page.url, value: page.desktop.layoutShift ?? 0 })).sort((a, b) => b.value - a.value);
  if (shifts[0] && shifts[0].value > 0.1) {
    issues.push({
      key: 'layout-shift',
      area: 'layout',
      severity: shifts[0].value > 0.25 ? 'MEDIUM' : 'LOW',
      title: 'Content jumps around while the page loads',
      description: `On ${pathOf(shifts[0].url)} parts of the page move after they first appear (layout shift ${shifts[0].value}; under 0.1 is good). Visitors lose their place or click the wrong thing.`,
      recommendation: 'Reserve space for images, ads and banners (width and height attributes or aspect-ratio) so they don’t push content down.',
      expected: 'Under 0.1',
      actual: String(shifts[0].value),
      steps: [`Open ${shifts[0].url}`, 'Watch the page while it loads'],
      url: shifts[0].url,
      confidence: 0.8,
      marks: [],
    });
  }

  return issues;
}

/** Topics a site has once, however many pages show them. */
const TOPICS: RegExp[] = [
  /cookie|consent|privacy banner|gdpr/i,
  /contrast/i,
  /tap|touch target|too small to (tap|click)/i,
  /(small|tiny) (text|font)|font size/i,
  /wider than|horizontal scroll|sideways|overflow/i,
  /blurr|pixelat/i,
  /alt text|alternative text|screen reader/i,
  /\blabels?\b/i,
  /layout shift|jumps?|moves? (around|after)/i,
];

const STOP_WORDS = new Set(['the', 'a', 'an', 'on', 'of', 'and', 'to', 'is', 'in', 'for', 'with', 'are', 'too', 'page', 'mobile', 'phone', 'desktop']);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
      // A rough stem, so 'button' and 'buttons' or 'wrap' and 'wrapping' match.
      .map((word) => word.slice(0, 4)),
  );
}

/** True when an AI issue repeats one already reported (same topic, or mostly the same words). */
export function repeatsKnownIssue(title: string, known: string[]): boolean {
  const topic = TOPICS.find((pattern) => pattern.test(title));
  if (topic && known.some((item) => topic.test(item))) return true;
  const mine = words(title);
  return known.some((item) => {
    const theirs = words(item);
    const shared = [...mine].filter((word) => theirs.has(word)).length;
    return shared > 0 && shared / Math.min(mine.size, theirs.size) >= 0.6;
  });
}

function typefacesOf(pages: Array<Pick<ReviewedPage, 'desktop'>>): string[] {
  const counts = new Map<string, number>();
  for (const page of pages) for (const font of page.desktop.measure.fonts) counts.set(font.family, (counts.get(font.family) ?? 0) + font.count);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([family]) => family);
}

/** One AI issue as a design issue, with its box moved onto the stored screenshot. */
export function aiIssue(page: Pick<ReviewedPage, 'url' | 'desktop' | 'phone'>, issue: DesignPageReview['issues'][number]): DesignIssue {
  const onPhone = issue.image === 2 && page.phone;
  const capture = onPhone ? page.phone! : page.desktop;
  const mark = issue.box ? aiBoxToMark(issue.box, capture.measure.viewportHeight, capture.fullHeight, issue.image === 3) : null;
  const area = normalizeDesignArea(issue.area);
  return {
    key: `ai|${area}|${pathOf(page.url)}|${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').filter(Boolean).slice(0, 6).join('-')}`,
    area,
    severity: issue.severity,
    title: issue.title,
    description: issue.problem,
    recommendation: issue.fix,
    actual: issue.evidence,
    steps: [`Open ${page.url} on ${onPhone ? 'a phone' : 'a computer'}`, issue.evidence],
    url: page.url,
    confidence: issue.confidence,
    marks: mark ? [{ url: page.url, shot: onPhone ? 'phone' : 'desktop', boxes: [mark] }] : [],
  };
}

async function capturePage(page: Page, url: string, shot: Shot): Promise<{ capture: Capture; title: string | null } | null> {
  let status: number | null = null;
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    status = response?.status() ?? null;
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
  } catch {
    return null;
  }
  if (status !== null && status >= 400) return null;
  await page.waitForTimeout(1_200);
  await page.evaluate(PRELOAD_SCRIPT).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
  const layoutShift = shot === 'desktop' ? ((await page.evaluate(LAYOUT_SHIFT_SCRIPT).catch(() => null)) as number | null) : null;
  const measure = (await page.evaluate(MEASURE_SCRIPT)) as PageMeasurements;
  const firstScreen = await page.screenshot({ type: 'jpeg', quality: 70, scale: 'css' });
  const fullHeight = Math.max(measure.viewportHeight, Math.min(measure.docHeight, MAX_SHOT_HEIGHT[shot]));
  const full = await page.screenshot({
    type: 'jpeg',
    quality: 65,
    scale: 'css',
    fullPage: true,
    clip: { x: 0, y: 0, width: measure.viewportWidth, height: fullHeight },
  });
  return { capture: { measure, layoutShift, firstScreen, full, fullHeight }, title: (await page.title().catch(() => '')) || null };
}

async function openContext(
  manager: BrowserManager,
  device: 'desktop' | 'phone',
  policy: SafetyPolicy,
  storageState: unknown,
): Promise<{ context: BrowserContext; page: Page }> {
  return runWithDevice(device, async () => {
    const context = await manager.createContext({
      ...(device === 'desktop' ? { viewport: DESKTOP_VIEWPORT } : {}),
      ...(storageState ? { storageState: storageState as never } : {}),
    });
    await installSafetyGuard(context, policy);
    return { context, page: await context.newPage() };
  });
}

export async function runDesignReview(
  deps: AuditDependencies,
  input: {
    runId: string;
    organizationId: string;
    projectId: string;
    /** The run's own page, already on the start URL and signed in. */
    page: Page;
    manager: BrowserManager;
    targetUrl: string;
    policy: SafetyPolicy;
    storageState?: unknown;
    live?: LiveStreamer;
  },
): Promise<{ score: number; issues: number } | null> {
  const started = Date.now();
  await setRunStatus(deps.prisma, input.runId, 'DISCOVERING', { currentAction: 'Design review', currentUrl: input.targetUrl }).catch(() => undefined);
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'stage',
    message: 'Design review: taking computer and phone screenshots of the main pages.',
  });

  const origin = new URL(input.targetUrl).origin;
  const start = new URL(input.targetUrl).toString();
  const links = (await mainLinks(input.page, origin)).filter((url) => url !== start && !SKIP.test(url));
  // One page per path: /blog/a and /blog/b look alike, so the second adds little.
  const seenSections = new Set<string>();
  const others = links.filter((url) => {
    const section = new URL(url).pathname.split('/').filter(Boolean)[0] ?? '';
    if (seenSections.has(section)) return false;
    seenSections.add(section);
    return true;
  });
  const urls = [start, ...others].slice(0, MAX_PAGES);

  const desktop = await openContext(input.manager, 'desktop', input.policy, input.storageState);
  const phone = await openContext(input.manager, 'phone', input.policy, input.storageState).catch(() => null);
  await input.live?.attach(desktop.page).catch(() => undefined);
  const pages: ReviewedPage[] = [];
  try {
    for (const url of urls) {
      if (Date.now() - started > BUDGET_MS) break;
      await deps.prisma.run.update({ where: { id: input.runId }, data: { currentUrl: url, currentAction: 'Design review' } }).catch(() => undefined);
      await input.live?.setAction({ kind: 'info', label: `Design review: ${pathOf(url)}` }).catch(() => undefined);
      const onDesktop = await capturePage(desktop.page, url, 'desktop').catch((error) => {
        deps.logger.warn({ runId: input.runId, url, err: error }, 'design review could not capture the desktop page');
        return null;
      });
      if (!onDesktop) continue;
      const onPhone = phone ? await capturePage(phone.page, url, 'phone').catch(() => null) : null;
      pages.push({
        url,
        title: onDesktop.title,
        desktop: onDesktop.capture,
        phone: onPhone?.capture ?? null,
        evidence: { desktop: null, phone: null },
        keys: { desktop: null, phone: null },
      });
    }
  } finally {
    await input.live?.attach(input.page).catch(() => undefined);
    await desktop.context.close().catch(() => undefined);
    await phone?.context.close().catch(() => undefined);
  }

  if (!pages.length) {
    await appendEvent(deps.prisma, {
      organizationId: input.organizationId,
      runId: input.runId,
      kind: 'warning',
      message: 'Design review: no page could be opened, so there is nothing to review.',
    });
    return null;
  }

  // Store the full-page screenshots the report draws its marks on.
  for (const [index, page] of pages.entries()) {
    for (const shot of ['desktop', 'phone'] as const) {
      const capture = shot === 'desktop' ? page.desktop : page.phone;
      if (!capture) continue;
      const key = `runs/${input.runId}/design-${index}-${shot}.jpg`;
      await deps.storage.put({ key, body: capture.full, contentType: 'image/jpeg' });
      const evidence = await deps.prisma.evidence.create({
        data: {
          organizationId: input.organizationId,
          runId: input.runId,
          type: 'SCREENSHOT',
          storageKey: key,
          contentType: 'image/jpeg',
          fileName: `design-${pathOf(page.url).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}-${shot}.jpg`,
          byteLength: capture.full.length,
        },
      });
      page.evidence[shot] = evidence.id;
      page.keys[shot] = key;
    }
  }

  const issues = measuredIssues(pages);
  const measuredTitles = issues.map((issue) => issue.title);

  // The designer's eye: one AI look per page, told what is already known.
  const agent = deps.ai ? new DesignReviewAgent(deps.ai) : null;
  const summaries: string[] = [];
  const strengths: string[] = [];
  let aiModel: string | null = null;
  let aiError: string | null = null;
  let aiUsed = false;
  if (agent?.available()) {
    for (const page of pages) {
      if (Date.now() - started > BUDGET_MS + 3 * 60_000) break;
      await input.live?.setAction({ kind: 'info', label: `Design review: reviewing ${pathOf(page.url)}` }).catch(() => undefined);
      const review = await agent.reviewPage({
        url: page.url,
        title: page.title,
        screenshots: [page.desktop.firstScreen, page.phone?.firstScreen ?? page.desktop.firstScreen, page.desktop.full],
        alreadyReported: issues.map((issue) => issue.title),
        measured: measuredTitles,
      });
      await recordUsage(deps, input, review);
      if (review.error) {
        aiError = review.error;
        deps.logger.warn({ runId: input.runId, url: page.url, error: review.error }, 'design review AI step failed');
        continue;
      }
      aiUsed = true;
      aiModel = review.model;
      if (review.summary) summaries.push(review.summary);
      for (const item of review.strengths) if (!strengths.includes(item)) strengths.push(item);
      for (const item of review.issues) {
        // Site-wide things (a cookie banner, low contrast) are reported once, not per page.
        if (repeatsKnownIssue(item.title, issues.map((issue) => issue.title))) continue;
        issues.push(aiIssue(page, item));
      }
    }
  }

  const findingIds = await saveFindings(deps, input, pages, issues);
  const { score, areas } = scoreDesign(issues);
  const report: DesignReport = {
    version: 1,
    score,
    areas,
    summary: summaries[0] ?? null,
    strengths: strengths.slice(0, 4),
    pages: pages.map((page) => ({ url: page.url, title: page.title, desktop: page.evidence.desktop, phone: page.evidence.phone })),
    marks: Object.fromEntries(issues.map((issue, index) => [findingIds[index]!, issue.marks]).filter(([id]) => Boolean(id))),
    metrics: {
      pagesReviewed: pages.length,
      layoutShift: pages[0]?.desktop.layoutShift ?? null,
      typefaces: typefacesOf(pages),
      fontSizes: Math.max(0, ...pages.map((page) => page.desktop.measure.fontSizes)),
      buttonStyles: Math.max(0, ...pages.map((page) => page.desktop.measure.buttonStyles)),
    },
    ai: { used: aiUsed, model: aiModel, error: aiUsed ? null : aiError },
  };
  await deps.prisma.run.update({
    where: { id: input.runId },
    data: { designScore: score, designReport: report as unknown as Prisma.InputJsonValue },
  });

  const seconds = Math.round((Date.now() - started) / 1000);
  await appendEvent(deps.prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    kind: 'stage',
    message: `Design review: ${score}/100 across ${plural(pages.length, 'page')}, ${plural(issues.length, 'thing')} to improve (${seconds} s).${
      aiUsed ? '' : ' The AI review was not available, so this covers the measured checks only.'
    }`,
  });
  return { score, issues: issues.length };
}

async function saveFindings(
  deps: AuditDependencies,
  input: { runId: string; organizationId: string; projectId: string },
  pages: ReviewedPage[],
  issues: DesignIssue[],
): Promise<Array<string | null>> {
  const previous = await previousSignatures(deps, input);
  const ids: Array<string | null> = [];
  for (const issue of issues) {
    const signature = `${DESIGN_SIGNATURE_PREFIX}${issue.key}`.slice(0, 250);
    try {
      const finding = await deps.prisma.finding.create({
        data: {
          organizationId: input.organizationId,
          runId: input.runId,
          projectId: input.projectId,
          title: issue.title.slice(0, 240),
          description: issue.description,
          severity: issue.severity,
          category: issue.area === 'accessibility' ? 'ACCESSIBILITY' : 'VISUAL',
          confidence: issue.confidence,
          expected: issue.expected ?? null,
          actual: issue.actual ?? null,
          recommendation: issue.recommendation,
          steps: issue.steps as unknown as Prisma.InputJsonValue,
          signature,
          component: `${DESIGN_COMPONENT_PREFIX}${issue.area}`,
          url: issue.url,
          rootCauseHypothesis: DESIGN_AREA_LABELS[issue.area],
          change: previous.has(signature) ? 'RECURRING' : 'NEW',
        },
      });
      ids.push(finding.id);
      // The page screenshot the issue is marked on, so the finding shows it too.
      const mark = issue.marks[0];
      const page = pages.find((item) => item.url === (mark?.url ?? issue.url));
      const shot = mark?.shot ?? 'desktop';
      const key = page?.keys[shot] ?? page?.keys.desktop;
      if (key) {
        await deps.prisma.evidence.create({
          data: {
            organizationId: input.organizationId,
            runId: input.runId,
            findingId: finding.id,
            type: 'SCREENSHOT',
            storageKey: key,
            contentType: 'image/jpeg',
            fileName: `design-${shot}.jpg`,
            // Same file as the page screenshot: counted once.
            byteLength: 0,
          },
        });
      }
    } catch (error) {
      deps.logger.warn({ runId: input.runId, err: error }, 'could not save a design review finding');
      ids.push(null);
    }
  }
  return ids;
}

async function previousSignatures(deps: AuditDependencies, input: { runId: string; projectId: string }): Promise<Set<string>> {
  const previous = await deps.prisma.run.findFirst({
    where: { projectId: input.projectId, status: 'COMPLETED', designReview: true, id: { not: input.runId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!previous) return new Set();
  const rows = await deps.prisma.finding.findMany({
    where: { runId: previous.id, signature: { startsWith: DESIGN_SIGNATURE_PREFIX } },
    select: { signature: true },
  });
  return new Set(rows.map((row) => row.signature).filter((value): value is string => Boolean(value)));
}

async function recordUsage(deps: AuditDependencies, input: { runId: string; organizationId: string }, review: DesignPageReview): Promise<void> {
  if (!review.model || review.model === 'heuristic') return;
  await deps.prisma.aiUsage
    .create({
      data: {
        organizationId: input.organizationId,
        runId: input.runId,
        purpose: 'design_review',
        promptVersion: DESIGN_REVIEW_PROMPT_VERSION,
        model: review.model,
        promptTokens: review.promptTokens,
        completionTokens: review.completionTokens,
        latencyMs: review.latencyMs,
        estimatedCostUsd: review.estimatedCostUsd,
      },
    })
    .catch(() => undefined);
}
