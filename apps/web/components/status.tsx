import type { FindingSeverity, RunStatus } from '@auditor/shared';
import { cn } from '@/lib/utils';

const RUN_STYLES: Record<RunStatus, string> = {
  QUEUED: 'bg-zinc-400',
  INITIALIZING: 'bg-sky-500',
  AUTHENTICATING: 'bg-teal-500',
  DISCOVERING: 'bg-cyan-500',
  EXPLORING: 'bg-blue-500',
  FINALIZING: 'bg-indigo-400',
  GENERATING_TESTS: 'bg-indigo-500',
  EXECUTING_TESTS: 'bg-violet-500',
  ANALYZING: 'bg-fuchsia-500',
  COMPLETED: 'bg-emerald-500',
  FAILED: 'bg-red-500',
  CANCELLED: 'bg-zinc-500',
};

export function RunStatusDot({ status }: { status: RunStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
      <span className={cn('size-2 rounded-full', RUN_STYLES[status])} />
      {status.replaceAll('_', ' ')}
    </span>
  );
}

const SEVERITY_STYLES: Record<FindingSeverity, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-sky-500',
  INFO: 'bg-zinc-400',
};

export function SeverityDot({ severity }: { severity: FindingSeverity }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
      <span className={cn('size-2 rounded-full', SEVERITY_STYLES[severity])} />
      {severity}
    </span>
  );
}
