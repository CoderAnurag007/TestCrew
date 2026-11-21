'use client';

import Link from 'next/link';
import type { Run } from '@auditor/shared';
import { RunStatusDot, ScorePill } from '@/components/status';
import { Skeleton } from '@/components/ui/premium';
import { cn } from '@/lib/utils';
import { durationLabel, fullDate, shortId, timeAgo } from './format';

export type RunRow = Run & { projectName?: string };

/**
 * Runs as a list of linked rows. Columns collapse on small screens so the
 * table never scrolls sideways.
 */
export function RunsTable({
  runs,
  loading,
  error,
  showProject = false,
  empty,
  className,
}: {
  runs: RunRow[] | undefined;
  loading?: boolean;
  error?: boolean;
  showProject?: boolean;
  empty?: React.ReactNode;
  className?: string;
}) {
  if (loading) {
    return (
      <div
        className={cn('divide-y divide-border', className)}
        aria-busy="true"
        aria-label="Loading runs"
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="px-5 py-3">
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p className={cn('px-5 py-8 text-sm text-danger', className)} role="alert">
        Could not load runs. Refresh the page to try again.
      </p>
    );
  }
  if (!runs?.length) {
    return (
      <div className={className}>
        {empty ?? <p className="px-5 py-8 text-sm text-muted-foreground">No runs yet.</p>}
      </div>
    );
  }

  const columns = 'md:grid-cols-[minmax(0,1.6fr)_140px_64px_minmax(0,1fr)_110px]';

  return (
    <div className={className}>
      <div
        className={cn(
          'hidden h-9 items-center gap-4 border-b border-border bg-well px-5 text-[13px] text-muted-foreground md:grid',
          columns,
        )}
        aria-hidden
      >
        <span>{showProject ? 'Project' : 'Run'}</span>
        <span>Status</span>
        <span>Score</span>
        <span>Coverage</span>
        <span className="text-right">Started</span>
      </div>
      <ul className="divide-y divide-border">
        {runs.map((run) => (
          <li key={run.id}>
            <Link
              href={`/runs/${run.id}`}
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-2.5 transition-colors hover:bg-well focus-visible:bg-well focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cobalt',
                columns,
              )}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">
                  {showProject ? (
                    (run.projectName ?? 'Project')
                  ) : (
                    <>
                      Run <span className="mono font-normal">{shortId(run.id)}</span>
                    </>
                  )}
                </div>
                <div className="mt-0.5 flex min-w-0 gap-x-3 text-xs text-muted-foreground">
                  {showProject ? <span className="mono truncate">{shortId(run.id)}</span> : null}
                  <span className="truncate">{run.trigger ?? 'manual'}</span>
                  {run.designReview ? (
                    <span className="truncate">{run.bugAudit === false ? 'Design review' : '+ design review'}</span>
                  ) : null}
                  {run.effectiveSafetyMode ? (
                    <span className="truncate">
                      {run.effectiveSafetyMode === 'FULL' ? 'Full' : 'Read-only'}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-3 justify-self-end md:justify-self-start">
                <RunStatusDot status={run.status} />
                <ScorePill score={run.bugAudit === false ? run.designScore : run.qualityScore} className="md:hidden" />
              </div>
              <div className="hidden md:block">
                <ScorePill score={run.bugAudit === false ? run.designScore : run.qualityScore} />
              </div>
              <div className="col-span-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground md:col-span-1">
                {run.bugAudit !== false ? <span>{run.pagesDiscovered} pages</span> : null}
                {typeof run.designScore === 'number' ? <span className="tabular">Design {Math.round(run.designScore)}/100</span> : null}
                {typeof run.testsGenerated === 'number' && run.testsGenerated > 0 ? (
                  <span className="tabular">
                    {run.testsPassed ?? 0}/{run.testsGenerated} tests passed
                  </span>
                ) : run.bugAudit !== false ? (
                  <span>{run.actionsExecuted} actions</span>
                ) : null}
                <span className="md:hidden">{timeAgo(run.createdAt)}</span>
              </div>
              <div
                className="hidden text-right text-xs text-muted-foreground md:block"
                title={fullDate(run.createdAt)}
              >
                <div>{timeAgo(run.createdAt)}</div>
                {run.completedAt ? (
                  <div className="mono mt-0.5">{durationLabel(run.startedAt, run.completedAt)}</div>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
