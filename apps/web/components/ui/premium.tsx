import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Page title row: title and one line of context on the left, actions on the right.
 * `eyebrow` is rendered as quiet context above the title (sentence case, not a label).
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-[13px] text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const STAT_TONES = {
  default: 'text-ink',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  live: 'text-cobalt',
} as const;

/**
 * One metric. The number carries the tone; there is no decorative icon tile.
 * (`icon` is accepted for older callers and intentionally not drawn.)
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: keyof typeof STAT_TONES;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 px-5 py-4', className)}>
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={cn('tabular mt-1 text-2xl font-semibold leading-tight tracking-[-0.01em]', STAT_TONES[tone])}>{value}</div>
      {hint ? <div className="mt-1 truncate text-[12px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** A row of stats sharing one bordered strip, divided by rules (not separate cards). */
export function StatStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    // A 1px gap over the rule color draws exact dividers at every wrap width.
    <div
      className={cn(
        'grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-px overflow-hidden rounded-lg border border-border bg-border [&>*]:bg-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Empty state: what is missing and the one action that fixes it. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start rounded-lg border border-dashed border-[#cfd3d9] px-6 py-10', className)}>
      {Icon ? <Icon className="mb-3 size-5 text-muted-foreground" aria-hidden /> : null}
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {description ? <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** 0–100 gauge in the status colors: pass ≥ 85, warning ≥ 60, fail below. */
export function ScoreRing({
  value,
  size = 120,
  label = 'Health',
  className,
}: {
  value: number | null | undefined;
  size?: number;
  label?: string;
  className?: string;
}) {
  const score = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : null;
  const stroke = Math.max(4, Math.round(size / 18));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = score === null ? '#cfd3d9' : score >= 85 ? '#127a3e' : score >= 60 ? '#a85a00' : '#c42b1c';
  return (
    <div className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eceef1" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={score === null ? circumference : circumference * (1 - score / 100)}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        role="img"
        aria-label={`${label} ${score === null ? 'not available' : Math.round(score)}`}
      >
        <span className="tabular font-semibold leading-none tracking-[-0.02em] text-ink" style={{ fontSize: size * 0.3 }}>
          {score === null ? '–' : Math.round(score)}
        </span>
        <span className="mt-1 text-[11px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

/** Section heading inside a page. */
export function SectionTitle({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Loading placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-md', className)} />;
}
