import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Ink square with an inspection-frame glyph. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-ink text-white',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-[58%]" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="square">
        <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
        <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
        <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
        <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
        <path d="m8.5 12.2 2.3 2.3 4.7-5" />
      </svg>
    </span>
  );
}

/** Front-page mark: an inspection frame with the work lamp lit inside. */
export function NightMark({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex size-[18px] shrink-0 border-2 border-[var(--night-ink)]', className)} aria-hidden>
      <span className="absolute inset-[3px] bg-[var(--lamp)]" />
    </span>
  );
}

export function Brand({
  href = '/',
  subtitle,
  className,
  tone = 'paper',
}: {
  href?: string;
  subtitle?: string;
  className?: string;
  /** "night" is the wide wordmark used on the dark front pages. */
  tone?: 'paper' | 'night';
}) {
  if (tone === 'night') {
    return (
      <Link href={href} className={cn('inline-flex items-center gap-2.5 outline-none', className)}>
        <NightMark />
        <span className="font-display text-[15px] font-extrabold uppercase tracking-[0.06em] text-[var(--night-ink)] [font-stretch:125%]">
          Snaghunt
        </span>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2 rounded-md outline-none',
        className,
      )}
    >
      <BrandMark />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Snaghunt</span>
        {subtitle ? <span className="mt-1 text-[12px] text-muted-foreground">{subtitle}</span> : null}
      </span>
    </Link>
  );
}
