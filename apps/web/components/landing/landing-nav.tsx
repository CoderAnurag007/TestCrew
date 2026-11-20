import Link from 'next/link';
import { Brand } from '@/components/shell/brand';

type LandingNavProps = {
  signedIn: boolean;
  primaryHref: string;
  primaryLabel: string;
};

export function LandingNav({ signedIn, primaryHref, primaryLabel }: LandingNavProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--night-line)] bg-[var(--night)]">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <Brand tone="night" />
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <Link href="#how-it-works" className="hidden px-3 py-2 text-sm text-[var(--night-dim)] transition-colors hover:text-[var(--night-ink)] md:inline-block">
            How it works
          </Link>
          <Link href="#evidence" className="hidden px-3 py-2 text-sm text-[var(--night-dim)] transition-colors hover:text-[var(--night-ink)] md:inline-block">
            Evidence
          </Link>
          <Link href="#features" className="hidden px-3 py-2 text-sm text-[var(--night-dim)] transition-colors hover:text-[var(--night-ink)] md:inline-block">
            Features
          </Link>
          {!signedIn ? (
            <Link href="/login" className="px-3 py-2 text-sm text-[var(--night-dim)] transition-colors hover:text-[var(--night-ink)]">
              Sign in
            </Link>
          ) : null}
          <Link
            href={primaryHref}
            className="ml-1 inline-flex h-9 items-center rounded-full bg-[var(--night-ink)] px-4 text-sm font-medium text-black transition-colors hover:bg-white"
          >
            {primaryLabel}
          </Link>
        </nav>
      </div>
    </header>
  );
}
