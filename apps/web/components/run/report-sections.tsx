'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FindingSeverity } from '@auditor/shared';
import {
  CircleCheck,
  Gauge,
  Lightbulb,
  ListChecks,
  Repeat,
  ShieldCheck,
  Target,
  TestTubes,
  type LucideIcon,
} from 'lucide-react';
import { SeverityDot } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoreRing } from '@/components/ui/premium';
import { cn } from '@/lib/utils';

/* Report payload v2 sections. Older runs have none of these keys, so every parser returns null when absent. */

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

type DiffItem = {
  signature: string;
  title: string;
  severity: string;
  category: string;
  url: string | null;
};

function diffItems(value: unknown): DiffItem[] {
  return arr(value)
    .map(rec)
    .filter((item): item is Rec => item !== null)
    .map((item) => ({
      signature: String(item.signature ?? ''),
      title: String(item.title ?? 'Untitled'),
      severity: String(item.severity ?? 'INFO'),
      category: String(item.category ?? ''),
      url: str(item.url),
    }));
}

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>{title}</CardTitle>
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">{children}</CardContent>
    </Card>
  );
}

function DiffList({ title, items }: { title: string; items: DiffItem[] }) {
  if (!items.length) {
    return null;
  }
  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-medium text-muted-foreground">{title}</h3>
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {items.slice(0, 5).map((item, index) => (
          <li key={`${item.signature}-${index}`} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 truncate text-ink">{item.title}</span>
            {SEVERITIES.includes(item.severity) ? (
              <SeverityDot severity={item.severity as FindingSeverity} />
            ) : (
              <span className="text-[12px] text-muted-foreground">{item.severity}</span>
            )}
          </li>
        ))}
      </ul>
      {items.length > 5 ? <p className="mt-1 text-[13px] text-muted-foreground">and {items.length - 5} more</p> : null}
    </section>
  );
}

export function SinceLastRunCard({ payload, previousRunId }: { payload: Rec; previousRunId?: string | null }) {
  const diff = rec(payload.diff);
  if (!diff && payload.version === undefined) {
    return null;
  }
  const previous = str(diff?.previousRunId) ?? previousRunId ?? null;
  const counts = rec(diff?.counts) ?? {};
  return (
    <SectionCard
      icon={Repeat}
      title="Since last run"
      description={
        previous ? (
          <>
            Compared with{' '}
            <Link href={`/runs/${previous}`} className="mono text-cobalt underline-offset-4 hover:underline">
              {previous.slice(0, 10)}
            </Link>
          </>
        ) : undefined
      }
    >
      {!previous || !diff ? (
        <p className="text-muted-foreground">This is the first run for this project, so there is nothing to compare.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
            <Stat label="New" value={num(counts.new)} tone={num(counts.new) ? 'text-danger' : undefined} />
            <Stat label="Regressed" value={num(counts.regressed)} tone={num(counts.regressed) ? 'text-danger' : undefined} />
            <Stat label="Fixed" value={num(counts.fixed)} tone={num(counts.fixed) ? 'text-success' : undefined} />
            <Stat label="Still open" value={num(counts.recurring)} />
          </div>
          <DiffList title="New" items={diffItems(diff.new)} />
          <DiffList title="Regressed" items={diffItems(diff.regressed)} />
          <DiffList title="Fixed" items={diffItems(diff.fixed)} />
        </>
      )}
    </SectionCard>
  );
}

export function HealthScoreCard({ payload }: { payload: Rec }) {
  const breakdown = rec(payload.scoreBreakdown);
  if (!breakdown) {
    return null;
  }
  const weights = Object.entries(rec(breakdown.weightByCategory) ?? {}).filter(([, value]) => num(value) > 0);
  const maxWeight = Math.max(1, ...weights.map(([, value]) => num(value)));
  return (
    <SectionCard icon={Gauge} title="Health score" description="Fewer weighted defects per screen means a higher score.">
      <div className="flex items-center gap-5">
        <ScoreRing value={num(breakdown.score)} size={96} label="Score" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Row label="Defect density" value={num(breakdown.density)} />
          <Row label="Screens explored" value={num(breakdown.screensExplored)} />
          <Row label="Findings counted" value={num(breakdown.counted)} />
        </div>
      </div>
      {weights.length ? (
        <div className="space-y-2">
          {weights.map(([category, value]) => (
            <div key={category}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">Weight from {category.toLowerCase()}</span>
                <span className="tabular text-ink">{num(value)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-[#eceef1]" aria-hidden>
                <div className="h-full bg-ink" style={{ width: `${(num(value) / maxWeight) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {str(breakdown.formula) ? (
        <p className="mono rounded-md border border-border bg-well px-3 py-2 text-[12px] text-ink">{String(breakdown.formula)}</p>
      ) : null}
      <p className="text-[13px] text-muted-foreground">Each finding counts as severity x confidence. Hidden findings are not counted.</p>
    </SectionCard>
  );
}

export function SafetySummaryCard({ payload, effectiveMode }: { payload: Rec; effectiveMode?: string | null }) {
  const safety = rec(payload.safety);
  if (!safety) {
    return null;
  }
  const mode = str(safety.mode) ?? effectiveMode ?? 'READ_ONLY';
  const requested = str(safety.requestedMode);
  const downgraded = requested === 'FULL' && mode === 'READ_ONLY';
  const blockedCount = num(safety.blockedCount);
  const sample = arr(safety.blockedSample)
    .map(rec)
    .filter((item): item is Rec => item !== null);
  const links = rec(payload.links);
  return (
    <SectionCard
      icon={ShieldCheck}
      title="Safety"
      description={
        <>
          Ran in <span className="font-medium text-ink">{mode === 'FULL' ? 'Full' : 'Read only'}</span> mode.
          {downgraded ? ' Full was requested but downgraded because the domain is not verified.' : null}
        </>
      }
    >
      <div className="space-y-1.5">
        <Row label="Blocked requests" value={blockedCount} />
        {links ? (
          <>
            <Row label="Links checked" value={num(links.checked)} />
            <Row label="Broken links" value={num(links.broken)} />
            <Row label="Links skipped as unsafe" value={num(links.skippedUnsafe)} />
          </>
        ) : null}
        {num(payload.suppressedCount) > 0 ? <Row label="Hidden findings" value={num(payload.suppressedCount)} /> : null}
      </div>
      {sample.length ? (
        <details className="group">
          <summary className="cursor-pointer text-[13px] font-medium text-cobalt">Show blocked requests ({sample.length})</summary>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-md border border-border">
            {sample.map((item, index) => (
              <li key={`${String(item.url)}-${index}`} className="px-3 py-2 text-[13px]">
                <div className="mono truncate text-[12px] text-ink">
                  <span className="font-medium">{String(item.method ?? '')}</span> {String(item.url ?? '')}
                </div>
                <div className="text-muted-foreground">{String(item.reason ?? '')}</div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </SectionCard>
  );
}

export function IntentResultsCard({ payload }: { payload: Rec }) {
  if (!Array.isArray(payload.intents)) {
    return null;
  }
  const intents = arr(payload.intents)
    .map(rec)
    .filter((item): item is Rec => item !== null);
  return (
    <SectionCard icon={Target} title="Intents" description="Your plain-English expectations, turned into tests.">
      {intents.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {intents.map((item, index) => {
            const status = str(item.status);
            const result = str(item.result);
            const reason = str(item.reason);
            const detail = str(item.detail);
            return (
              <li key={String(item.id ?? index)} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="leading-snug text-ink">{String(item.text ?? '')}</span>
                  <div className="flex shrink-0 gap-1">
                    {status && status !== 'compiled' ? (
                      <Badge variant="muted">{status === 'rejected' ? 'Rejected' : 'Not compiled'}</Badge>
                    ) : null}
                    {result ? <Badge variant={resultVariant(result)}>{result}</Badge> : null}
                  </div>
                </div>
                {reason ? <p className="mt-1 text-[13px] text-muted-foreground">{reason}</p> : null}
                {detail ? <p className="mono mt-1 text-[12px] text-muted-foreground">{detail}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">No intents were set for this run.</p>
      )}
    </SectionCard>
  );
}

export function TestsSummaryCard({ payload }: { payload: Rec }) {
  const tests = rec(payload.tests);
  if (!tests) {
    return null;
  }
  const needsRepair = namedItems(tests.needsRepair);
  const environment = namedItems(tests.environment);
  const skipped = arr(tests.skipped)
    .map(rec)
    .filter((item): item is Rec => item !== null)
    .map((item) => ({ name: String(item.name ?? ''), error: str(item.reason) }));
  const flaky = arr(tests.flakyTests).map(String);
  const quarantined = arr(tests.quarantined).map(String);
  const bySource = Object.entries(rec(tests.bySource) ?? {});
  return (
    <SectionCard
      icon={TestTubes}
      title="Test results"
      description="Only app bugs count against your app. The rest are test or setup problems."
    >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
        <Stat label="Total" value={num(tests.total)} />
        <Stat label="Passed" value={num(tests.passed)} tone={num(tests.passed) ? 'text-success' : undefined} />
        <Stat label="Failed" value={num(tests.failed)} tone={num(tests.failed) ? 'text-danger' : undefined} />
        <Stat label="Flaky" value={num(tests.flaky)} tone={num(tests.flaky) ? 'text-warning' : undefined} />
      </div>
      <div className="space-y-1.5">
        <Row label="App bugs" value={num(tests.appBugs)} />
        <Row label="Tests needing repair" value={needsRepair.length} />
        <Row label="Environment problems" value={environment.length} />
        <Row label="Quarantined" value={quarantined.length} />
        {bySource.map(([source, count]) => (
          <Row key={source} label={`From ${source}`} value={num(count)} />
        ))}
      </div>
      <NamedList title="Tests needing repair" items={needsRepair} />
      <NamedList title="Environment problems" items={environment} />
      <NamedList title="Skipped" items={skipped} />
      <NamedList title="Flaky" items={flaky.map((name) => ({ name, error: null }))} />
      <NamedList title="Quarantined" items={quarantined.map((name) => ({ name, error: null }))} />
    </SectionCard>
  );
}

export function RecommendationsCard({ payload }: { payload: Rec }) {
  const items = arr(payload.recommendations).map(String).filter(Boolean);
  if (!items.length) {
    return null;
  }
  return (
    <SectionCard icon={Lightbulb} title="Recommendations" description="What to fix first, based on the numbers above.">
      <ol className="space-y-2">
        {items.map((item, index) => (
          <li key={`${index}-${item}`} className="flex gap-3">
            <span className="tabular flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-well text-[12px] font-medium text-muted-foreground">
              {index + 1}
            </span>
            <span className="leading-relaxed text-ink">{item}</span>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

export function CoverageCostCard({
  coverage,
  cost,
}: {
  coverage: { discoveredFlows: number; testedFlows: number; successfulFlows: number; failedFlows: number; untestedFlows: number };
  cost: { aiCostUsd: number; browserDurationLabel: string; storageLabel: string };
}) {
  const tested = coverage.discoveredFlows ? Math.round((coverage.testedFlows / coverage.discoveredFlows) * 100) : 0;
  return (
    <SectionCard icon={ListChecks} title="Coverage and cost" description="Provider secrets are never shown.">
      <div>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Flows tested</span>
          <span className="tabular text-ink">
            {coverage.testedFlows} / {coverage.discoveredFlows}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-[#eceef1]" aria-hidden>
          <div className="h-full bg-ink" style={{ width: `${tested}%` }} />
        </div>
      </div>
      <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <Row label="Successful flows" value={coverage.successfulFlows} />
        <Row label="Failed flows" value={coverage.failedFlows} />
        <Row label="Untested flows" value={coverage.untestedFlows} />
        <Row label="AI cost" value={`$${cost.aiCostUsd.toFixed(4)}`} />
        <Row label="Browser time" value={cost.browserDurationLabel} />
        <Row label="Storage" value={cost.storageLabel} />
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Hero summary for finished runs
 * ---------------------------------------------------------------------------------------------- */

const HERO_SEVERITIES: Array<{ key: FindingSeverity; label: string; dot: string }> = [
  { key: 'CRITICAL', label: 'Critical', dot: 'bg-[#c42b1c]' },
  { key: 'HIGH', label: 'High', dot: 'bg-[#e0695d]' },
  { key: 'MEDIUM', label: 'Medium', dot: 'bg-[#a85a00]' },
  { key: 'LOW', label: 'Low', dot: 'bg-[#8a8f97]' },
];

export function ReportHero({
  score,
  summary,
  severityCounts,
  payload,
  status,
  actions,
}: {
  score: number | null;
  summary: string | null;
  severityCounts: Record<FindingSeverity, number>;
  payload: Rec;
  status: string;
  actions?: ReactNode;
}) {
  const diff = rec(payload.diff);
  const counts = rec(diff?.counts);
  const total = HERO_SEVERITIES.reduce((sum, item) => sum + severityCounts[item.key], 0);
  return (
    <Card>
      <div className="flex flex-col gap-6 p-6 md:flex-row md:items-start">
        <div className="flex shrink-0 justify-center md:block">
          <ScoreRing value={score} size={132} label="Health" />
        </div>
        <div className="min-w-0 flex-1 space-y-5">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Summary</h2>
            <p className="mt-1.5 max-w-[72ch] text-sm leading-relaxed text-ink">
              {summary ??
                (status === 'COMPLETED'
                  ? 'No written summary for this run. The numbers below come straight from the database.'
                  : status === 'FAILED' || status === 'CANCELLED'
                    ? 'This run stopped before the report was written. Whatever it found is still listed below.'
                    : 'The report is written once the audit finishes analyzing.')}
            </p>
            <p className="mt-1.5 text-[13px] text-muted-foreground">Numbers come from the database. AI may only summarize them.</p>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
            {HERO_SEVERITIES.map((item) => (
              <div key={item.key} className="bg-card px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <span aria-hidden className={cn('size-1.5 rounded-full', item.dot)} />
                  {item.label}
                </div>
                <div className="tabular mt-1 text-2xl font-semibold leading-none tracking-[-0.01em] text-ink">
                  {severityCounts[item.key]}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
              {counts && diff?.previousRunId ? (
                <>
                  <span className="mr-1 text-muted-foreground">Since last run</span>
                  <Badge variant="new">{num(counts.new)} new</Badge>
                  <Badge variant="regressed">{num(counts.regressed)} regressed</Badge>
                  <Badge variant="success">{num(counts.fixed)} fixed</Badge>
                  <Badge variant="muted">{num(counts.recurring)} still open</Badge>
                </>
              ) : total === 0 && status === 'COMPLETED' ? (
                <Badge variant="success">
                  <CircleCheck className="size-3" aria-hidden /> No open issues above info level
                </Badge>
              ) : (
                <span className="text-muted-foreground">
                  {total} open finding{total === 1 ? '' : 's'} above info level
                </span>
              )}
            </div>
            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </div>
        </div>
      </div>
    </Card>
  );
}

function namedItems(value: unknown): Array<{ name: string; error: string | null }> {
  return arr(value)
    .map(rec)
    .filter((item): item is Rec => item !== null)
    .map((item) => ({ name: String(item.name ?? ''), error: str(item.error) }));
}

function NamedList({ title, items }: { title: string; items: Array<{ name: string; error: string | null }> }) {
  if (!items.length) {
    return null;
  }
  return (
    <details className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">
        {title} <span className="tabular font-normal text-muted-foreground">({items.length})</span>
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="px-3 py-1.5">
            <div className="text-ink">{item.name}</div>
            {item.error ? <div className="mono truncate text-[12px] text-muted-foreground">{item.error}</div> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function resultVariant(result: string): 'success' | 'critical' | 'high' | 'muted' {
  if (result === 'PASSED') return 'success';
  if (result === 'FAILED' || result === 'ERROR') return 'critical';
  if (result === 'FLAKY') return 'high';
  return 'muted';
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div className={cn('tabular text-xl font-semibold leading-none tracking-[-0.01em] text-ink', tone)}>{value}</div>
      <div className="mt-1 text-[13px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular text-ink">{value}</span>
    </div>
  );
}
