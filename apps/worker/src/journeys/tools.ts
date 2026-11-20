/// <reference lib="dom" />
import { stat } from 'node:fs/promises';
import { deviceContextOptions, installSafetyGuard, isThirdPartyTrackerError } from '@auditor/browser';
import type { Download, Locator, Page } from 'playwright';
import type { JourneyDefinition, SharedState } from './packs.js';
import {
  BROWSER_SAMPLE_SCRIPT,
  chooseSample,
  expectedOutput,
  extensionMatches,
  type SampleFile,
  type SampleKind,
} from './sample-files.js';
import { BlockedError, NotFoundError, pathOf, type JourneyContext } from './toolkit.js';

/**
 * Journeys for sites that are collections of online tools (convert, compress,
 * merge, resize…). A crawl only sees that the pages open; these journeys use
 * the tools the way a visitor does: choose a real file, start the tool, and
 * check that a correct result comes out.
 *
 * They run in read-only audits too. Choosing a file is not a write: tools that
 * work in the browser never send it anywhere, and if a tool does try to upload
 * it, the safety guard blocks the request and the step is reported as blocked
 * (not as a bug).
 */

export interface ToolLink {
  url: string;
  path: string;
  section: string;
}

const NON_TOOL_SECTIONS =
  /^(blog|news|articles?|posts?|compare|vs|about|privacy|terms|legal|research|docs?|help|faq|support|contact|pricing|login|signin|signup|register|account|how-it-works|changelog|tags?|category|categories|authors?|sitemap|search)$/i;

const TOOL_LINKS_SCRIPT = `(() => {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    let url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch { continue; }
    if (url.origin !== location.origin) continue;
    const path = url.pathname.replace(/\\/+$/, '') || '/';
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ url: url.origin + path, path, depth: path.split('/').filter(Boolean).length });
  }
  return out;
})()`;

/** The tool pages linked from the home page and the section pages, in link order. */
async function discoverTools(ctx: JourneyContext, shared: SharedState & { tools?: ToolLink[] }): Promise<ToolLink[]> {
  if (shared.tools) return shared.tools;
  await ctx.goto('/');
  type Link = { url: string; path: string; depth: number };
  const links = (await ctx.page.evaluate(TOOL_LINKS_SCRIPT)) as Link[];
  const sectionOf = (path: string) => path.split('/').filter(Boolean)[0] ?? '';
  const tools = new Map<string, ToolLink>();
  const addTools = (list: Link[]) => {
    for (const link of list) {
      const section = sectionOf(link.path);
      if (link.depth < 2 || NON_TOOL_SECTIONS.test(section)) continue;
      if (!tools.has(link.path)) tools.set(link.path, { url: link.url, path: link.path, section });
    }
  };
  addTools(links);
  // Section index pages (/pdf, /image…) list the rest of the tools.
  const sections = links.filter((link) => link.depth === 1 && !NON_TOOL_SECTIONS.test(sectionOf(link.path))).slice(0, 8);
  for (const section of sections) {
    if (tools.size >= 400) break;
    await ctx.goto(section.url).catch(() => undefined);
    addTools((await ctx.page.evaluate(TOOL_LINKS_SCRIPT).catch(() => [])) as Link[]);
  }
  shared.tools = [...tools.values()];
  return shared.tools;
}

/** Up to `limit` tools, one per section first so every kind of tool is covered. */
function spread(tools: ToolLink[], limit: number, offset = 0): ToolLink[] {
  const bySection = new Map<string, ToolLink[]>();
  for (const tool of tools) {
    const list = bySection.get(tool.section) ?? [];
    list.push(tool);
    bySection.set(tool.section, list);
  }
  const picked: ToolLink[] = [];
  for (let round = 0; picked.length < limit; round += 1) {
    let added = false;
    for (const list of bySection.values()) {
      const tool = list[round + offset];
      if (tool && picked.length < limit) {
        picked.push(tool);
        added = true;
      }
    }
    if (!added) break;
  }
  return picked;
}

interface ToolState {
  ready: boolean;
  loadingText: string | null;
  heading: string;
  fileInputs: Array<{ accept: string; multiple: boolean }>;
  textAreas: number;
}

const TOOL_STATE_SCRIPT = `(() => {
  const main = document.querySelector('main, [role="main"], article') || document.body;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const text = (main.innerText || '');
  const loading = /\\b(loading( the)? tool|loading…|loading\\.\\.\\.|initiali[sz]ing)\\b/i.exec(text);
  const fileInputs = Array.from(main.querySelectorAll('input[type="file"]')).map((el) => ({ accept: el.getAttribute('accept') || '', multiple: el.multiple }));
  const textAreas = Array.from(main.querySelectorAll('textarea')).filter(visible).length;
  const h1 = document.querySelector('h1');
  return {
    ready: !loading && (fileInputs.length > 0 || textAreas > 0),
    loadingText: loading ? loading[0] : null,
    heading: h1 ? (h1.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : '',
    fileInputs,
    textAreas,
  };
})()`;

/** Waits for the tool's controls to appear (many tools load their code after the page). */
async function waitForTool(page: Page, timeoutMs = 15_000): Promise<ToolState> {
  const deadline = Date.now() + timeoutMs;
  let state = (await page.evaluate(TOOL_STATE_SCRIPT)) as ToolState;
  while (!state.ready && Date.now() < deadline) {
    await page.waitForTimeout(500);
    state = (await page.evaluate(TOOL_STATE_SCRIPT).catch(() => state)) as ToolState;
  }
  return state;
}

async function makeFiles(page: Page, kind: SampleKind, count: number): Promise<SampleFile[] | null> {
  let buffer: Buffer | null = null;
  if (kind.make) buffer = kind.make();
  else if (kind.browser) {
    const base64 = (await page.evaluate(`(${BROWSER_SAMPLE_SCRIPT})(${JSON.stringify(kind.browser)})`).catch(() => null)) as string | null;
    buffer = base64 ? Buffer.from(base64, 'base64') : null;
  }
  if (!buffer?.length) return null;
  return Array.from({ length: count }, (_, index) => ({
    name: `snaghunt-sample${count > 1 ? `-${index + 1}` : ''}.${kind.ext}`,
    mimeType: kind.mimeType,
    buffer: buffer!,
  }));
}

const ACTION_SCRIPT = `(slug) => {
  document.querySelectorAll('[data-snaghunt-action]').forEach((el) => el.removeAttribute('data-snaghunt-action'));
  const ACTION = /\\b(convert|compress|merge|combine|split|extract|resize|crop|rotate|flip|process|start|run|generate|create|make|export|encode|decode|trim|cut|join|optimi[sz]e|reduce|remove|clean|protect|unlock|sign|watermark|number|organi[sz]e|repair|transcribe|translate|format|beautify|minify|count|calculate|download|save|apply|go)\\b/i;
  const AVOID = /\\b(choose|select|browse|pick|upload|add (more )?files?|clear|reset|cancel|remove (this |the )?files?|delete|close|back|menu|dark mode|light mode|theme|share|copy link|sign ?in|log ?in)\\b/i;
  const words = slug.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && w !== 'to');
  const scope = document.querySelector('main, [role="main"], article') || document.body;
  let best = null;
  for (const el of scope.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')) {
    if (el.closest('header, nav, footer, [role="navigation"], dialog:not([open])')) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || s.visibility === 'hidden' || s.display === 'none') continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    // A mode switch that is already on ("Convert all text" vs "Style selected words") is not the start button.
    if (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true') continue;
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').replace(/\\s+/g, ' ').trim();
    if (!label || AVOID.test(label) || /^(remove|delete|x|×|✕|↑|↓)$/i.test(label)) continue;
    let score = ACTION.test(label) ? 10 : 0;
    for (const w of words) if (label.toLowerCase().includes(w)) score += 3;
    if (el.type === 'submit') score += 2;
    if (score <= 0) continue;
    if (!best || score > best.score) best = { el, label, score };
  }
  if (!best) return null;
  best.el.setAttribute('data-snaghunt-action', '1');
  return best.label.slice(0, 80);
}`;

/** The button that starts the tool, once it is enabled (it often is only after a file is chosen). */
async function findAction(page: Page, path: string, timeoutMs = 6_000): Promise<{ locator: Locator; label: string } | null> {
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  const deadline = Date.now() + timeoutMs;
  do {
    const label = (await page.evaluate(`(${ACTION_SCRIPT})(${JSON.stringify(slug)})`).catch(() => null)) as string | null;
    if (label) return { locator: page.locator('[data-snaghunt-action="1"]').first(), label };
    await page.waitForTimeout(500);
  } while (Date.now() < deadline);
  return null;
}

interface PageSnapshot {
  links: string[];
  buttons: string[];
  media: string[];
  messages: string[];
  outputs: string[];
  lines: string[];
}

const SNAPSHOT_SCRIPT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const scope = document.querySelector('main, [role="main"], article') || document.body;
  const links = Array.from(scope.querySelectorAll('a[download], a[href^="blob:"], a[href^="data:"]')).filter(visible).map((a, i) => { a.setAttribute('data-snaghunt-result', String(i)); return (a.getAttribute('href') || '') + '|' + (a.getAttribute('download') || ''); });
  const media = Array.from(scope.querySelectorAll('img[src^="blob:"], img[src^="data:"], video[src^="blob:"], audio[src^="blob:"], canvas, iframe[src^="blob:"], object[data^="blob:"]')).filter(visible).map((el) => el.getAttribute('src') || el.getAttribute('data') || ('canvas:' + el.width + 'x' + el.height));
  const ERROR = /\\b(error|failed|fails|problem|unknown operation|went wrong|exception|couldn['’]?t|could not|cannot|can['’]?t|unable|invalid|unsupported|not supported|too (large|big)|corrupt(ed)?|wrong (file|format|type)|only [a-z0-9., ]+ files?)\\b/i;
  const messages = Array.from(scope.querySelectorAll('[role="alert"], [aria-live], .error, .alert, [class*="error" i], [class*="warning" i], [data-state="error"], output, p, small, span, div'))
    .filter((el) => el.children.length <= 3 && visible(el))
    .map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim())
    .filter((t) => t.length > 3 && t.length < 240 && ERROR.test(t));
  const outputs = Array.from(scope.querySelectorAll('textarea, pre, output, [contenteditable="true"]')).filter(visible).map((el) => ((el.value !== undefined ? el.value : el.innerText) || '').trim().slice(0, 400));
  // Result buttons ("Download", "Save PDF") that appear once the tool is done.
  const buttons = Array.from(scope.querySelectorAll('button, [role="button"], a[href]'))
    .filter((el) => visible(el) && !el.disabled && /\\b(download|save)\\b/i.test(el.innerText || el.getAttribute('aria-label') || ''))
    .map((el, i) => { el.setAttribute('data-snaghunt-result-button', String(i)); return (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 60) + '#' + i; });
  const lines = Array.from(new Set((scope.innerText || '').split('\\n').map((t) => t.trim()).filter((t) => t.length > 2 && t.length < 200))).slice(0, 600);
  return { links, buttons, media, messages: Array.from(new Set(messages)).slice(0, 10), outputs, lines };
})()`;

/** A message that says the input was the problem (wrong type, no content to work on). */
const BLAMES_INPUT =
  /\b(unsupported|not supported|invalid|not a valid|corrupt(ed)?|too (large|big|small|short|long)|only [a-z0-9., ]+ files?|wrong (file|format|type)|skipped|no (faces?|text|pages|images?|audio|speech|signature) (found|detected)|could not (read|open|decode)|couldn['’]?t (read|open|decode)|password)\b/i;
/** A message that says the tool itself broke. */
const TOOL_FAULT = /\b(unknown operation|went wrong|exception|internal error|crash(ed)?|not defined|undefined|null)\b/i;

/** Text a tool shows while it is still busy. */
const PROGRESS = /^(working|processing|loading|converting|compressing|merging|preparing|uploading|rendering|encoding|analy[sz]ing|please wait)\b|…$|\.\.\.$|\b\d{1,3}\s?%/i;

/** Words tools use when they finish. */
const SUCCESS = /\b(done|ready|complete(d)?|success(ful(ly)?)?|finished|merged|converted|compressed|created|saved|generated|resized|extracted)\b/i;

type Outcome =
  | { kind: 'download'; name: string; bytes: number }
  | { kind: 'inline'; what: string }
  | { kind: 'message'; text: string }
  | { kind: 'none' };

async function snapshot(page: Page): Promise<PageSnapshot> {
  return ((await page.evaluate(SNAPSHOT_SCRIPT).catch(() => null)) as PageSnapshot | null) ?? { links: [], buttons: [], media: [], messages: [], outputs: [], lines: [] };
}

async function sizeOf(download: Download): Promise<number> {
  const file = await download.path().catch(() => null);
  if (!file) return 0;
  return (await stat(file).catch(() => null))?.size ?? 0;
}

/** Waits for the tool's result: a download, a new download link (followed), or a result on the page. */
async function waitForOutcome(
  page: Page,
  before: PageSnapshot,
  timeoutMs: number,
  inputText?: string,
  /** Page text right before the start button was pressed; only text after it counts as a result. */
  linesBaseline?: string[],
): Promise<Outcome> {
  let downloaded: Download | null = null;
  const onDownload = (download: Download) => {
    downloaded ??= download;
  };
  page.on('download', onDownload);
  const deadline = Date.now() + timeoutMs;
  let inlineSince = 0;
  try {
    while (Date.now() < deadline) {
      if (downloaded) {
        const download = downloaded as Download;
        return { kind: 'download', name: download.suggestedFilename(), bytes: await sizeOf(download) };
      }
      const now = await snapshot(page);
      const newLink = now.links.findIndex((link) => !before.links.includes(link));
      if (newLink !== -1) {
        // The result is ready as a link; follow it like a visitor would.
        const link = page.locator(`[data-snaghunt-result="${newLink}"]`).first();
        const waiting = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
        await link.click({ timeout: 5_000 }).catch(() => undefined);
        const download = (await waiting) ?? downloaded;
        if (download) return { kind: 'download', name: download.suggestedFilename(), bytes: await sizeOf(download) };
        return { kind: 'inline', what: 'a download link to the result' };
      }
      const label = (button: string) => button.replace(/#\d+$/, '');
      const beforeLabels = before.buttons.map(label);
      const newButton = now.buttons.find((button) => !beforeLabels.includes(label(button)));
      if (newButton) {
        // A "Download" button that appeared after the tool ran: press it and catch the file.
        const index = newButton.slice(newButton.lastIndexOf('#') + 1);
        const waiting = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
        await page.locator(`[data-snaghunt-result-button="${index}"]`).first().click({ timeout: 5_000 }).catch(() => undefined);
        const download = (await waiting) ?? downloaded;
        if (download) return { kind: 'download', name: download.suggestedFilename(), bytes: await sizeOf(download) };
        return { kind: 'inline', what: `a "${label(newButton)}" button, which did not start a download` };
      }
      const message = now.messages.find((text) => !before.messages.includes(text));
      if (message) {
        // Report every new message: "see the messages above" points at the one that explains it.
        const all = now.messages.filter((text) => !before.messages.includes(text));
        return { kind: 'message', text: all.slice(0, 4).join(' / ') };
      }
      const baseline = linesBaseline ?? before.lines;
      // Progress text ("Working…", "Converting 40%") means the tool has not finished yet.
      const newLines = now.lines.filter(
        (line) => !baseline.includes(line) && !before.lines.includes(line) && line !== inputText && !PROGRESS.test(line),
      );
      if (now.lines.some((line) => PROGRESS.test(line) && !baseline.includes(line))) inlineSince = 0;
      const success = newLines.find((line) => SUCCESS.test(line));
      if (success || newLines.length) {
        inlineSince ||= Date.now();
        if (Date.now() - inlineSince > 4_000) {
          return { kind: 'inline', what: success ? `"${success.slice(0, 80)}"` : `new result text "${newLines[0]!.slice(0, 60)}"` };
        }
      }
      const newMedia = now.media.filter((src) => !before.media.includes(src));
      const newOutput = now.outputs.find((text) => text && !before.outputs.includes(text) && text !== inputText);
      if (newMedia.length || newOutput) {
        // A preview often appears a moment before the download link; give it a little longer.
        inlineSince ||= Date.now();
        if (Date.now() - inlineSince > 4_000) {
          return { kind: 'inline', what: newOutput ? `output text "${newOutput.slice(0, 60)}"` : `${newMedia.length} result preview(s)` };
        }
      }
      await page.waitForTimeout(500);
    }
    if (inlineSince) return { kind: 'inline', what: 'a result on the page' };
    return { kind: 'none' };
  } finally {
    page.off('download', onDownload);
  }
}

async function hasWebAudio(page: Page): Promise<boolean> {
  return page
    .evaluate(() => 'AudioContext' in window || 'webkitAudioContext' in window)
    .catch(() => true);
}

function watchPageErrors(page: Page): () => string[] {
  const errors: string[] = [];
  const listener = (error: Error) => {
    // Analytics scripts failing (common in Safari) are not the tool's fault.
    if (isThirdPartyTrackerError(error.message)) return;
    errors.push(error.message.split('\n')[0]?.slice(0, 200) ?? 'error');
  };
  page.on('pageerror', listener);
  return () => {
    page.off('pageerror', listener);
    return errors;
  };
}

interface Attempt {
  ready: ToolState;
  used: string;
  actionLabel: string | null;
  outcome: Outcome;
  errors: string[];
  blocked: boolean;
}

/**
 * One go at a tool on `page`: choose the sample, start the tool, wait for the result.
 * Throws NotFoundError when there is nothing Snaghunt can try.
 */
async function attempt(page: Page, tool: ToolLink, open: (url: string) => Promise<void>, blockedCount: () => number): Promise<Attempt> {
  const stopWatching = watchPageErrors(page);
  try {
    await open(tool.url);
    const ready = await waitForTool(page);
    if (!ready.ready) {
      if (ready.loadingText) return { ready, used: '', actionLabel: null, outcome: { kind: 'none' }, errors: stopWatching(), blocked: false };
      throw new NotFoundError(`No file picker or text box on ${tool.path}, so there is nothing to try.`);
    }
    const blockedBefore = blockedCount();
    const before = await snapshot(page);
    let used = '';
    let inputText: string | undefined;
    if (ready.fileInputs.length) {
      const first = ready.fileInputs[0]!;
      const kind = chooseSample(tool.path, first.accept);
      if (!kind) throw new NotFoundError(`Snaghunt has no sample file this tool accepts (${first.accept || 'any file'}).`);
      if (/^(audio|video)\//.test(kind.mimeType) && !(await hasWebAudio(page))) {
        // Playwright's WebKit build for Windows ships without Web Audio; real Safari has it.
        // A failure here would be our test browser's limit, not the site's bug.
        throw new NotFoundError(
          'Not checked in this browser: the Safari test browser on this machine has no Web Audio, which real Safari has. Check audio and video tools in Chrome or on a real iPhone.',
        );
      }
      const wantsSeveral = first.multiple && /merge|combine|join|zip|collage|batch/i.test(tool.path);
      const files = await makeFiles(page, kind, wantsSeveral ? 2 : 1);
      if (!files) throw new NotFoundError(`The audit browser could not make a .${kind.ext} sample for this tool.`);
      await page.locator('main input[type="file"], [role="main"] input[type="file"], article input[type="file"], input[type="file"]').first().setInputFiles(files);
      used = files.map((file) => `${file.name} (${file.buffer.length} bytes)`).join(', ');
    } else {
      inputText = 'Snaghunt sample text.\nSecond line, with numbers 1 2 3.';
      await page.locator('main textarea:visible, textarea:visible').first().fill(inputText);
      used = 'sample text';
    }
    await page.waitForTimeout(800);
    if (inputText !== undefined) {
      // Many text tools convert as you type: the results are already on the page.
      await page.waitForTimeout(1_200);
      const typed = await snapshot(page);
      const live = typed.lines.filter((line) => !before.lines.includes(line) && line !== inputText && !inputText.includes(line));
      if (live.length >= 2) {
        return {
          ready,
          used,
          actionLabel: null,
          outcome: { kind: 'inline', what: `results as you type, e.g. "${live.find((line) => line.length > 8)?.slice(0, 60) ?? live[0]!.slice(0, 60)}"` },
          errors: stopWatching(),
          blocked: blockedCount() > blockedBefore,
        };
      }
    }
    const action = await findAction(page, tool.path);
    // Text that appeared just from choosing the file (its name, "Add more files") is not a result.
    const chosen = action ? await snapshot(page) : null;
    if (action) {
      await action.locator.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
      await action.locator.click({ timeout: 8_000 }).catch(() => undefined);
    }
    const outcome = await waitForOutcome(page, before, action ? 45_000 : 15_000, inputText, chosen?.lines);
    return { ready, used, actionLabel: action?.label ?? null, outcome, errors: stopWatching(), blocked: blockedCount() > blockedBefore };
  } finally {
    stopWatching();
  }
}

/** The tool's failure, if this attempt is one (not a refusal of our sample, not "nothing to try"). */
function failureOf(result: Attempt): string | null {
  if (!result.ready.ready) return result.ready.loadingText ? `still "${result.ready.loadingText}" after 15 s` : null;
  if (result.outcome.kind === 'message') {
    return BLAMES_INPUT.test(result.outcome.text) && !TOOL_FAULT.test(result.outcome.text) ? null : result.outcome.text;
  }
  if (result.outcome.kind === 'none') return result.actionLabel ? `nothing 45 s after "${result.actionLabel}"` : null;
  return null;
}

/**
 * Tries the tool again in a brand-new browser (no service worker, no storage),
 * read-only whatever the run allows, to tell "broken" from "broken after
 * using another tool".
 */
async function attemptInFreshBrowser(ctx: JourneyContext, tool: ToolLink): Promise<Attempt | null> {
  const browser = ctx.page.context().browser();
  if (!browser) return null;
  const context = await browser.newContext(deviceContextOptions({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true }));
  try {
    const guard = await installSafetyGuard(context, {
      mode: 'READ_ONLY',
      allowPrivate: false,
      targetOrigin: new URL(ctx.baseUrl).origin,
      blockedPathPatterns: [],
    });
    const page = await context.newPage();
    return await attempt(
      page,
      tool,
      async (url) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
        await page.waitForTimeout(1_500);
      },
      () => guard.blocked.length,
    );
  } catch {
    return null;
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** How many tools the processing journey uses, spread across the site's sections. */
const TOOLS_TO_USE = 24;

interface ToolSession {
  history: string[];
  /** Everyday names of the tools used so far, by path. */
  names: Record<string, string>;
  /** Tools confirmed to break only after another tool was used. */
  crossTool: number;
}

/** Forgets the site's service worker and caches, as a first visit would have. */
async function resetSiteState(ctx: JourneyContext): Promise<void> {
  const session = await ctx.page.context().newCDPSession(ctx.page).catch(() => null);
  if (!session) return;
  await session
    .send('Storage.clearDataForOrigin', { origin: new URL(ctx.baseUrl).origin, storageTypes: 'service_workers,cache_storage' })
    .catch(() => undefined);
  await session.detach().catch(() => undefined);
}

/** A tool's everyday name: the page heading up to its first dash or colon, else its address in words. */
function toolName(heading: string | undefined, path: string): string {
  const fromHeading = (heading ?? '').split(/\s[–—-]\s|:\s/)[0]?.trim();
  if (fromHeading && fromHeading.length <= 60) return fromHeading;
  const slug = path.split('/').filter(Boolean).pop() ?? path;
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The message that matters, without the file name and size the tool prints next to it. */
function primaryMessage(text: string): string {
  const parts = text.split(' / ').map((part) => part.trim()).filter(Boolean);
  const specific = parts.find((part) => /unknown operation|error|exception|failed|not defined|undefined/i.test(part) && !/see the messages above/i.test(part));
  const chosen = specific ?? parts[0] ?? text;
  return chosen
    .replace(/^.*?\.[a-z0-9]{2,5}\s+[\d.,]+\s?(?:bytes|[KMG]B)\s+/i, '')
    .replace(/^problem:\s*/i, '')
    .trim();
}

/** "snaghunt-sample.wav (32044 bytes), …" → "a sample WAV file". */
function fileInWords(used: string): string {
  if (used === 'sample text') return 'some sample text';
  const ext = /\.([a-z0-9]+)\s/i.exec(used)?.[1]?.toUpperCase();
  const several = used.includes(',');
  return ext ? `${several ? 'two sample' : 'a sample'} ${ext} file${several ? 's' : ''}` : 'a sample file';
}

/** Uses one tool with a real sample file (or sample text) and checks the result. */
async function useTool(ctx: JourneyContext, tool: ToolLink, session: ToolSession): Promise<string> {
  const history = session.crossTool >= 2 ? [] : session.history;
  const result = await attempt(ctx.page, tool, (url) => ctx.goto(url), () => ctx.blockedCount());
  const name = toolName(result.ready.heading, tool.path);
  session.names[tool.path] = name;
  const used = result.used;
  const file = fileInWords(used);
  const label = result.actionLabel;
  const clicked = label ? `; clicked "${label}"` : '';
  const useSteps = [`Open ${name} (${tool.path}).`, `Choose ${file}.`, ...(label ? [`Click "${label}".`] : [])];
  if (result.blocked) {
    throw new BlockedError('This tool sends the file to a server. Read-only audits never upload files; run in Full mode to test it.');
  }
  if (result.errors.length) {
    ctx.check('No script errors while the tool runs', false, 'none', result.errors[0], {
      title: `${name} hits a script error while it runs`,
      summary: `While ${name} was working on ${file}, the page threw a JavaScript error: "${result.errors[0]}". The tool may stop part-way or give a wrong result.`,
      steps: [...useSteps, 'Open the browser console: the error appears there.'],
      expected: 'No errors in the browser console',
      actual: result.errors[0],
      fix: 'Find this error in the tool’s script (the browser console shows the file and line) and handle the case that causes it.',
    });
  }

  const failure = failureOf(result);
  if (failure) {
    const earlier = history.filter((path) => path !== tool.path);
    const fresh = earlier.length ? await attemptInFreshBrowser(ctx, tool) : null;
    const message = primaryMessage(failure);
    if (fresh && fresh.outcome.kind !== 'none' && !failureOf(fresh)) {
      // Works on its own, fails after another tool: state left behind by the earlier tool.
      session.crossTool += 1;
      const previousPath = earlier.at(-1)!;
      const previous = session.names[previousPath] ?? toolName(undefined, previousPath);
      ctx.check(
        'The tool still works after another tool was used',
        false,
        'a result, as in a fresh browser',
        `"${failure}" after using ${earlier.slice(-2).join(' and ')} in the same visit; the same file works in a fresh browser`,
        {
          title: `${name} stops working after you use another tool`,
          summary: `${name} works when it is the first tool you use. But after using ${previous} in the same visit, it fails with “${message}” and gives no result. Anyone who tries more than one tool will run into this.`,
          steps: [
            `Open ${previous} (${previousPath}) and process a file with it.`,
            `In the same tab, go to ${name} (${tool.path}).`,
            `Choose ${file}${label ? ` and click "${label}"` : ''}.`,
            `The page shows “${message}” instead of a result.`,
            'Repeat steps 2–3 in a fresh private window: it works there.',
          ],
          expected: `${name} processes the file, as it does in a fresh window`,
          actual: `“${message}”, and no result`,
          fix: 'Likely cause: the tools share a background worker that keeps the first tool’s code (the site registers a service worker, /sw.js). Make each tool start its own worker, or have the shared worker load the code for the operation it is asked to run instead of answering “Unknown operation”.',
        },
      );
      return `Used ${used}${clicked}. To reproduce: use ${previousPath}, then open ${tool.path} in the same tab and start it.`;
    }
    if (!result.ready.ready) {
      ctx.check('The tool finishes loading', false, 'the tool controls', failure, {
        title: `${name} never finishes loading`,
        summary: `${name} still says “${result.ready.loadingText ?? 'Loading'}” after 15 seconds, so visitors cannot use it.`,
        steps: [`Open ${name} (${tool.path}).`, 'Wait 15 seconds: the tool never appears.'],
        expected: 'The file picker or text box appears within a few seconds',
        actual: failure,
        fix: 'Check the browser console and network panel for a script that fails to load on this page.',
      });
      return `The tool did not finish loading`;
    }
    const silent = result.outcome.kind === 'none';
    ctx.check('The tool runs without an error', false, 'a result', failure, {
      title: silent ? `${name} does nothing after you click "${label}"` : `${name} shows an error instead of a result`,
      summary: silent
        ? `After choosing ${file} and clicking "${label}", nothing happens for 45 seconds: no download, no result and no message.`
        : `Using ${name} with ${file} ends with “${message}” instead of a result${fresh ? ', even in a fresh browser' : ''}.`,
      steps: [...useSteps, silent ? 'Wait 45 seconds: nothing happens.' : `The page shows “${message}”.`],
      expected: 'A finished result to download or view',
      actual: silent ? 'Nothing happens' : `“${message}”`,
      fix: silent
        ? 'Check what the button’s click handler does with this file; the browser console may show why it stops.'
        : 'Search the tool’s code for this message to find where processing gives up.',
    });
    return `Used ${used}${clicked}${fresh ? ' (also fails in a fresh browser)' : ''}`;
  }
  if (result.outcome.kind === 'message') {
    // The tool explained why it would not take this sample. That is handled behaviour, not a bug.
    throw new NotFoundError(`The tool did not accept Snaghunt's ${used}${clicked}: "${result.outcome.text}"`);
  }
  if (result.outcome.kind === 'none') {
    throw new NotFoundError(`Could not find the button that starts ${tool.path}, and nothing happened on its own.`);
  }
  const outcome = result.outcome;
  ctx.check('The tool produces a result', true, 'a download or a result on the page', outcome.kind === 'download' ? outcome.name : outcome.what);
  if (outcome.kind === 'download') {
    ctx.check('The result is not empty', outcome.bytes > 0, '> 0 bytes', `${outcome.bytes} bytes`, {
      title: `${name} downloads an empty file`,
      summary: `${name} finishes and downloads ${outcome.name}, but the file is empty (0 bytes).`,
      steps: [...useSteps, `Open the downloaded ${outcome.name}: it is empty.`],
      expected: 'A file with content',
      actual: `${outcome.name}, 0 bytes`,
      fix: 'Check that the result is fully written before the download link is created.',
    });
    const expected = expectedOutput(tool.path);
    if (expected) {
      ctx.check(`The result is a .${expected} file`, extensionMatches(outcome.name, expected), `.${expected}`, outcome.name, {
        title: `${name} gives the wrong kind of file`,
        summary: `${name} promises a .${expected} file, but the download is ${outcome.name}.`,
        steps: [...useSteps, `Look at the downloaded file name: ${outcome.name}.`],
        expected: `A .${expected} file`,
        actual: outcome.name,
        fix: `Check the file name and type set for the download on this page.`,
      });
    }
    return `Used ${used}${clicked}; got ${outcome.name} (${outcome.bytes} bytes)`;
  }
  return `Used ${used}${clicked}; the page showed ${outcome.what}${session.crossTool >= 2 ? ' (started from a clean slate)' : ''}`;
}

/** Gives a tool a file it does not support and checks it says so instead of failing silently or crashing. */
async function wrongFile(ctx: JourneyContext, tool: ToolLink, accept: string): Promise<string> {
  const page = ctx.page;
  const stopWatching = watchPageErrors(page);
  try {
    const name = toolName((await page.locator('h1').first().innerText({ timeout: 2_000 }).catch(() => '')) || undefined, tool.path);
    const before = await snapshot(page);
    const file: SampleFile = { name: 'snaghunt-not-supported.txt', mimeType: 'text/plain', buffer: Buffer.from('This is a plain text file, not the kind of file this tool takes.\n') };
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await page.waitForTimeout(800);
    const action = await findAction(page, tool.path, 3_000);
    if (action) await action.locator.click({ timeout: 5_000 }).catch(() => undefined);
    const outcome = await waitForOutcome(page, before, 12_000);
    const errors = stopWatching();
    const steps = [`Open ${name} (${tool.path}).`, 'Choose a plain .txt file, which this tool does not take.', ...(action ? [`Click "${action.label}".`] : [])];
    ctx.check('No script error on an unsupported file', errors.length === 0, 'none', errors[0] ?? 'none', {
      title: `${name} crashes on an unsupported file`,
      summary: `Giving ${name} a file type it does not take throws a JavaScript error (“${errors[0] ?? ''}”) instead of a clear message.`,
      steps: [...steps, 'Open the browser console: the error appears there.'],
      expected: 'A message saying the file type is not supported',
      actual: errors[0] ?? '',
      fix: `Check the file type before processing and tell the visitor which types are accepted (${accept}).`,
    });
    if (outcome.kind === 'message') return `Said: "${outcome.text}"`;
    if (!action) return 'The start button stayed disabled for the unsupported file';
    ctx.check(
      'The tool says the file is not supported',
      false,
      `a message (accepts ${accept})`,
      outcome.kind === 'none' ? `nothing after "${action.label}"` : `it produced ${outcome.kind === 'download' ? outcome.name : outcome.what}`,
      {
        title: `${name} gives no message for unsupported files`,
        summary: `When you give ${name} a file it does not take, it ${outcome.kind === 'none' ? 'does nothing and says nothing' : 'still produces something'}, so visitors do not know what went wrong.`,
        steps: [...steps, outcome.kind === 'none' ? 'Nothing happens and no message appears.' : 'A result appears for a file the tool should not take.'],
        expected: `A clear message, such as “This tool takes ${accept} files”`,
        actual: outcome.kind === 'none' ? 'No message' : 'A result for an unsupported file',
        fix: `Check the file type when a file is chosen and show which types are accepted (${accept}).`,
      },
    );
    return `Clicked "${action.label}" with a .txt file`;
  } finally {
    stopWatching();
  }
}

type ToolShared = SharedState & { tools?: ToolLink[] };

export const toolJourneys: JourneyDefinition[] = [
  {
    id: 'tool_pages_load',
    name: 'Tool pages load and are ready to use',
    category: 'tools',
    requires: 'readonly',
    timeoutMs: 240_000,
    run: async (ctx, shared) => {
      let tools: ToolLink[] = [];
      await ctx.step('Find the tools', async () => {
        tools = await discoverTools(ctx, shared as ToolShared);
        if (!tools.length) throw new NotFoundError('No tool pages linked from the home page or its sections.');
        const sections = [...new Set(tools.map((tool) => tool.section))];
        return `${tools.length} tool pages in ${sections.length} sections (${sections.slice(0, 8).join(', ')})`;
      });
      for (const tool of spread(tools, 10)) {
        await ctx.step(`Open ${tool.path}`, async () => {
          const stopWatching = watchPageErrors(ctx.page);
          await ctx.goto(tool.url);
          const state = await waitForTool(ctx.page);
          const errors = stopWatching();
          ctx.check('The page has a heading', Boolean(state.heading), 'an h1', state.heading || 'none');
          ctx.check(
            'The tool finishes loading',
            state.ready || (!state.loadingText && state.fileInputs.length + state.textAreas === 0),
            'the tool controls',
            state.loadingText ? `still "${state.loadingText}" after 15 s` : state.ready ? 'ready' : 'no tool controls',
          );
          ctx.check('No script errors on load', errors.length === 0, 'none', errors[0] ?? 'none');
          return `${state.heading || pathOf(tool.url)}: ${state.fileInputs.length} file picker(s), ${state.textAreas} text box(es)`;
        });
      }
    },
  },
  {
    id: 'tool_processes_file',
    name: 'Tools process a sample file',
    category: 'tools',
    requires: 'readonly',
    timeoutMs: 14 * 60_000,
    run: async (ctx, shared) => {
      const tools = await discoverTools(ctx, shared as ToolShared).catch(() => [] as ToolLink[]);
      if (!tools.length) {
        await ctx.step('Find the tools', async () => {
          throw new NotFoundError('No tool pages linked from the home page or its sections.');
        });
        return;
      }
      // Tools used so far in this visit, to spot tools that break after another one was used.
      const session: ToolSession = { history: [], names: {}, crossTool: 0 };
      for (const tool of spread(tools, TOOLS_TO_USE)) {
        if (session.crossTool >= 2) {
          // The cross-tool bug is confirmed; start each remaining tool from a clean slate so
          // its own result is tested (and not the same bug again and again).
          await resetSiteState(ctx);
        }
        await ctx.step(`Use ${tool.path}`, () => useTool(ctx, tool, session));
        session.history.push(tool.path);
      }
    },
  },
  {
    id: 'tool_rejects_wrong_file',
    name: 'Tools explain unsupported files',
    category: 'tools',
    requires: 'readonly',
    timeoutMs: 150_000,
    run: async (ctx, shared) => {
      const tools = await discoverTools(ctx, shared as ToolShared).catch(() => [] as ToolLink[]);
      let tried = 0;
      for (const tool of spread(tools, 12, 1)) {
        if (tried >= 2) break;
        await ctx.goto(tool.url).catch(() => undefined);
        const state = await waitForTool(ctx.page).catch(() => null);
        const accept = state?.fileInputs[0]?.accept ?? '';
        // Only tools that limit their file types, and do not take plain text.
        if (!accept || /text\/|\.txt|\*\/\*/i.test(accept)) continue;
        tried += 1;
        await ctx.step(`Give ${tool.path} a .txt file`, () => wrongFile(ctx, tool, accept));
      }
      if (!tried) {
        await ctx.step('Find a tool that limits its file types', async () => {
          throw new NotFoundError('None of the sampled tools limit which files they take.');
        });
      }
    },
  },
];
