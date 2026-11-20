'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, FileText, ImageIcon } from 'lucide-react';
import type { FindingSeverity } from '@auditor/shared';
import type { RunDetail } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/premium';
import { cn } from '@/lib/utils';
import { EvidenceGallery, EvidenceLink, EvidenceThumb } from './evidence';
import { SeverityBadge } from './findings-list';
import { OutcomeBadge } from './interactions-view';
import { asRecord, isImageEvidence, SEVERITY_ORDER, type RunFinding } from './run-utils';

/*
 * Evidence, organised page by page.
 *
 * Every artifact the audit stored is traced back to the page it came from:
 *   - page screenshots match a crawled page or screen state by storage key,
 *   - findings carry their URL and attached evidence,
 *   - tests are placed on the page of their first navigate step, with the
 *     before/after/failure screenshots and console/network logs of their runs,
 *   - journey steps record their URL and screenshot,
 *   - controls come from the interaction map, listed per screen.
 * Anything that cannot be traced lands under "Other evidence".
 */

type EvidenceItem = {
  id: string;
  type: string;
  contentType: string;
  fileName?: string | null;
  storageKey?: string;
  findingId?: string | null;
  testRunId?: string | null;
};

type TestEntry = {
  id: string;
  name: string;
  status: string;
  errorMessage: string | null;
  screenshots: EvidenceItem[];
  files: EvidenceItem[];
};

type JourneyStep = {
  key: string;
  journey: string;
  goal: string;
  status: string;
  detail: string | null;
  checks: Array<{ name: string; passed: boolean; expected?: string; actual?: string }>;
  evidenceId: string | null;
};

type ControlEntry = { label: string; kind: string; outcome: string; detail: string | null };

type PageDossier = {
  key: string;
  url: string;
  path: string;
  title: string | null;
  screenshot: EvidenceItem | null;
  findings: RunFinding[];
  tests: TestEntry[];
  journeySteps: JourneyStep[];
  controls: ControlEntry[];
};

const PROBLEM_OUTCOMES = new Set(['no_effect', 'error']);

function pageKey(raw: string | null | undefined): { key: string; url: string; path: string } | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : '/';
    return {
      key: `${parsed.host.toLowerCase()}${pathname}`,
      url: `${parsed.origin}${pathname}`,
      path: pathname + (parsed.search ? parsed.search : ''),
    };
  } catch {
    return null;
  }
}

function firstNavigateUrl(steps: unknown): string | null {
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    const record = asRecord(step);
    if (record.type === 'navigate') {
      const target = record.href ?? record.value ?? record.url;
      if (typeof target === 'string') return target;
    }
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function severityRank(severity: FindingSeverity): number {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

function buildDossiers(run: RunDetail, payload: Record<string, unknown>) {
  const evidence = (run.evidence ?? []) as EvidenceItem[];
  const byStorageKey = new Map<string, EvidenceItem>();
  const byId = new Map<string, EvidenceItem>();
  for (const item of evidence) {
    if (item.storageKey) byStorageKey.set(item.storageKey, item);
    byId.set(item.id, item);
  }
  const used = new Set<string>();
  const pages = new Map<string, PageDossier>();

  const ensure = (raw: string | null | undefined, title?: string | null): PageDossier | null => {
    const located = pageKey(raw);
    if (!located) return null;
    let page = pages.get(located.key);
    if (!page) {
      page = {
        ...located,
        title: title ?? null,
        screenshot: null,
        findings: [],
        tests: [],
        journeySteps: [],
        controls: [],
      };
      pages.set(located.key, page);
    } else if (!page.title && title) {
      page.title = title;
    }
    return page;
  };

  // Pages and screen states, with their screenshots.
  const located = [
    ...((run.pages ?? []) as Array<{ url: string; title: string | null; screenshotKey?: string | null }>),
    ...((run.states ?? []) as Array<{ url?: string | null; title?: string | null; screenshotKey?: string | null }>),
  ];
  for (const item of located) {
    const page = ensure(item.url, item.title ?? null);
    if (!page) continue;
    const shot = item.screenshotKey ? byStorageKey.get(item.screenshotKey) : undefined;
    if (shot) {
      used.add(shot.id);
      page.screenshot ??= shot;
    }
  }

  // Findings and the evidence attached to them.
  for (const finding of run.findings ?? []) {
    if (finding.suppressed) continue;
    const page = ensure(finding.url ?? null) ?? ensure(run.project.baseUrl);
    page?.findings.push(finding);
    for (const item of finding.evidence ?? []) used.add(item.id);
  }

  // Tests, placed on the page they open first.
  const testRunsByCase = new Map<string, NonNullable<RunDetail['testRuns']>>();
  for (const testRun of run.testRuns ?? []) {
    const list = testRunsByCase.get(testRun.testCaseId) ?? [];
    list.push(testRun);
    testRunsByCase.set(testRun.testCaseId, list);
  }
  const evidenceByTestRun = new Map<string, EvidenceItem[]>();
  for (const item of evidence) {
    if (!item.testRunId) continue;
    const list = evidenceByTestRun.get(item.testRunId) ?? [];
    list.push(item);
    evidenceByTestRun.set(item.testRunId, list);
  }
  for (const testCase of run.testCases ?? []) {
    const page = ensure(firstNavigateUrl(testCase.steps));
    if (!page) continue;
    const runs = testRunsByCase.get(testCase.id) ?? [];
    const latest = runs[runs.length - 1];
    const items = runs.flatMap((testRun) => evidenceByTestRun.get(testRun.id) ?? []);
    for (const item of items) used.add(item.id);
    page.tests.push({
      id: testCase.id,
      name: testCase.name,
      status: latest?.status ?? 'PENDING',
      errorMessage: latest?.errorMessage ?? null,
      screenshots: items.filter(isImageEvidence),
      files: items.filter((item) => !isImageEvidence(item)),
    });
  }

  // Journey steps.
  const journeys = Array.isArray(payload.journeys) ? payload.journeys : [];
  for (const rawJourney of journeys) {
    const journey = asRecord(rawJourney);
    const steps = Array.isArray(journey.steps) ? journey.steps : [];
    steps.forEach((rawStep, index) => {
      const step = asRecord(rawStep);
      const page = ensure(text(step.url));
      if (!page) return;
      const evidenceId =
        text(step.evidenceId) ?? (text(step.screenshotKey) ? byStorageKey.get(String(step.screenshotKey))?.id ?? null : null);
      if (evidenceId) used.add(evidenceId);
      page.journeySteps.push({
        key: `${String(journey.id ?? journey.name)}-${index}`,
        journey: text(journey.name) ?? 'Journey',
        goal: text(step.goal) ?? `Step ${index + 1}`,
        status: text(step.status) ?? 'unknown',
        detail: text(step.detail),
        checks: (Array.isArray(step.checks) ? step.checks : []).map((rawCheck) => {
          const check = asRecord(rawCheck);
          return {
            name: text(check.name) ?? 'Check',
            passed: check.passed === true,
            expected: text(check.expected) ?? undefined,
            actual: text(check.actual) ?? undefined,
          };
        }),
        evidenceId: evidenceId && byId.has(evidenceId) ? evidenceId : null,
      });
    });
  }

  // Controls tried, from the interaction map.
  const screens = asRecord(payload.interactions).screens;
  for (const rawScreen of Array.isArray(screens) ? screens : []) {
    const screen = asRecord(rawScreen);
    const page = ensure(text(screen.url), text(screen.title));
    if (!page) continue;
    for (const rawControl of Array.isArray(screen.controls) ? screen.controls : []) {
      const control = asRecord(rawControl);
      page.controls.push({
        label: text(control.label) ?? '(unlabelled control)',
        kind: text(control.kind) ?? 'control',
        outcome: text(control.outcome) ?? 'skipped',
        detail: text(control.detail),
      });
    }
  }

  const list = [...pages.values()].filter(
    (page) =>
      page.screenshot || page.findings.length || page.tests.length || page.journeySteps.length || page.controls.length,
  );
  list.sort((a, b) => {
    const worst = (page: PageDossier) => Math.min(...page.findings.map((f) => severityRank(f.severity)), SEVERITY_ORDER.length);
    return (
      worst(a) - worst(b) ||
      problemCount(b) - problemCount(a) ||
      a.path.localeCompare(b.path)
    );
  });
  const unassigned = evidence.filter((item) => !used.has(item.id) && !item.findingId);
  return { pages: list, unassigned };
}

function problemCount(page: PageDossier): number {
  return (
    page.findings.length +
    page.tests.filter((test) => test.status === 'FAILED' || test.status === 'ERROR').length +
    page.journeySteps.filter((step) => step.status === 'failed').length +
    page.controls.filter((control) => PROBLEM_OUTCOMES.has(control.outcome)).length
  );
}

const OTHER = '__other__';

export function PageEvidence({ runId, run, payload }: { runId: string; run: RunDetail; payload: Record<string, unknown> }) {
  const { pages, unassigned } = useMemo(() => buildDossiers(run, payload), [run, payload]);
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? pages[0]?.key ?? (unassigned.length ? OTHER : null);
  const page = pages.find((item) => item.key === current) ?? null;

  if (!pages.length && !unassigned.length) {
    return (
      <EmptyState
        icon={ImageIcon}
        title="No evidence stored yet"
        description="Screenshots, logs and traces appear here, grouped by the page they came from."
      />
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Page index */}
      <nav aria-label="Pages" className="lg:sticky lg:top-16">
        <label className="mb-2 block text-[13px] font-medium text-muted-foreground lg:hidden" htmlFor="page-evidence-select">
          Page
        </label>
        <select
          id="page-evidence-select"
          className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm lg:hidden"
          value={current ?? ''}
          onChange={(event) => setSelected(event.target.value)}
        >
          {pages.map((item) => (
            <option key={item.key} value={item.key}>
              {item.path} {problemCount(item) ? `(${problemCount(item)} problems)` : ''}
            </option>
          ))}
          {unassigned.length ? <option value={OTHER}>Other evidence</option> : null}
        </select>

        <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
          <p className="border-b border-border px-3 py-2 text-[13px] text-muted-foreground">
            {pages.length} {pages.length === 1 ? 'page' : 'pages'}, problems first
          </p>
          <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
            {pages.map((item) => {
              const problems = problemCount(item);
              const active = item.key === current;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => setSelected(item.key)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-well',
                      active && 'bg-well shadow-[inset_2px_0_0_var(--ink)]',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="mono block truncate text-[12.5px] text-ink">{item.path}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                        {[
                          item.findings.length ? `${item.findings.length} findings` : null,
                          item.tests.length ? `${item.tests.length} tests` : null,
                          item.controls.length ? `${item.controls.length} controls` : null,
                          item.journeySteps.length ? `${item.journeySteps.length} journey steps` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Screenshot only'}
                      </span>
                    </span>
                    {problems ? (
                      <span className="tabular mt-0.5 shrink-0 rounded-[4px] bg-[#fdf1ef] px-1.5 text-[12px] font-medium text-danger">
                        {problems}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {unassigned.length ? (
              <li>
                <button
                  type="button"
                  onClick={() => setSelected(OTHER)}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] text-muted-foreground hover:bg-well',
                    current === OTHER && 'bg-well text-ink shadow-[inset_2px_0_0_var(--ink)]',
                  )}
                >
                  Other evidence
                  <span className="tabular">{unassigned.length}</span>
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      </nav>

      {/* Dossier */}
      {current === OTHER || !page ? (
        <section className="space-y-4">
          <header>
            <h3 className="text-[17px] font-semibold text-ink">Other evidence</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">Artifacts that are not tied to one page.</p>
          </header>
          <EvidenceGallery runId={runId} items={unassigned} />
        </section>
      ) : (
        <PageDossierView runId={runId} page={page} />
      )}
    </div>
  );
}

function PageDossierView({ runId, page }: { runId: string; page: PageDossier }) {
  const problemControls = page.controls.filter((control) => PROBLEM_OUTCOMES.has(control.outcome));
  const testsFailed = page.tests.filter((test) => test.status === 'FAILED' || test.status === 'ERROR').length;
  const stepsFailed = page.journeySteps.filter((step) => step.status === 'failed').length;

  return (
    <article className="min-w-0 space-y-8">
      <header className="border-b border-border pb-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="mono break-all text-[17px] font-medium text-ink">{page.path}</h3>
          <a
            href={page.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13px] text-cobalt hover:underline"
          >
            Open page <ExternalLink className="size-3.5" />
          </a>
        </div>
        {page.title ? <p className="mt-1 text-[13px] text-muted-foreground">{page.title}</p> : null}
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 [&>div]:bg-card">
          <Stat label="Findings" value={page.findings.length} bad={page.findings.length > 0} />
          <Stat label="Controls tried" value={page.controls.length} note={problemControls.length ? `${problemControls.length} not working` : undefined} bad={problemControls.length > 0} />
          <Stat label="Tests" value={page.tests.length} note={testsFailed ? `${testsFailed} failed` : undefined} bad={testsFailed > 0} />
          <Stat label="Journey steps" value={page.journeySteps.length} note={stepsFailed ? `${stepsFailed} failed` : undefined} bad={stepsFailed > 0} />
        </dl>
      </header>

      {page.screenshot ? (
        <Section title="Page as the audit saw it">
          <EvidenceThumb runId={runId} evidenceId={page.screenshot.id} caption={page.path} className="max-w-3xl" />
        </Section>
      ) : null}

      {page.findings.length ? (
        <Section title="Findings on this page" count={page.findings.length}>
          <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {page.findings.map((finding, index) => (
              <li key={finding.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono text-[12px] text-muted-foreground">{String.fromCharCode(65 + (index % 26))}</span>
                  <SeverityBadge severity={finding.severity} />
                  <span className="text-sm font-medium text-ink">{finding.title}</span>
                </div>
                {finding.expected || finding.actual ? (
                  <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[7rem_minmax(0,1fr)]">
                    {finding.expected ? (
                      <>
                        <dt className="text-muted-foreground">Expected</dt>
                        <dd className="text-ink">{finding.expected}</dd>
                      </>
                    ) : null}
                    {finding.actual ? (
                      <>
                        <dt className="text-muted-foreground">Happened</dt>
                        <dd className="text-danger">{finding.actual}</dd>
                      </>
                    ) : null}
                  </dl>
                ) : (
                  <p className="text-[13px] text-[#3d4148]">{finding.description}</p>
                )}
                <EvidenceStrip runId={runId} items={(finding.evidence ?? []) as EvidenceItem[]} />
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {page.controls.length ? (
        <Section title="Controls tried here" count={page.controls.length}>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead className="bg-well text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Control</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">What happened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...problemControls, ...page.controls.filter((control) => !PROBLEM_OUTCOMES.has(control.outcome))].map(
                  (control, index) => (
                    <tr key={`${control.label}-${index}`}>
                      <td className="px-3 py-2 align-top">
                        <span className="text-ink">{control.label}</span>
                        <span className="ml-1.5 text-muted-foreground">{control.kind}</span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <OutcomeBadge outcome={control.outcome} />
                      </td>
                      <td className="px-3 py-2 align-top text-[#3d4148]">{control.detail ?? ''}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {page.tests.length ? (
        <Section title="Tests that ran here" count={page.tests.length}>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {page.tests.map((test) => (
              <li key={test.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <TestStatus status={test.status} />
                  <span className="text-sm font-medium text-ink">{test.name}</span>
                </div>
                {test.errorMessage && (test.status === 'FAILED' || test.status === 'ERROR') ? (
                  <p className="mono break-words text-[12px] text-danger">{test.errorMessage}</p>
                ) : null}
                <EvidenceStrip runId={runId} items={[...test.screenshots, ...test.files]} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {page.journeySteps.length ? (
        <Section title="Journey steps on this page" count={page.journeySteps.length}>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {page.journeySteps.map((step) => (
              <li key={step.key} className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <JourneyStatus status={step.status} />
                    <span className="text-sm font-medium text-ink">{step.goal}</span>
                    <span className="text-[13px] text-muted-foreground">in {step.journey}</span>
                  </div>
                  {step.detail ? <p className="text-[13px] text-[#3d4148]">{step.detail}</p> : null}
                  {step.checks.length ? (
                    <ul className="space-y-1 text-[13px]">
                      {step.checks.map((check, index) => (
                        <li key={`${check.name}-${index}`} className="flex gap-2">
                          <span className={check.passed ? 'text-success' : 'text-danger'}>{check.passed ? 'Pass' : 'Fail'}</span>
                          <span className="text-ink">{check.name}</span>
                          {!check.passed && check.actual ? (
                            <span className="text-muted-foreground">got {check.actual}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {step.evidenceId ? <EvidenceThumb runId={runId} evidenceId={step.evidenceId} /> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </article>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-3 text-sm font-semibold text-ink">
        {title}
        {count != null ? <span className="ml-1.5 font-normal text-muted-foreground">({count})</span> : null}
      </h4>
      {children}
    </section>
  );
}

function Stat({ label, value, note, bad }: { label: string; value: number; note?: string; bad?: boolean }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">
        <span className={cn('tabular text-[20px] font-semibold', bad ? 'text-danger' : 'text-ink')}>{value}</span>
        {note ? <span className="ml-2 text-[12px] text-danger">{note}</span> : null}
      </dd>
    </div>
  );
}

/** Screenshots as thumbnails, other files as links, in one row. */
function EvidenceStrip({ runId, items }: { runId: string; items: EvidenceItem[] }) {
  if (!items.length) return null;
  const shots = items.filter(isImageEvidence);
  const files = items.filter((item) => !isImageEvidence(item));
  return (
    <div className="space-y-2">
      {shots.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shots.slice(0, 6).map((item) => (
            <EvidenceThumb key={item.id} runId={runId} evidenceId={item.id} caption={shotLabel(item)} />
          ))}
        </div>
      ) : null}
      {files.length ? (
        <ul className="flex flex-wrap gap-2">
          {files.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[12px]">
              <FileText className="size-3.5 text-muted-foreground" />
              <span className="mono text-ink">{item.fileName ?? item.type.toLowerCase()}</span>
              <EvidenceLink runId={runId} evidenceId={item.id} contentType={item.contentType} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function shotLabel(item: EvidenceItem): string {
  const name = (item.fileName ?? '').replace(/\.(png|jpe?g|webp)$/i, '');
  if (/^before/i.test(name)) return 'Before';
  if (/^after/i.test(name)) return 'After';
  if (/fail/i.test(name)) return 'At failure';
  return /^[a-f0-9]{24,}$/i.test(name) ? 'Screenshot' : name || 'Screenshot';
}

function TestStatus({ status }: { status: string }) {
  const variant =
    status === 'PASSED' ? 'success' : status === 'FAILED' || status === 'ERROR' ? 'high' : status === 'RUNNING' ? 'live' : 'muted';
  return <Badge variant={variant}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

function JourneyStatus({ status }: { status: string }) {
  const variant = status === 'passed' ? 'success' : status === 'failed' ? 'high' : 'muted';
  return <Badge variant={variant}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}
