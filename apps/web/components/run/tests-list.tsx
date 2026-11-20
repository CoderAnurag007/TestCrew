'use client';

import { useMemo, useState } from 'react';
import { CircleCheck, CircleDashed, CircleX, FlaskConical, Loader2, ShieldOff, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/premium';
import type { RunDetail } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { FAILURE_CLASS_LABELS, formatDuration } from './run-utils';

type TestCase = NonNullable<RunDetail['testCases']>[number];
type TestRun = NonNullable<RunDetail['testRuns']>[number];

type Bucket = 'all' | 'passed' | 'failed' | 'flaky' | 'pending';

function bucketOf(execution: TestRun | undefined): Exclude<Bucket, 'all'> {
  const status = execution?.status ?? 'PENDING';
  if (status === 'PASSED') return 'passed';
  if (status === 'FLAKY' || execution?.failureClass === 'FLAKY') return 'flaky';
  if (status === 'FAILED' || status === 'ERROR' || status === 'TIMEDOUT') return 'failed';
  return 'pending';
}

const STATUS_VISUAL: Record<Exclude<Bucket, 'all'>, { icon: typeof CircleCheck; tone: string; label: string }> = {
  passed: { icon: CircleCheck, tone: 'text-success', label: 'Passed' },
  failed: { icon: CircleX, tone: 'text-danger', label: 'Failed' },
  flaky: { icon: TriangleAlert, tone: 'text-warning', label: 'Flaky' },
  pending: { icon: CircleDashed, tone: 'text-muted-foreground', label: 'Pending' },
};

export function TestsList({ testCases, testRuns, live }: { testCases: TestCase[]; testRuns: TestRun[]; live: boolean }) {
  const [bucket, setBucket] = useState<Bucket>('all');
  const rows = useMemo(
    () =>
      testCases.map((test) => {
        const execution = testRuns.find((item) => item.testCaseId === test.id);
        return { test, execution, bucket: bucketOf(execution) };
      }),
    [testCases, testRuns],
  );
  const counts = useMemo(() => {
    const result = { all: rows.length, passed: 0, failed: 0, flaky: 0, pending: 0 };
    for (const row of rows) result[row.bucket] += 1;
    return result;
  }, [rows]);

  if (!testCases.length) {
    return (
      <EmptyState
        icon={FlaskConical}
        title={live ? 'Tests are written after exploring' : 'No tests were generated'}
        description="Snaghunt turns the flows it discovers, and your intents, into Playwright tests and runs them."
      />
    );
  }

  const shown = bucket === 'all' ? rows : rows.filter((row) => row.bucket === bucket);
  const passRate = counts.passed + counts.failed + counts.flaky ? Math.round((counts.passed / (counts.passed + counts.failed + counts.flaky)) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Filter tests by result">
          {(['all', 'passed', 'failed', 'flaky', 'pending'] as Bucket[])
            .filter((key) => key === 'all' || counts[key] > 0)
            .map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={bucket === key}
                onClick={() => setBucket(key)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium capitalize transition-colors',
                  bucket === key ? 'border-cobalt bg-[#f0f3fd] text-cobalt' : 'border-border bg-card text-ink hover:bg-well',
                )}
              >
                {key} <span className="tabular text-muted-foreground">{counts[key]}</span>
              </button>
            ))}
        </div>
        {passRate !== null ? (
          <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
            <div className="h-1.5 w-32 overflow-hidden rounded-sm bg-[#eceef1]" aria-hidden>
              <div className="h-full bg-success" style={{ width: `${passRate}%` }} />
            </div>
            <span>
              <span className="tabular font-semibold text-ink">{passRate}%</span> pass rate
            </span>
          </div>
        ) : null}
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {shown.map(({ test, execution, bucket: rowBucket }) => {
          const visual = STATUS_VISUAL[rowBucket];
          const running = live && rowBucket === 'pending' && execution?.status === 'RUNNING';
          const Icon = running ? Loader2 : visual.icon;
          return (
            <li key={test.id} className="flex gap-3 px-4 py-3">
              <Icon
                className={cn('mt-0.5 size-4 shrink-0', running ? 'animate-spin text-cobalt' : visual.tone)}
                aria-label={running ? 'Running' : visual.label}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug text-ink">{test.name}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground first-letter:uppercase">
                      {[test.category?.replaceAll('_', ' '), test.priority ? `${test.priority} priority` : null, test.source && test.source !== 'generated' ? test.source : null]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {test.source && test.source !== 'generated' ? <Badge variant="outline">{test.source}</Badge> : null}
                    {test.quarantined ? (
                      <Badge variant="muted">
                        <ShieldOff className="size-3" aria-hidden /> Quarantined
                      </Badge>
                    ) : null}
                    {execution?.failureClass ? (
                      <Badge variant={execution.failureClass === 'APP_BUG' ? 'critical' : execution.failureClass === 'FLAKY' ? 'warning' : 'muted'}>
                        {FAILURE_CLASS_LABELS[execution.failureClass] ?? execution.failureClass}
                      </Badge>
                    ) : null}
                    <span className="mono inline-flex gap-2 text-[12px] text-muted-foreground">
                      <span>{execution?.status ?? 'PENDING'}</span>
                      {execution?.durationMs ? <span className="tabular">{formatDuration(execution.durationMs)}</span> : null}
                    </span>
                  </div>
                </div>
                {test.description ? <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{test.description}</p> : null}
                {execution?.errorMessage ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] font-medium text-danger">Error details</summary>
                    <pre className="mono mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-well p-3 text-[12px] text-ink">
                      {execution.errorMessage}
                    </pre>
                  </details>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
