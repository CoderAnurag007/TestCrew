'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { isLiveRunStatus, type RunStatus } from '@auditor/shared';
import { useStartAudit } from '@/components/pages/project-header';
import { Button } from '@/components/ui/button';
import { onboardingApi, type Onboarding } from '@/lib/queries';
import { cn } from '@/lib/utils';

const HIDE_KEY = 'snaghunt.getStarted.hidden.';

/** The first-run checklist on the dashboard: add a site, audit it, read the report, turn on alerts. */
export function GetStarted({ organizationId, onAddSite }: { organizationId: string; onAddSite: () => void }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDE_KEY + organizationId) === '1');
    } catch {
      setHidden(false);
    }
  }, [organizationId]);

  const progress = useQuery({
    queryKey: ['onboarding', organizationId],
    queryFn: () => onboardingApi.get(organizationId),
    // Keep the checklist current while the first audit runs.
    refetchInterval: (query) => {
      const status = query.state.data?.firstRun?.status;
      return status && isLiveRunStatus(status as RunStatus) ? 5000 : false;
    },
  });

  if (hidden || !progress.data) return null;
  const steps = buildSteps(progress.data);
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;

  const hide = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(HIDE_KEY + organizationId, '1');
    } catch {
      /* the guide simply shows again next time */
    }
  };

  const current = steps.findIndex((step) => !step.done);

  return (
    <section aria-labelledby="get-started-title" className="mb-10 rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 id="get-started-title" className="text-[16px] font-semibold text-ink">
            Get started with Snaghunt
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {done} of {steps.length} done · about 5 minutes of your time, the audit does the rest
          </p>
        </div>
        <button
          type="button"
          onClick={hide}
          className="rounded-md p-1 text-muted-foreground hover:bg-well hover:text-ink"
          aria-label="Hide the getting started guide"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="h-1 bg-well">
        <div className="h-full bg-ink transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="divide-y divide-border">
        {steps.map((step, index) => (
          <li key={step.title} className={cn('flex gap-4 px-5 py-4 sm:px-6', index === current ? 'bg-card' : 'bg-card')}>
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-medium',
                step.done ? 'border-ink bg-ink text-white' : index === current ? 'border-ink text-ink' : 'border-border text-muted-foreground',
              )}
            >
              {step.done ? <Check className="size-3.5" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-[14.5px] font-medium', step.done ? 'text-muted-foreground line-through decoration-[#c4c7cc]' : 'text-ink')}>
                {step.title}
                <span className="sr-only">{step.done ? ' (done)' : ''}</span>
              </p>
              {!step.done ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{step.detail}</p> : null}
            </div>
            {!step.done && index === current ? (
              <div className="shrink-0 self-center">
                {step.key === 'site' ? (
                  <Button size="sm" onClick={onAddSite}>
                    Add your site
                  </Button>
                ) : step.key === 'audit' && progress.data.project && !step.action ? (
                  <StartFirstAudit projectId={progress.data.project.id} />
                ) : (
                  step.action
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

type Step = { key: string; title: string; detail: string; done: boolean; action?: ReactNode };

function buildSteps(data: Onboarding): Step[] {
  const running = data.firstRun && isLiveRunStatus(data.firstRun.status as RunStatus);
  return [
    {
      key: 'site',
      title: 'Add your website',
      detail: 'Paste its address. Audits are read-only by default, so nothing on your site changes.',
      done: Boolean(data.project),
    },
    {
      key: 'audit',
      title: running ? 'Your first audit is running' : 'Start your first audit',
      detail: running
        ? 'First snags show up within a minute or two; the full audit takes 15–25 minutes. You can close this page.'
        : 'Snaghunt clicks through your site like a customer: every page, button and form.',
      done: Boolean(data.firstRun) && !running,
      action: running && data.firstRun ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/runs/${data.firstRun.id}`}>
            <Loader2 className="animate-spin" /> Watch it live
          </Link>
        </Button>
      ) : undefined,
    },
    {
      key: 'report',
      title: 'Read your first report',
      detail: data.firstReport
        ? `${data.firstReport.findings} snag${data.firstReport.findings === 1 ? '' : 's'} found, each with steps, a screenshot and how to fix it.`
        : 'Each snag comes with steps to reproduce, a screenshot and how to fix it.',
      done: false,
      action: data.firstReport ? (
        <Button size="sm" asChild>
          <Link href={`/runs/${data.firstReport.id}`}>Open the report</Link>
        </Button>
      ) : undefined,
    },
    {
      key: 'alerts',
      title: 'Get told when something breaks',
      detail: 'Turn on daily audits and alerts by email or Slack, or connect GitHub, Jira or Linear for one-click tickets.',
      done: data.monitoring || data.connected,
      action: data.project ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/projects/${data.project.id}/settings?tab=monitoring`}>Set up alerts</Link>
        </Button>
      ) : undefined,
    },
  ].map((step, index, all) =>
    // Reading the report counts as done once alerts are set up (people often skip straight there).
    step.key === 'report' ? { ...step, done: Boolean(data.firstReport) && all[3]!.done } : step,
  );
}

function StartFirstAudit({ projectId }: { projectId: string }) {
  const start = useStartAudit(projectId, undefined);
  return (
    <Button size="sm" disabled={start.isPending} onClick={() => start.mutate(undefined)}>
      {start.isPending ? <Loader2 className="animate-spin" /> : null}
      Start the audit
    </Button>
  );
}
