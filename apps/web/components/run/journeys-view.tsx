'use client';

import { useMemo } from 'react';
import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Route,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { RequirementBadge } from '@/components/project/test-plan-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, StatCard, StatStrip } from '@/components/ui/premium';
import { cn } from '@/lib/utils';
import { EvidenceThumb } from './evidence';
import { formatDuration, hostAndPath } from './run-utils';

/* Business journeys from the report payload. Every field is optional: older runs have none. */

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null;
const recs = (value: unknown): Rec[] => (Array.isArray(value) ? value.map(rec).filter((item): item is Rec => item !== null) : []);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.length ? value : undefined);

type JourneyStatus = 'passed' | 'failed' | 'skipped' | 'blocked' | 'partial';
type StepStatus = 'passed' | 'failed' | 'skipped' | 'blocked';
type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

const JOURNEY_STATUS: Record<JourneyStatus, { label: string; variant: BadgeVariant; icon: LucideIcon; order: number }> = {
  failed: { label: 'Failed', variant: 'critical', icon: CircleX, order: 0 },
  partial: { label: 'Partial', variant: 'warning', icon: TriangleAlert, order: 1 },
  blocked: { label: 'Blocked', variant: 'medium', icon: Ban, order: 2 },
  passed: { label: 'Passed', variant: 'success', icon: CircleCheck, order: 3 },
  skipped: { label: 'Skipped', variant: 'muted', icon: CircleDashed, order: 4 },
};

const STEP_STATUS: Record<StepStatus, { label: string; icon: LucideIcon; className: string }> = {
  passed: { label: 'Passed', icon: CircleCheck, className: 'text-success' },
  failed: { label: 'Failed', icon: CircleX, className: 'text-danger' },
  blocked: { label: 'Blocked', icon: Ban, className: 'text-warning' },
  skipped: { label: 'Skipped', icon: CircleDashed, className: 'text-muted-foreground' },
};

const CATEGORY_LABEL: Record<string, string> = {
  ecommerce: 'E-commerce',
  saas: 'SaaS',
  booking: 'Booking',
  tools: 'Online tools',
  content: 'Content',
  generic: 'Generic',
  custom: 'Custom',
};

type Check = { name: string; passed: boolean; expected?: string; actual?: string };
type Step = { index: number; goal: string; status: StepStatus; detail?: string; url?: string; evidenceId?: string; checks: Check[] };
type Journey = {
  id: string;
  name: string;
  category?: string;
  requires?: string;
  status: JourneyStatus;
  reason?: string;
  steps: Step[];
  durationMs: number;
};

function journeyStatus(value: unknown): JourneyStatus {
  return typeof value === 'string' && value in JOURNEY_STATUS ? (value as JourneyStatus) : 'skipped';
}

function stepStatus(value: unknown): StepStatus {
  return typeof value === 'string' && value in STEP_STATUS ? (value as StepStatus) : 'skipped';
}

function parseJourneys(payload: Rec): Journey[] | null {
  if (!Array.isArray(payload.journeys)) return null;
  return recs(payload.journeys).map((journey, i) => ({
    id: str(journey.id) ?? `journey-${i}`,
    name: str(journey.name) ?? 'Unnamed journey',
    category: str(journey.category),
    requires: str(journey.requires),
    status: journeyStatus(journey.status),
    reason: str(journey.reason),
    durationMs: typeof journey.durationMs === 'number' ? journey.durationMs : 0,
    steps: recs(journey.steps).map((step, j) => ({
      index: typeof step.index === 'number' ? step.index : j,
      goal: str(step.goal) ?? `Step ${j + 1}`,
      status: stepStatus(step.status),
      detail: str(step.detail),
      url: str(step.url),
      evidenceId: str(step.evidenceId),
      checks: recs(step.checks).map((check) => ({
        name: str(check.name) ?? 'Check',
        passed: check.passed === true,
        expected: str(check.expected),
        actual: str(check.actual),
      })),
    })),
  }));
}

export function JourneysView({ runId, payload }: { runId: string; payload: Rec }) {
  const journeys = useMemo(() => {
    const parsed = parseJourneys(payload);
    return parsed
      ? [...parsed].sort((a, b) => JOURNEY_STATUS[a.status].order - JOURNEY_STATUS[b.status].order)
      : null;
  }, [payload]);

  if (!journeys || journeys.length === 0) {
    return (
      <EmptyState
        icon={Route}
        title="No journeys ran"
        description={
          journeys
            ? 'No journey applied to this app in this mode. Check the category and journeys in the project test plan.'
            : 'Journeys such as add to cart, sign in or contact form are reported here on newer runs.'
        }
      />
    );
  }

  const counts = journeys.reduce<Record<JourneyStatus, number>>(
    (acc, journey) => ({ ...acc, [journey.status]: acc[journey.status] + 1 }),
    { passed: 0, failed: 0, partial: 0, blocked: 0, skipped: 0 },
  );

  return (
    <div className="space-y-6">
      <StatStrip>
        <StatCard label="Passed" value={counts.passed} icon={CircleCheck} tone={counts.passed ? 'success' : 'default'} />
        <StatCard label="Failed" value={counts.failed} icon={CircleX} tone={counts.failed ? 'danger' : 'default'} />
        <StatCard label="Partial" value={counts.partial} icon={TriangleAlert} tone={counts.partial ? 'warning' : 'default'} />
        <StatCard label="Blocked" value={counts.blocked} icon={Ban} tone={counts.blocked ? 'warning' : 'default'} />
        <StatCard label="Skipped" value={counts.skipped} icon={CircleDashed} />
      </StatStrip>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {journeys.map((journey) => (
          <JourneyCard key={journey.id} runId={runId} journey={journey} />
        ))}
      </div>
    </div>
  );
}

function JourneyCard({ runId, journey }: { runId: string; journey: Journey }) {
  const status = JOURNEY_STATUS[journey.status];
  const StatusIcon = status.icon;
  const headingId = `journey-${journey.id}`;
  return (
    <section aria-labelledby={headingId}>
      <header className="flex flex-col gap-2 px-4 pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 id={headingId} className="break-words text-[15px] font-semibold text-ink">
            {journey.name}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={status.variant}>
              <StatusIcon className="size-3" aria-hidden />
              {status.label}
            </Badge>
            <RequirementBadge requires={journey.requires} />
            {journey.category ? <Badge variant="outline">{CATEGORY_LABEL[journey.category] ?? journey.category}</Badge> : null}
          </div>
        </div>
        {journey.durationMs ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            <span className="mono tabular text-[12px]">{formatDuration(journey.durationMs)}</span>
          </span>
        ) : null}
      </header>
      <div className="space-y-4 px-4 pb-4 pt-3">
        {journey.reason ? (
          <p
            className={cn(
              'break-words rounded-md border px-3 py-2 text-sm text-ink',
              journey.status === 'failed'
                ? 'border-[#f2c4bf] bg-[#fdf1ef]'
                : journey.status === 'passed'
                  ? 'border-border bg-well text-muted-foreground'
                  : 'border-[#f0d6b3] bg-[#fdf6ec]',
            )}
          >
            {journey.reason}
          </p>
        ) : null}
        {journey.steps.length ? (
          <ol className="relative space-y-0">
            {journey.steps.map((step, i) => (
              <StepItem key={`${step.index}-${i}`} runId={runId} step={step} last={i === journey.steps.length - 1} position={i + 1} />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No steps ran.</p>
        )}
      </div>
    </section>
  );
}

function StepItem({ runId, step, last, position }: { runId: string; step: Step; last: boolean; position: number }) {
  const meta = STEP_STATUS[step.status];
  const Icon = meta.icon;
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last ? <span aria-hidden className="absolute bottom-1 left-[9.5px] top-6 w-px bg-border" /> : null}
      <span
        className={cn('relative z-[1] flex size-5 shrink-0 items-center justify-center bg-card', meta.className)}
        title={meta.label}
      >
        <Icon className="size-4" aria-hidden />
        <span className="sr-only">{meta.label}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="tabular text-[13px] text-muted-foreground">{position}.</span>
          <p className="min-w-0 break-words text-sm font-medium text-ink">{step.goal}</p>
        </div>
        {step.detail ? <p className="mt-0.5 break-words text-[13px] leading-relaxed text-muted-foreground">{step.detail}</p> : null}
        {step.url ? <p className="mono mt-0.5 truncate text-[12px] text-muted-foreground">{hostAndPath(step.url)}</p> : null}
        <div className={cn('mt-2 gap-3', step.evidenceId ? 'grid lg:grid-cols-[minmax(0,1fr)_14rem]' : '')}>
          {step.checks.length ? <ChecksTable checks={step.checks} /> : null}
          {step.evidenceId ? (
            <EvidenceThumb runId={runId} evidenceId={step.evidenceId} caption={`Step ${position}: ${step.goal}`} className="max-w-xs lg:max-w-none" />
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ChecksTable({ checks }: { checks: Check[] }) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[28rem] text-left text-[13px]">
        <caption className="sr-only">Checks</caption>
        <thead className="border-b border-border bg-well text-[12px] text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Check</th>
            <th scope="col" className="px-3 py-2 font-medium">Expected</th>
            <th scope="col" className="px-3 py-2 font-medium">Actual</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {checks.map((check, index) => (
            <tr key={`${check.name}-${index}`}>
              <td className="px-3 py-2 align-top font-medium text-ink">{check.name}</td>
              <td className="mono break-words px-3 py-2 align-top text-[12px] text-muted-foreground">{check.expected ?? '–'}</td>
              <td className={cn('mono break-words px-3 py-2 align-top text-[12px]', check.passed ? 'text-muted-foreground' : 'text-danger')}>{check.actual ?? '–'}</td>
              <td className="px-3 py-2 text-right align-top">
                {check.passed ? (
                  <Badge variant="success">
                    <CircleCheck className="size-3" aria-hidden />
                    Pass
                  </Badge>
                ) : (
                  <Badge variant="critical">
                    <CircleX className="size-3" aria-hidden />
                    Fail
                  </Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
