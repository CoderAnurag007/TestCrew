'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type CtaSectionProps = {
  primaryHref: string;
  primaryLabel: string;
};

export function CtaSection({ primaryHref, primaryLabel }: CtaSectionProps) {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-6">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-6 px-6 py-12 text-center sm:px-12">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Ready to audit your next release?
            </h2>
            <p className="max-w-md text-muted-foreground">
              Create a project, queue a run, and get findings with evidence in minutes.
            </p>
            <Button asChild size="lg">
              <Link href={primaryHref}>
                {primaryLabel}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
