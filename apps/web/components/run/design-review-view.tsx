'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Monitor, Palette, Smartphone, Sparkles } from 'lucide-react';
import {
  DESIGN_AREA_LABELS,
  DESIGN_AREAS,
  designAreaOf,
  isDesignFinding,
  type DesignArea,
  type DesignReport,
  type FindingSeverity,
} from '@auditor/shared';
import { Card } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/premium';
import type { RunDetail } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { EvidenceImage } from './evidence';
import { SeverityBadge } from './findings-list';
import { SEVERITY_ORDER } from './run-utils';

/** What the panel needs from a finding; both a run's findings and a shared report's fit. */
type DesignFindingLike = {
  id: string;
  title: string;
  severity: string;
  description: string;
  recommendation?: string | null;
  actual?: string | null;
  url?: string | null;
  component?: string | null;
  signature?: string | null;
  confidence?: number;
  suppressed?: boolean;
};

function tone(score: number): string {
  return score >= 85 ? 'text-success' : score >= 60 ? 'text-warning' : 'text-danger';
}

function barTone(score: number): string {
  return score >= 85 ? 'bg-success' : score >= 60 ? 'bg-warning' : 'bg-danger';
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/' ? 'Home' : parsed.pathname;
  } catch {
    return url;
  }
}

export function asDesignReport(value: unknown): DesignReport | null {
  if (!value || typeof value !== 'object') return null;
  const report = value as Partial<DesignReport>;
  return report.version === 1 && typeof report.score === 'number' && Array.isArray(report.pages) ? (report as DesignReport) : null;
}

/** Small card for the overview of an audit that also had a design review. */
export function DesignScoreCard({ report, onOpen }: { report: DesignReport | null; onOpen: () => void }) {
  if (!report) return null;
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Palette className="size-4 text-muted-foreground" aria-hidden /> Design review
        </h3>
        <button type="button" onClick={onOpen} className="text-[13px] font-medium text-ink underline-offset-4 hover:underline">
          Open
        </button>
      </div>
      <p className="flex items-baseline gap-1.5">
        <span className={cn('tabular text-[32px] font-semibold leading-none', tone(report.score))}>{report.score}</span>
        <span className="text-sm text-muted-foreground">/ 100</span>
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2">
        {DESIGN_AREAS.map((area) => (
          <li key={area} className="flex items-center justify-between gap-2 text-[13px]">
            <span className="text-muted-foreground">{DESIGN_AREA_LABELS[area]}</span>
            <span className={cn('tabular font-medium', tone(report.areas[area].score))}>{report.areas[area].score}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function DesignReviewView({ run, live }: { run: RunDetail; live: boolean }) {
  return (
    <DesignReviewPanel
      report={asDesignReport(run.designReport)}
      findings={run.findings}
      live={live}
      image={(evidenceId, alt) => (
        <EvidenceImage key={evidenceId} runId={run.id} evidenceId={evidenceId} alt={alt} className="block h-auto rounded-md shadow-sm" />
      )}
    />
  );
}

/** The design review: scores, what works, the fix list and marked screenshots. */
export function DesignReviewPanel({
  report,
  findings,
  live = false,
  image,
}: {
  report: DesignReport | null;
  findings: DesignFindingLike[];
  live?: boolean;
  image: (evidenceId: string, alt: string) => ReactNode;
}) {
  const issues = useMemo(
    () =>
      findings
        .filter((item) => isDesignFinding(item) && !item.suppressed)
        .sort(
          (left, right) =>
            SEVERITY_ORDER.indexOf(left.severity as FindingSeverity) - SEVERITY_ORDER.indexOf(right.severity as FindingSeverity) ||
            (right.confidence ?? 0.5) - (left.confidence ?? 0.5),
        ),
    [findings],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [area, setArea] = useState<DesignArea | 'all'>('all');
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [shot, setShot] = useState<'desktop' | 'phone'>('desktop');

  if (!report) {
    return live ? (
      <EmptyState
        icon={Palette}
        title="The design review is running"
        description="Screenshots of the main pages on a computer and a phone are being taken and reviewed. This takes 2–4 minutes."
      />
    ) : (
      <EmptyState icon={Palette} title="No design review" description="This audit did not include a design review." />
    );
  }

  const shown = area === 'all' ? issues : issues.filter((item) => designAreaOf(item) === area);
  const selected = issues.find((item) => item.id === selectedId) ?? null;
  const selectedMarks = selected ? (report.marks[selected.id] ?? []) : [];

  // The screenshot follows the selected issue; otherwise the page and view the user picked.
  const firstMark = selectedMarks[0];
  const activeUrl = firstMark?.url ?? pageUrl ?? report.pages[0]?.url ?? null;
  const activeShot = firstMark?.shot ?? shot;
  const page = report.pages.find((item) => item.url === activeUrl) ?? report.pages[0];
  const evidenceId = page ? (activeShot === 'phone' ? page.phone : page.desktop) ?? page.desktop : null;
  const boxes = selected
    ? selectedMarks.filter((mark) => mark.url === page?.url && mark.shot === activeShot).flatMap((mark) => mark.boxes.map((box) => ({ box, n: 0 })))
    : issues.flatMap((item, index) =>
        (report.marks[item.id] ?? [])
          .filter((mark) => mark.url === page?.url && mark.shot === activeShot)
          .flatMap((mark) => mark.boxes.slice(0, 3).map((box) => ({ box, n: index + 1 }))),
      );

  return (
    <div className="space-y-6">
      <Card className="p-6 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-[60ch]">
            <p className="text-[13px] font-medium text-muted-foreground">Design score</p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className={cn('tabular text-[44px] font-semibold leading-none tracking-[-0.02em]', tone(report.score))}>{report.score}</span>
              <span className="text-[15px] text-muted-foreground">/ 100</span>
            </p>
            {report.summary ? <p className="mt-3 text-[15px] leading-relaxed text-ink">{report.summary}</p> : null}
            <p className="mt-2 text-[13px] text-muted-foreground">
              {report.metrics.pagesReviewed} page{report.metrics.pagesReviewed === 1 ? '' : 's'} on a computer and a phone ·{' '}
              {issues.length} thing{issues.length === 1 ? '' : 's'} to improve
            </p>
            {!report.ai.used ? (
              <p className="mt-3 rounded-md bg-well px-3 py-2 text-[13px] text-ink">
                The AI review was not available for this run, so this covers the measured checks only (contrast, text size, tap
                targets, phone width, images, labels, layout shift).
              </p>
            ) : null}
          </div>
          <ul className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:w-[420px]">
            {DESIGN_AREAS.map((key) => {
              const entry = report.areas[key];
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setArea(area === key ? 'all' : key)}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-well',
                      area === key && 'bg-well ring-1 ring-border',
                    )}
                    aria-pressed={area === key}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] text-muted-foreground">{DESIGN_AREA_LABELS[key]}</span>
                      <span className={cn('tabular text-[15px] font-semibold', tone(entry.score))}>{entry.score}</span>
                    </span>
                    <span className="mt-1.5 block h-1 rounded-full bg-well">
                      <span className={cn('block h-full rounded-full', barTone(entry.score))} style={{ width: `${entry.score}%` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {report.strengths.length ? (
          <div className="mt-6 border-t border-border pt-5">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
              <Sparkles className="size-4 text-muted-foreground" aria-hidden /> What works well
            </h3>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {report.strengths.map((item) => (
                <li key={item} className="text-[14px] leading-relaxed text-ink">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <h3 className="text-[15px] font-semibold text-ink">
              {area === 'all' ? 'Fix these first' : DESIGN_AREA_LABELS[area]}
            </h3>
            {area !== 'all' ? (
              <button type="button" className="text-[13px] text-muted-foreground hover:text-ink" onClick={() => setArea('all')}>
                Show all
              </button>
            ) : null}
          </div>
          {shown.length ? (
            <ol className="divide-y divide-border">
              {shown.map((item) => {
                const open = item.id === selectedId;
                const number = issues.indexOf(item) + 1;
                const itemArea = designAreaOf(item);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(open ? null : item.id)}
                      aria-expanded={open}
                      className={cn('flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-well', open && 'bg-well')}
                    >
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
                        {number}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-medium leading-snug text-ink">{item.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                          <SeverityBadge severity={item.severity as FindingSeverity} />
                          {itemArea ? <span>{DESIGN_AREA_LABELS[itemArea]}</span> : null}
                          {item.url ? <span className="mono truncate">{pathOf(item.url)}</span> : null}
                        </span>
                      </span>
                    </button>
                    {open ? <IssueDetail finding={item} /> : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              {issues.length ? 'Nothing to fix in this area.' : 'Nothing to fix: the pages look good on a computer and a phone.'}
            </p>
          )}
        </Card>

        <Card className="overflow-hidden xl:sticky xl:top-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex min-w-0 flex-wrap gap-1" role="tablist" aria-label="Page">
              {report.pages.map((item) => (
                <button
                  key={item.url}
                  type="button"
                  role="tab"
                  aria-selected={item.url === page?.url}
                  onClick={() => {
                    setSelectedId(null);
                    setPageUrl(item.url);
                  }}
                  className={cn(
                    'mono max-w-[14rem] truncate rounded-md px-2 py-1 text-[12px]',
                    item.url === page?.url ? 'bg-ink text-white' : 'text-muted-foreground hover:bg-well hover:text-ink',
                  )}
                  title={item.url}
                >
                  {pathOf(item.url)}
                </button>
              ))}
            </div>
            <div className="flex gap-1" role="group" aria-label="Screen">
              {(['desktop', 'phone'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={activeShot === value}
                  disabled={value === 'phone' && !page?.phone}
                  onClick={() => {
                    setSelectedId(null);
                    setPageUrl(page?.url ?? null);
                    setShot(value);
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] disabled:opacity-40',
                    activeShot === value ? 'bg-well font-medium text-ink' : 'text-muted-foreground hover:text-ink',
                  )}
                >
                  {value === 'desktop' ? <Monitor className="size-3.5" /> : <Smartphone className="size-3.5" />}
                  {value === 'desktop' ? 'Computer' : 'Phone'}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[75vh] overflow-y-auto bg-well p-3">
            {evidenceId ? (
              <div className={cn('relative mx-auto', activeShot === 'phone' ? 'max-w-[380px]' : 'w-full')}>
                {image(evidenceId, `${pathOf(page?.url ?? '')} on a ${activeShot === 'phone' ? 'phone' : 'computer'}`)}
                {boxes.map(({ box, n }, index) => (
                  <span
                    key={index}
                    aria-hidden
                    className="pointer-events-none absolute rounded-[3px] border-2 border-[#e0695d] bg-[#e0695d]/10"
                    style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
                  >
                    {n ? (
                      <span className="absolute -left-2 -top-2 flex size-4 items-center justify-center rounded-full bg-[#c42b1c] text-[10px] font-semibold text-white">
                        {n}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : (
              <Skeleton className="h-80 w-full" />
            )}
          </div>
          <p className="border-t border-border px-4 py-2 text-[12px] text-muted-foreground">
            {selected
              ? boxes.length
                ? 'The marked area is where this issue is.'
                : 'This issue applies to the page as a whole.'
              : 'Numbers match the list. Pick an issue to see just its spot.'}
          </p>
        </Card>
      </div>
    </div>
  );
}

function IssueDetail({ finding }: { finding: DesignFindingLike }) {
  return (
    <div className="space-y-3 bg-well px-5 pb-4 pl-[52px] text-[14px] leading-relaxed">
      <p className="text-ink">{finding.description}</p>
      {finding.recommendation ? (
        <p>
          <span className="font-medium text-ink">How to fix: </span>
          <span className="text-ink">{finding.recommendation}</span>
        </p>
      ) : null}
      {finding.actual ? (
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium">Seen: </span>
          {finding.actual}
        </p>
      ) : null}
    </div>
  );
}
