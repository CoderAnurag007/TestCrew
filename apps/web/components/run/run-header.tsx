'use client';

import { DEVICES, type Device } from '@auditor/shared';
import { ShareButton } from './share-button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isLiveRunStatus, type RunStatus } from '@auditor/shared';
import {
  ArrowLeft,
  CircleStop,
  Clock,
  ExternalLink,
  FileCode2,
  FileDown,
  Globe,
  Loader2,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/premium';
import { ApiError } from '@/lib/api';
import { runApi, type RunDetail } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { canRetryLoginFailure } from './auth-credentials-form';
import { formatDuration, isFinished, saveBlob } from './run-utils';

const STATUS_LABEL: Record<RunStatus, string> = {
  QUEUED: 'Queued',
  INITIALIZING: 'Starting',
  AUTHENTICATING: 'Signing in',
  DISCOVERING: 'Discovering',
  EXPLORING: 'Exploring',
  FINALIZING: 'Finalizing',
  GENERATING_TESTS: 'Generating tests',
  EXECUTING_TESTS: 'Testing',
  ANALYZING: 'Analyzing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export function RunStatusPill({ status, className }: { status: RunStatus; className?: string }) {
  const live = isLiveRunStatus(status);
  const variant =
    status === 'COMPLETED' ? 'success' : status === 'FAILED' ? 'high' : status === 'CANCELLED' ? 'muted' : 'live';
  return (
    <Badge variant={variant} className={cn('gap-1.5', className)}>
      {live ? (
        <span className="live-dot" aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            status === 'COMPLETED' ? 'bg-success' : status === 'FAILED' ? 'bg-danger' : 'bg-muted-foreground/60',
          )}
        />
      )}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Wall-clock elapsed time; ticks every second while the run is live. */
function useElapsed(run: RunDetail | undefined): number {
  const live = Boolean(run && isLiveRunStatus(run.status));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  if (!run) {
    return 0;
  }
  const started = run.startedAt ? new Date(run.startedAt).getTime() : null;
  if (live && started) {
    return Math.max(run.elapsedMs ?? 0, now - started);
  }
  if (!live && started && run.completedAt) {
    return new Date(run.completedAt).getTime() - started;
  }
  return run.elapsedMs ?? 0;
}

export function RunHeader({ runId, run }: { runId: string; run: RunDetail | undefined }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const elapsed = useElapsed(run);
  const live = Boolean(run && isLiveRunStatus(run.status));
  const finished = isFinished(run?.status);
  const completed = run?.status === 'COMPLETED';

  const cancel = useMutation({
    mutationFn: () => runApi.cancel(runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      toast.success('Run cancelled');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not cancel run'),
  });

  const replay = useMutation({
    mutationFn: (projectId: string) => runApi.create(projectId, { replayOfRunId: runId, trigger: 'manual' }),
    onSuccess: (newRun) => {
      toast.success('Replay started');
      router.push(`/runs/${newRun.id}`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not start replay'),
  });

  const retry = useMutation({
    mutationFn: () => runApi.retry(runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      toast.success('Retrying the audit with saved credentials');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not retry the audit'),
  });

  const downloadTests = useMutation({
    mutationFn: () => runApi.exportPlaywright(runId),
    onSuccess: (blob) => saveBlob(blob, `testcrew-${runId}.spec.ts`),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not download tests'),
  });

  const target = run?.baseUrlOverride ?? run?.environment?.baseUrl ?? run?.project.baseUrl ?? null;
  const safety = run?.effectiveSafetyMode ?? null;

  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 space-y-2">
        {run?.projectId ? (
          <Link
            href={`/projects/${run.projectId}`}
            className="inline-flex items-center gap-1 rounded-md text-[13px] text-muted-foreground hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Audit run
          </Link>
        ) : (
          <span className="text-[13px] text-muted-foreground">Audit run</span>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {run ? (
            <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">{run.project.name}</h1>
          ) : (
            <Skeleton className="h-8 w-56" />
          )}
          {run ? <RunStatusPill status={run.status} /> : <Skeleton className="h-5 w-20" />}
        </div>
        {target ? (
          <a
            href={target}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex max-w-full items-center gap-1.5 rounded-md text-cobalt underline-offset-4 hover:underline"
          >
            <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="mono truncate text-[13px]">{target}</span>
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
          <MetaChip icon={Clock} label="Elapsed">
            <span className="mono tabular">{formatDuration(elapsed)}</span>
          </MetaChip>
          {run?.trigger ? (
            <MetaChip icon={Zap} label="Trigger">
              <span className="capitalize">{run.trigger}</span>
            </MetaChip>
          ) : null}
          {safety ? (
            <Badge variant={safety === 'FULL' ? 'warning' : 'success'}>
              {safety === 'FULL' ? <ShieldAlert className="size-3" /> : <ShieldCheck className="size-3" />}
              {safety === 'FULL' ? 'Full mode' : 'Read only'}
            </Badge>
          ) : null}
          {run?.environment?.name ? <MetaChip label="Environment">{run.environment.name}</MetaChip> : null}
          {run?.device && run.device !== 'desktop' ? (
            <MetaChip label="Device">{DEVICES[run.device as Device]?.label ?? run.device}</MetaChip>
          ) : null}
          <span className="mono hidden text-[12px] sm:inline" title="Run id">
            {runId.slice(0, 12)}
          </span>
          {run?.replayOfRunId ? (
            <span>
              Replay of{' '}
              <Link href={`/runs/${run.replayOfRunId}`} className="mono text-cobalt underline-offset-4 hover:underline">
                {run.replayOfRunId.slice(0, 10)}
              </Link>
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {live ? (
          <Button variant="destructive" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            {cancel.isPending ? <Loader2 className="animate-spin" /> : <CircleStop />}
            Cancel run
          </Button>
        ) : null}
        {completed ? (
          <>
            <ReportActions runId={runId} />
            {run ? <ShareButton runId={runId} projectId={run.projectId} shareToken={run.shareToken} /> : null}
            <Button
              variant="outline"
              onClick={() => downloadTests.mutate()}
              disabled={downloadTests.isPending}
              aria-label="Download Playwright tests"
            >
              {downloadTests.isPending ? <Loader2 className="animate-spin" /> : <FileCode2 />}
              Playwright tests
            </Button>
          </>
        ) : null}
        {run && run.status === 'FAILED' && canRetryLoginFailure(run) ? (
          <Button variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Retry sign-in
          </Button>
        ) : null}
        {run && finished ? (
          <Button variant="outline" onClick={() => replay.mutate(run.projectId)} disabled={replay.isPending}>
            {replay.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Replay run
          </Button>
        ) : null}
      </div>
    </header>
  );
}

/** Open the self-contained HTML report in a new tab, or download it as a file. */
export function ReportActions({ runId }: { runId: string }) {
  const downloadReport = useMutation({
    mutationFn: () => runApi.reportHtml(runId),
    onSuccess: (blob) => saveBlob(blob, `testcrew-report-${runId}.html`),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not download the report'),
  });
  return (
    <>
      <Button asChild>
        <a href={runApi.reportHtmlUrl(runId)} target="_blank" rel="noreferrer">
          <ExternalLink />
          Open report
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </Button>
      <Button
        variant="outline"
        onClick={() => downloadReport.mutate()}
        disabled={downloadReport.isPending}
        aria-label="Download HTML report"
      >
        {downloadReport.isPending ? <Loader2 className="animate-spin" /> : <FileDown />}
        HTML report
      </Button>
    </>
  );
}

function MetaChip({
  icon: Icon,
  label,
  children,
}: {
  icon?: typeof Clock;
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink" title={label}>
      {Icon ? <Icon className="size-3.5 text-muted-foreground" aria-hidden /> : null}
      <span className="sr-only">{label}: </span>
      {children}
    </span>
  );
}
