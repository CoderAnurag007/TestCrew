/**
 * Self-contained HTML audit report: one file, no external requests, screenshots
 * embedded as data URIs, readable on screen and in print. It contains text that
 * came from the audited site (titles, URLs, error messages), so every value is
 * HTML-escaped and the page needs no JavaScript (images open with :target).
 */
export interface HtmlReportFinding {
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: string;
  change?: string | null;
  description: string;
  expected?: string | null;
  actual?: string | null;
  recommendation?: string | null;
  url?: string | null;
  confidence?: number | null;
  steps?: string[];
  images?: string[];
}

export interface HtmlReportInput {
  generatedAt: Date;
  project: { name: string; baseUrl: string };
  run: {
    id: string;
    startedAt?: Date | null;
    completedAt?: Date | null;
    durationMs?: number | null;
    mode: string;
    requestedMode?: string | null;
    trigger?: string | null;
  };
  score: number;
  scoreFormula?: string;
  density?: number;
  screensExplored: number;
  summary: string;
  diff?: {
    previousRunId: string | null;
    counts: { new: number; recurring: number; regressed: number; fixed: number };
    fixed: Array<{ title: string; severity: string }>;
  } | null;
  findings: HtmlReportFinding[];
  hiddenCount?: number;
  screens: Array<{ title: string; url: string; image?: string | null }>;
  tests: Array<{ name: string; source: string; status: string; failureClass?: string | null; error?: string | null; durationMs?: number | null }>;
  intents?: Array<{ text: string; status: string; result?: string | null; reason?: string | null }>;
  safety?: { blockedCount: number; sample: Array<{ method: string; url: string; reason: string }> } | null;
  links?: { checked: number; broken: number; skippedUnsafe: number } | null;
  aiCostUsd?: number;
  model?: string | null;
  context?: {
    category: string;
    detectedCategory?: string;
    environmentKind: string;
    transactionsReason: string;
    paymentReason: string;
  } | null;
  journeys?: Array<{
    name: string;
    category: string;
    requires: string;
    status: string;
    reason?: string;
    steps: Array<{ goal: string; status: string; detail: string; image?: string | null; checks?: Array<{ name: string; passed: boolean; expected?: string; actual?: string }> }>;
  }>;
  interactions?: {
    probed: number;
    totals: Record<string, number>;
    truncated: boolean;
    screens: Array<{ url: string; title: string; controls: Array<{ label: string; outcome: string; detail: string }> }>;
  } | null;
}

const OUTCOME_LABEL: Record<string, string> = {
  navigates: 'Opens a page',
  opens_overlay: 'Opens a popup',
  changes_content: 'Changes content',
  expands: 'Expands',
  opens_window: 'New window',
  downloads: 'Download',
  submits: 'Submits',
  blocked_by_safety: 'Needs Full mode',
  no_effect: 'No effect',
  error: 'Error',
  skipped: 'Skipped',
};

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#c42b1c',
  HIGH: '#c42b1c',
  MEDIUM: '#a85a00',
  LOW: '#5e636b',
  INFO: '#5e636b',
};

export function renderHtmlReport(input: HtmlReportInput): string {
  const counts = Object.fromEntries(SEVERITY_ORDER.map((sev) => [sev, input.findings.filter((f) => f.severity === sev).length]));
  const host = safeHost(input.project.baseUrl);
  const scoreColor = input.score >= 85 ? '#127a3e' : input.score >= 60 ? '#a85a00' : '#c42b1c';
  const passed = input.tests.filter((t) => t.status === 'PASSED').length;
  const failed = input.tests.filter((t) => t.status === 'FAILED' || t.status === 'ERROR').length;
  let imageId = 0;
  const lightboxes: string[] = [];
  const thumb = (src: string, alt: string) => {
    imageId += 1;
    const id = `img-${imageId}`;
    lightboxes.push(`<a class="lightbox" id="${id}" href="#close" aria-label="Close image"><img src="${attr(src)}" alt="${attr(alt)}"></a>`);
    return `<a class="thumb" href="#${id}"><img src="${attr(src)}" alt="${attr(alt)}" loading="lazy"></a>`;
  };

  const findingsHtml = SEVERITY_ORDER.flatMap((sev) =>
    input.findings
      .filter((f) => f.severity === sev)
      .map((f, index) => {
        const change = f.change && f.change !== 'RECURRING' ? `<span class="pill change-${esc(f.change.toLowerCase())}">${esc(f.change)}</span>` : f.change ? `<span class="pill muted">Recurring</span>` : '';
        const rows = [
          f.expected ? `<div class="kv"><span>Expected</span><p>${esc(f.expected)}</p></div>` : '',
          f.actual ? `<div class="kv"><span>Actual</span><p>${esc(f.actual)}</p></div>` : '',
          f.recommendation ? `<div class="kv"><span>Fix</span><p>${esc(f.recommendation)}</p></div>` : '',
        ].join('');
        const steps = f.steps && f.steps.length
          ? `<details><summary>Steps to reproduce (${f.steps.length})</summary><ol>${f.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol></details>`
          : '';
        const images = f.images && f.images.length ? `<div class="thumbs">${f.images.map((src, i) => thumb(src, `${f.title} screenshot ${i + 1}`)).join('')}</div>` : '';
        return `<article class="finding" id="finding-${esc(sev.toLowerCase())}-${index}">
  <header>
    <span class="sev" style="--sev:${SEVERITY_COLOR[sev]}">${esc(sev.charAt(0) + sev.slice(1).toLowerCase())}</span>
    <span class="pill">${esc(titleCase(f.category))}</span>
    ${change}
    ${typeof f.confidence === 'number' ? `<span class="conf">${Math.round(f.confidence * 100)}% confidence</span>` : ''}
  </header>
  <h3>${esc(f.title)}</h3>
  ${f.url ? `<p class="url">${esc(f.url)}</p>` : ''}
  <p>${esc(f.description)}</p>
  ${rows ? `<div class="kvs">${rows}</div>` : ''}
  ${steps}
  ${images}
</article>`;
      }),
  ).join('\n');

  const diff = input.diff;
  const diffHtml = diff?.previousRunId
    ? `<div class="stats four">
        ${stat('New', diff.counts.new, diff.counts.new ? '#c42b1c' : undefined)}
        ${stat('Regressed', diff.counts.regressed, diff.counts.regressed ? '#c42b1c' : undefined)}
        ${stat('Fixed', diff.counts.fixed, diff.counts.fixed ? '#127a3e' : undefined)}
        ${stat('Still open', diff.counts.recurring)}
      </div>
      ${diff.fixed.length ? `<p class="muted small">Fixed since the previous run: ${diff.fixed.slice(0, 12).map((item) => esc(item.title)).join(' · ')}</p>` : ''}`
    : `<p class="muted">This is the first completed audit of this project, so there is nothing to compare against yet. The next run will show what is new, fixed and regressed.</p>`;

  const testsHtml = input.tests.length
    ? `<div class="table-wrap"><table><thead><tr><th>Test</th><th>Source</th><th>Result</th><th>Why</th></tr></thead><tbody>${input.tests
        .map(
          (t) => `<tr><td>${esc(t.name)}</td><td>${esc(sourceLabel(t.source))}</td><td><span class="status s-${esc(t.status.toLowerCase())}">${esc(statusLabel(t.status, t.failureClass))}</span></td><td class="small">${esc(firstLine(t.error))}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<p class="muted">No tests ran.</p>';

  const screensHtml = input.screens.length
    ? `<div class="gallery">${input.screens
        .map(
          (screen) => `<figure>${screen.image ? thumb(screen.image, screen.title) : '<div class="noimg">No screenshot</div>'}<figcaption><strong>${esc(screen.title)}</strong><span>${esc(pathOf(screen.url))}</span></figcaption></figure>`,
        )
        .join('')}</div>`
    : '<p class="muted">No screens were captured.</p>';

  const journeysHtml = input.journeys && input.journeys.length
    ? `<section id="journeys"><h2>Journeys</h2>${
        input.context
          ? `<p class="muted small">App type: ${esc(input.context.category)}${input.context.detectedCategory && input.context.detectedCategory !== input.context.category ? ` (detected ${esc(input.context.detectedCategory)})` : ''} · ${esc(input.context.environmentKind === 'STAGING' ? 'Staging' : 'Production')} · ${esc(input.context.transactionsReason)} ${esc(input.context.paymentReason)}</p>`
          : ''
      }${input.journeys
        .map(
          (journey) => `<article class="finding"><header><span class="status s-${esc(journeyStatusClass(journey.status))}">${esc(titleCase(journey.status))}</span><span class="pill">${esc(requiresLabel(journey.requires))}</span><span class="pill muted">${esc(journey.category)}</span></header><h3>${esc(journey.name)}</h3>${journey.reason ? `<p class="muted small">${esc(journey.reason)}</p>` : ''}<ol class="steps">${journey.steps
            .map(
              (step) => `<li><span class="status s-${esc(journeyStatusClass(step.status))}">${esc(titleCase(step.status))}</span> ${esc(step.goal)}${step.detail ? `<div class="muted small">${esc(step.detail)}</div>` : ''}${
                step.checks && step.checks.length
                  ? `<ul class="checks">${step.checks
                      .map((check) => `<li class="${check.passed ? 'ok' : 'bad'}">${check.passed ? '✓' : '✗'} ${esc(check.name)}${!check.passed && (check.expected || check.actual) ? ` — expected ${esc(check.expected ?? '')}, got ${esc(check.actual ?? '')}` : ''}</li>`)
                      .join('')}</ul>`
                  : ''
              }${step.image ? `<div class="thumbs">${thumb(step.image, step.goal)}</div>` : ''}</li>`,
            )
            .join('')}</ol></article>`,
        )
        .join('')}</section>`
    : '';

  const interactionsHtml = input.interactions && input.interactions.screens.length
    ? `<section id="interactions"><h2>What each control does</h2><p class="muted small">${input.interactions.probed} controls were clicked one by one on fresh pages${input.interactions.truncated ? ' (time budget reached; not every control was tried)' : ''}.</p><div class="stats">${Object.entries(input.interactions.totals)
        .filter(([, value]) => value > 0)
        .map(([key, value]) => stat(OUTCOME_LABEL[key] ?? key, value, key === 'error' ? '#c42b1c' : key === 'no_effect' ? '#a85a00' : undefined))
        .join('')}</div>${input.interactions.screens
        .filter((screen) => screen.controls.length)
        .map(
          (screen) => `<details><summary>${esc(screen.title || pathOf(screen.url))} <span class="muted small">${esc(pathOf(screen.url))} · ${screen.controls.length} controls</span></summary><div class="table-wrap"><table><thead><tr><th>Control</th><th>Result</th><th>Detail</th></tr></thead><tbody>${screen.controls
            .map((control) => `<tr><td>${esc(control.label)}</td><td><span class="status s-${control.outcome === 'error' ? 'failed' : control.outcome === 'no_effect' ? 'flaky' : control.outcome === 'skipped' ? 'skipped' : 'passed'}">${esc(OUTCOME_LABEL[control.outcome] ?? control.outcome)}</span></td><td class="small">${esc(control.detail)}</td></tr>`)
            .join('')}</tbody></table></div></details>`,
        )
        .join('')}</section>`
    : '';

  const intentsHtml = input.intents && input.intents.length
    ? `<section id="intents"><h2>Your expectations</h2><ul class="intents">${input.intents
        .map(
          (i) => `<li><span class="status s-${esc((i.result ?? i.status).toLowerCase())}">${esc(i.result ? statusLabel(i.result) : i.status === 'compiled' ? 'Compiled' : 'Not tested')}</span><div><p>${esc(i.text)}</p>${i.reason ? `<p class="muted small">${esc(i.reason)}</p>` : ''}</div></li>`,
        )
        .join('')}</ul></section>`
    : '';

  const safetyHtml = input.safety
    ? `<p>${input.run.mode === 'READ_ONLY' ? 'Read-only: the audit browsed the site and did not submit forms or change data.' : 'Full: the audit was allowed to submit forms on a verified domain. Payment providers and blocked paths were always blocked.'}${
        input.run.requestedMode === 'FULL' && input.run.mode === 'READ_ONLY' ? ' Full mode was requested but the domain is not verified, so this run was read-only.' : ''
      } ${input.safety.blockedCount} request${input.safety.blockedCount === 1 ? ' was' : 's were'} blocked.</p>${
        input.safety.sample.length
          ? `<details><summary>Blocked requests</summary><ul class="small mono">${input.safety.sample
              .slice(0, 15)
              .map((b) => `<li>${esc(b.method)} ${esc(b.url)} — ${esc(b.reason)}</li>`)
              .join('')}</ul></details>`
          : ''
      }`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit report · ${esc(host)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">Snaghunt audit report</p>
      <h1>${esc(input.project.name)}</h1>
      <p class="target">${esc(input.project.baseUrl)}</p>
      <div class="meta">
        <span>${esc(formatDate(input.run.completedAt ?? input.generatedAt))}</span>
        ${input.run.durationMs ? `<span>${esc(formatDuration(input.run.durationMs))}</span>` : ''}
        <span>${esc(input.run.mode === 'READ_ONLY' ? 'Read-only' : 'Full')} mode</span>
        <span>${input.screensExplored} screens</span>
        ${input.model ? `<span>AI: ${esc(input.model)}</span>` : ''}
      </div>
    </div>
    <div class="ring" style="--score:${clamp(input.score)};--ring:${scoreColor}" role="img" aria-label="Health score ${input.score} out of 100">
      <div><strong>${Math.round(input.score)}</strong><span>Health</span></div>
    </div>
  </div>
</header>
<nav class="toc wrap">
  <a href="#summary">Summary</a><a href="#changes">Changes</a><a href="#findings">Findings (${input.findings.length})</a><a href="#screens">Screens</a><a href="#tests">Tests</a>${input.journeys?.length ? '<a href="#journeys">Journeys</a>' : ''}${input.interactions ? '<a href="#interactions">Controls</a>' : ''}${input.intents?.length ? '<a href="#intents">Expectations</a>' : ''}<a href="#method">Method</a>
</nav>
<main class="wrap">
<section id="summary">
  <h2>Summary</h2>
  <p class="lead">${esc(input.summary)}</p>
  <div class="stats">
    ${SEVERITY_ORDER.slice(0, 4).map((sev) => stat(titleCase(sev), counts[sev] ?? 0, (counts[sev] ?? 0) > 0 ? SEVERITY_COLOR[sev] : undefined)).join('')}
    ${stat('Tests passed', `${passed}/${input.tests.length}`)}
    ${stat('Tests failed', failed, failed ? '#c42b1c' : undefined)}
  </div>
</section>
<section id="changes"><h2>Since the last run</h2>${diffHtml}</section>
<section id="findings">
  <h2>Findings</h2>
  ${input.findings.length ? findingsHtml : '<p class="empty">No issues were found on the screens that were explored.</p>'}
  ${input.hiddenCount ? `<p class="muted small">${input.hiddenCount} finding${input.hiddenCount === 1 ? ' is' : 's are'} hidden because they were marked “not a bug”.</p>` : ''}
</section>
<section id="screens"><h2>Screens explored</h2>${screensHtml}</section>
<section id="tests"><h2>Tests</h2>${testsHtml}</section>
${journeysHtml}
${interactionsHtml}
${intentsHtml}
<section id="method">
  <h2>How this audit was run</h2>
  ${safetyHtml}
  ${input.links ? `<p>${input.links.checked} same-site links were checked; ${input.links.broken} were broken. ${input.links.skippedUnsafe} links that could change state (logout, delete, cart) were not followed.</p>` : ''}
  <p>Health score: ${esc(input.scoreFormula ?? '')}${typeof input.density === 'number' ? ` Weighted defects per screen: ${input.density}.` : ''}</p>
  <p class="muted small">Run ${esc(input.run.id)} · generated ${esc(input.generatedAt.toISOString())}${typeof input.aiCostUsd === 'number' ? ` · AI cost $${input.aiCostUsd.toFixed(4)}` : ''}</p>
</section>
</main>
${lightboxes.join('\n')}
</body>
</html>
`;
}

function stat(label: string, value: string | number, color?: string): string {
  return `<div class="stat"><strong${color ? ` style="color:${color}"` : ''}>${esc(String(value))}</strong><span>${esc(label)}</span></div>`;
}

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function attr(value: string): string {
  // Only embedded images are allowed as sources.
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function journeyStatusClass(status: string): string {
  return ({ passed: 'passed', failed: 'failed', partial: 'flaky', blocked: 'skipped', skipped: 'skipped' } as Record<string, string>)[status] ?? 'skipped';
}

function requiresLabel(requires: string): string {
  return ({ readonly: 'Read-only', full: 'Full mode', transaction: 'Staging order', payment: 'Staging + sandbox payment' } as Record<string, string>)[requires] ?? requires;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function sourceLabel(source: string): string {
  return ({ intent: 'Your expectation', consistency: 'Consistency check', ai: 'AI generated', generated: 'Generated' } as Record<string, string>)[source] ?? source;
}

function statusLabel(status: string, failureClass?: string | null): string {
  if (failureClass === 'FLAKY') return 'Passed (flaky)';
  if (status === 'FAILED' || status === 'ERROR') {
    if (failureClass === 'TEST_BUG') return 'Test needs repair';
    if (failureClass === 'ENVIRONMENT') return 'Environment issue';
    return 'Failed';
  }
  return ({ PASSED: 'Passed', SKIPPED: 'Skipped', FLAKY: 'Flaky' } as Record<string, string>)[status] ?? titleCase(status);
}

function firstLine(value?: string | null): string {
  return (value ?? '').split('\n')[0]?.slice(0, 180) ?? '';
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return minutes ? `${minutes} min ${seconds} s` : `${seconds} s`;
}

const CSS = `
:root{--bg:#fff;--well:#f4f5f6;--ink:#0a0a0b;--muted:#5e636b;--line:#e2e4e8;--cobalt:#2445d6;--pass:#127a3e;--warn:#a85a00;--fail:#c42b1c}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:14.5px/1.6 "IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--cobalt)}
.wrap{max-width:1040px;margin:0 auto;padding:0 24px}
.hero{background:#fff;border-bottom:1px solid var(--line)}
.hero-grid{display:flex;justify-content:space-between;align-items:center;gap:32px;padding:40px 24px 32px}
.eyebrow{margin:0 0 4px;font-size:13px;color:var(--muted)}
h1{margin:0;font-size:30px;line-height:1.15;letter-spacing:-.02em;font-weight:600}
.target{margin:6px 0 14px;color:var(--muted);word-break:break-all;font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:6px 16px}
.meta span{font-size:13px;color:var(--muted)}
.ring{flex:none;width:136px;height:136px;border-radius:50%;background:conic-gradient(var(--ring) calc(var(--score)*1%),#eceef1 0);display:grid;place-items:center}
.ring>div{width:124px;height:124px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring strong{font-size:38px;line-height:1;letter-spacing:-.02em;font-weight:600;font-variant-numeric:tabular-nums}
.ring span{font-size:12px;color:var(--muted);margin-top:4px}
.toc{display:flex;flex-wrap:wrap;gap:4px 18px;padding:12px 0;position:sticky;top:0;background:#fff;border-bottom:1px solid var(--line);z-index:5}
.toc a{font-size:13px;color:var(--muted);text-decoration:none;padding:4px 0}
.toc a:hover{color:var(--ink)}
section{background:#fff;padding:32px 0;margin:0;border-bottom:1px solid var(--line)}
h2{margin:0 0 14px;font-size:19px;letter-spacing:-.01em;font-weight:600}
h3{margin:8px 0 2px;font-size:16px;font-weight:600}
.lead{font-size:15.5px;color:#3d4148;margin-top:0;max-width:72ch}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;margin-top:8px;background:var(--line);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.stats.four{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.stat{padding:14px 16px;background:#fff}
.stat strong{display:block;font-size:24px;letter-spacing:-.01em;font-weight:600;font-variant-numeric:tabular-nums}
.stat span{font-size:12.5px;color:var(--muted)}
.finding{border-top:1px solid var(--line);padding:20px 0;margin:0}
.finding:first-of-type{border-top:0}
.finding header{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.sev{font-size:12px;font-weight:600;color:var(--sev);background:color-mix(in srgb,var(--sev) 8%,#fff);border:1px solid color-mix(in srgb,var(--sev) 28%,#fff);padding:1px 6px;border-radius:4px}
.pill{font-size:12px;padding:1px 6px;border-radius:4px;background:var(--well);color:#3d4148}
.pill.muted{color:var(--muted)}
.change-new{background:#f0f3fd;color:var(--cobalt)}
.change-regressed{background:#fdf1ef;color:var(--fail)}
.conf{font-size:12px;color:var(--muted);margin-left:auto}
.url{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;color:var(--muted);margin:0 0 6px;word-break:break-all}
.kvs{display:grid;gap:0;margin:12px 0;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.kv{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:10px 12px;border-top:1px solid var(--line)}
.kv:first-child{border-top:0}
.kv span{font-size:13px;color:var(--muted);padding-top:1px}
.kv p{margin:0;white-space:pre-wrap;word-break:break-word}
details{margin:10px 0}
summary{cursor:pointer;color:var(--cobalt);font-weight:500;font-size:14px}
ol{margin:8px 0 0 18px;padding:0}
.thumbs{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.thumb img{display:block;width:220px;height:124px;object-fit:cover;object-position:top;border-radius:6px;border:1px solid var(--line)}
.thumb:hover img{border-color:#b9bdc4}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
figure{margin:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}
figure .thumb img{width:100%;height:150px;border:0;border-radius:0;border-bottom:1px solid var(--line)}
figcaption{padding:10px 12px;display:flex;flex-direction:column;gap:2px}
figcaption strong{font-size:13.5px;font-weight:600}
figcaption span{font-size:12px;color:var(--muted);word-break:break-all}
.noimg{height:150px;display:grid;place-items:center;color:var(--muted);background:var(--well);font-size:13px}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:8px}
table{width:100%;min-width:560px;border-collapse:collapse;font-size:14px}
th{text-align:left;font-size:13px;color:var(--muted);font-weight:500;background:var(--well);border-bottom:1px solid var(--line);padding:8px 12px}
td{border-bottom:1px solid var(--line);padding:10px 12px;vertical-align:top}
tr:last-child td{border-bottom:0}
.status{display:inline-block;font-size:12px;font-weight:500;padding:1px 6px;border-radius:4px;white-space:nowrap;background:var(--well);color:#3d4148}
.s-passed{background:#eef8f1;color:var(--pass)}
.s-failed,.s-error{background:#fdf1ef;color:var(--fail)}
.s-skipped,.s-not_compiled,.s-rejected{background:var(--well);color:var(--muted)}
.s-flaky{background:#fdf6ec;color:var(--warn)}
.intents{list-style:none;padding:0;margin:0;display:grid;gap:0;border:1px solid var(--line);border-radius:8px}
.steps{margin:10px 0 0 18px;padding:0;display:grid;gap:10px}
.steps .status{margin-right:6px}
.checks{list-style:none;margin:6px 0 0;padding:0;font-size:13px}
.checks .ok{color:var(--pass)}
.checks .bad{color:var(--fail)}
.intents li{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-top:1px solid var(--line)}
.intents li:first-child{border-top:0}
.intents p{margin:0}
.muted{color:var(--muted)}
.small{font-size:13px}
.mono{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.empty{padding:18px;color:var(--pass);background:#eef8f1;border:1px solid #bfe3cc;border-radius:8px}
.lightbox{display:none;position:fixed;inset:0;background:rgba(10,10,11,.86);z-index:50;align-items:center;justify-content:center;padding:32px;cursor:zoom-out}
.lightbox:target{display:flex}
.lightbox img{max-width:100%;max-height:100%;border-radius:6px}
@media (max-width:720px){.hero-grid{flex-direction:column;align-items:flex-start}.kv{grid-template-columns:1fr}}
@media print{.toc,.lightbox{display:none!important}section,.finding{break-inside:avoid}}
`;
