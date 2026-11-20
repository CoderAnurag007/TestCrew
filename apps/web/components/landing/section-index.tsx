import { cn } from '@/lib/utils';

/** Numbered section marker, e.g. [0.02] How an audit runs. */
export function SectionIndex({
  number,
  label,
  tone = 'night',
}: {
  number: string;
  label: string;
  tone?: 'night' | 'paper';
}) {
  const night = tone === 'night';
  return (
    <div className={cn('index-label flex items-center gap-3', night ? 'text-[var(--night-dim)]' : 'text-[#6e6b66]')}>
      <span
        className={cn(
          'border px-1.5 py-0.5',
          night ? 'border-[var(--night-faint)] text-[var(--night-ink)]' : 'border-[#d9d5cc] text-[#141414]',
        )}
      >
        {number}
      </span>
      <span>{label}</span>
    </div>
  );
}
