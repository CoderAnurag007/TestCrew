'use client';

import Link from 'next/link';
import { Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

type LandingNavProps = {
  signedIn: boolean;
  primaryHref: string;
  primaryLabel: string;
};

export function LandingNav({ signedIn, primaryHref, primaryLabel }: LandingNavProps) {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radar className="size-4" aria-hidden />
          </span>
          <span className="text-sm font-semibold tracking-tight">AI App Auditor</span>
        </Link>

        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="#how-it-works">How it works</Link>
          </Button>
          {!signedIn ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          ) : null}
          <Button asChild size="sm">
            <Link href={primaryHref}>{primaryLabel}</Link>
          </Button>
        </nav>
      </div>
      <Separator />
    </header>
  );
}
