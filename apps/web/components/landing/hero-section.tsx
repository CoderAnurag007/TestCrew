'use client';

import Link from 'next/link';
import { ArrowRight, Radar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type HeroSectionProps = {
  primaryHref: string;
  primaryLabel: string;
  signedIn: boolean;
};

export function HeroSection({ primaryHref, primaryLabel, signedIn }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden">
      <div className="command-grid absolute inset-0 opacity-50" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent"
        aria-hidden
      />

      <div className="relative mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center sm:py-32">
        <Badge variant="default" className="mb-6">
          Autonomous quality audits
        </Badge>

        <div className="mb-6 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Radar className="size-7" aria-hidden />
        </div>

        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
          Ship with confidence on every release
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          AI App Auditor explores your web app, generates tests from real controls, runs them in
          isolated browsers, and returns scored findings—from one control plane.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href={primaryHref}>
              {primaryLabel}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="#how-it-works">See how it works</Link>
          </Button>
        </div>

        {!signedIn ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
