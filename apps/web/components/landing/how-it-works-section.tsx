'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Compass,
  FlaskConical,
  FolderKanban,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Step = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  status: string;
  lines: string[];
};

const STEPS: Step[] = [
  {
    id: 'register',
    title: 'Register your app',
    description: 'Add a project URL, environments, and optional login credentials.',
    icon: FolderKanban,
    status: 'Project created',
    lines: ['baseUrl: https://app.example.com', 'environment: staging', 'credentials: encrypted'],
  },
  {
    id: 'explore',
    title: 'Explore autonomously',
    description: 'Playwright maps pages, controls, and navigation into a live flow graph.',
    icon: Compass,
    status: 'Exploring…',
    lines: ['states discovered: 24', 'actions extracted: 67', 'auth flow: verified'],
  },
  {
    id: 'test',
    title: 'Generate & run tests',
    description: 'Tests are built from discovered selectors—not invented—and executed in isolation.',
    icon: FlaskConical,
    status: 'Running suite',
    lines: ['happy path: 12 tests', 'validation: 8 tests', 'a11y checks: 6 tests'],
  },
  {
    id: 'report',
    title: 'Review findings & score',
    description: 'Bug, UX, a11y, and visual issues arrive with evidence and a quality score.',
    icon: BarChart3,
    status: 'Report ready',
    lines: ['findings: 14 open', 'quality score: 82', 'evidence: screenshots + HAR'],
  },
];

const INTERVAL_MS = 4500;

export function HowItWorksSection() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const advance = useCallback(() => {
    setActive((i) => (i + 1) % STEPS.length);
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(advance, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [paused, advance]);

  const step = STEPS[active]!;

  return (
    <section id="how-it-works" className="border-t bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mb-12 text-center">
          <Badge variant="muted" className="mb-4">
            How it works
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            From URL to quality report
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
            Four steps. Fully autonomous. You stay in the control plane.
          </p>
        </div>

        <div
          className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          {/* Step list */}
          <ol className="space-y-2">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isActive = i === active;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    className={cn(
                      'flex w-full items-start gap-4 rounded-lg border p-4 text-left transition-all',
                      isActive
                        ? 'border-primary/40 bg-background shadow-sm'
                        : 'border-transparent bg-transparent hover:bg-background/60',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-md transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="mono text-xs text-muted-foreground">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="font-medium">{s.title}</span>
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">{s.description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* Animated preview panel */}
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/40 pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">{step.title}</CardTitle>
                <Badge variant="success" className="how-step-badge" key={step.id}>
                  {step.status}
                </Badge>
              </div>
              <CardDescription>{step.description}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="border-b bg-muted/20 px-5 py-3">
                <div className="flex gap-1.5" aria-hidden>
                  <span className="size-2.5 rounded-full bg-red-400/70" />
                  <span className="size-2.5 rounded-full bg-amber-400/70" />
                  <span className="size-2.5 rounded-full bg-emerald-400/70" />
                </div>
              </div>
              <div className="space-y-3 p-5 font-mono text-sm" key={step.id}>
                {step.lines.map((line, i) => (
                  <div
                    key={line}
                    className="how-step-line flex items-center gap-3 rounded-md border bg-background px-3 py-2.5"
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    <span className="text-primary">›</span>
                    <span className="text-foreground/90">{line}</span>
                  </div>
                ))}
              </div>

              {/* Progress bar */}
              <div className="px-5 pb-5">
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full bg-primary transition-all', paused && 'opacity-60')}
                    style={{
                      width: `${((active + 1) / STEPS.length) * 100}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Step {active + 1} of {STEPS.length}
                  {paused ? ' · paused' : ''}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
