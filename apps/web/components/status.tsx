import type { FindingSeverity, RunStatus } from '@auditor/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Tone = 'muted' | 'live' | 'success' | 'danger';

/** Run status is a dot and a word: color only where the state calls for it. */
const TONES: Record<Tone, { text: string; dot: string }> = {
  muted: { text: 'text-muted-foreground', dot: 'bg-[#6b7079]' },
  live: { text: 'text-cobalt', dot: '' },
  success: { text: 'text-success', dot: 'bg-success' },
  danger: { text: 'text-danger', dot: 'bg-danger' },
};

const RUN_META: Record<RunStatus, { label: string; tone: Tone }> = {
  QUEUED: { label: 'Queued', tone: 'muted' },
  INITIALIZING: { label: 'Starting', tone: 'live' },
  AUTHENTICATING: { label: 'Signing in', tone: 'live' },
  DISCOVERING: { label: 'Discovering', tone: 'live' },
  EXPLORING: { label: 'Exploring', tone: 'live' },
  FINALIZING: { label: 'Finalizing', tone: 'live' },
  GENERATING_TESTS: { label: 'Writing tests', tone: 'live' },
  EXECUTING_TESTS: { label: 'Running tests', tone: 'live' },
  ANALYZING: { label: 'Analyzing', tone: 'live' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
};

/** True while a run is still doing work. */
export function isRunActive(status: RunStatus): boolean {
  return RUN_META[status]?.tone === 'live';
}

export function runStatusLabel(status: RunStatus): string {
  return RUN_META[status]?.label ?? status.replaceAll('_', ' ').toLowerCase();
}

export function RunStatusDot({ status, className }: { status: RunStatus; className?: string }) {
  const meta = RUN_META[status] ?? { label: status, tone: 'muted' as Tone };
  const style = TONES[meta.tone];
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-2 whitespace-nowrap text-[13px] font-medium leading-none',
        style.text,
        className,
      )}
    >
      {meta.tone === 'live' ? (
        <span className="live-dot shrink-0" aria-hidden />
      ) : (
        <span className={cn('size-[7px] shrink-0 rounded-full', style.dot)} aria-hidden />
      )}
      {meta.label}
    </span>
  );
}

const SEVERITY_META: Record<
  FindingSeverity,
  { label: string; variant: 'critical' | 'high' | 'medium' | 'low' | 'muted' }
> = {
  CRITICAL: { label: 'Critical', variant: 'critical' },
  HIGH: { label: 'High', variant: 'high' },
  MEDIUM: { label: 'Medium', variant: 'medium' },
  LOW: { label: 'Low', variant: 'low' },
  INFO: { label: 'Info', variant: 'muted' },
};

export function SeverityDot({
  severity,
  className,
}: {
  severity: FindingSeverity;
  className?: string;
}) {
  const meta = SEVERITY_META[severity] ?? { label: severity, variant: 'muted' as const };
  return (
    <Badge variant={meta.variant} className={className}>
      {meta.label}
    </Badge>
  );
}

/** Compact 0-100 score, coloured by health. Shows a dash when there is no score. */
export function ScorePill({
  score,
  className,
}: {
  score: number | null | undefined;
  className?: string;
}) {
  if (typeof score !== 'number') {
    return (
      <span
        className={cn('tabular text-[13px] text-muted-foreground', className)}
        aria-label="No score"
      >
        –
      </span>
    );
  }
  const value = Math.round(score);
  const tone = value >= 85 ? 'text-success' : value >= 60 ? 'text-warning' : 'text-danger';
  return (
    <span
      className={cn(
        'tabular inline-flex h-5 items-center text-[13px] font-semibold leading-none',
        tone,
        className,
      )}
      aria-label={`Score ${value} out of 100`}
    >
      {value}
    </span>
  );
}
