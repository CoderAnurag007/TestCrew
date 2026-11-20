'use client';

import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ChevronRight,
  ChevronsUpDown,
  CircleSlash,
  CircleX,
  Download,
  ExternalLink,
  MousePointerClick,
  PanelTop,
  RefreshCw,
  Search,
  Send,
  ShieldBan,
  SkipForward,
  type LucideIcon,
} from 'lucide-react';
import type { ControlOutcome } from '@auditor/shared';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState, StatCard } from '@/components/ui/premium';
import { cn } from '@/lib/utils';
import { formatDuration, hostAndPath } from './run-utils';

/* Interaction map from the report payload. Every field is optional: older runs have none. */

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null;
const recs = (value: unknown): Rec[] => (Array.isArray(value) ? value.map(rec).filter((item): item is Rec => item !== null) : []);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.length ? value : undefined);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];
type Tone = 'default' | 'success' | 'warning' | 'danger' | 'live';

export const OUTCOMES: Record<ControlOutcome, { label: string; icon: LucideIcon; variant: BadgeVariant; tone: Tone }> = {
  // Working outcomes are neutral; color is kept for the ones that need attention.
  navigates: { label: 'Navigates', icon: ArrowUpRight, variant: 'outline', tone: 'default' },
  opens_overlay: { label: 'Opens overlay', icon: PanelTop, variant: 'outline', tone: 'default' },
  changes_content: { label: 'Changes content', icon: RefreshCw, variant: 'outline', tone: 'default' },
  expands: { label: 'Expands', icon: ChevronsUpDown, variant: 'outline', tone: 'default' },
  opens_window: { label: 'Opens window', icon: ExternalLink, variant: 'outline', tone: 'default' },
  downloads: { label: 'Downloads', icon: Download, variant: 'outline', tone: 'default' },
  submits: { label: 'Submits', icon: Send, variant: 'outline', tone: 'default' },
  blocked_by_safety: { label: 'Blocked by safety', icon: ShieldBan, variant: 'muted', tone: 'default' },
  no_effect: { label: 'No effect', icon: CircleSlash, variant: 'warning', tone: 'warning' },
  error: { label: 'Error', icon: CircleX, variant: 'high', tone: 'danger' },
  skipped: { label: 'Skipped', icon: SkipForward, variant: 'muted', tone: 'default' },
};
const OUTCOME_KEYS = Object.keys(OUTCOMES) as ControlOutcome[];

function outcomeOf(value: unknown): ControlOutcome | null {
  return typeof value === 'string' && value in OUTCOMES ? (value as ControlOutcome) : null;
}

export function OutcomeBadge({ outcome }: { outcome: string | undefined }) {
  const key = outcomeOf(outcome);
  if (!key) {
    return outcome ? <Badge variant="muted">{outcome}</Badge> : null;
  }
  const meta = OUTCOMES[key];
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant}>
      <Icon className="size-3" aria-hidden />
      {meta.label}
    </Badge>
  );
}

type Overlay = {
  title?: string;
  kind?: string;
  controls: number;
  probed: Array<{ label: string; outcome?: string; detail?: string }>;
  closedBy?: string;
  closed?: boolean;
  escapeCloses: boolean | null;
};

type Control = {
  label: string;
  kind?: string;
  role?: string;
  outcome: ControlOutcome | null;
  rawOutcome?: string;
  detail?: string;
  destination?: string;
  status?: number;
  overlay?: Overlay;
  change?: string;
  blockedRequest?: string;
  error?: string;
};

type Screen = { url?: string; title?: string; controlsFound: number; controls: Control[] };

function parseOverlay(value: unknown): Overlay | undefined {
  const o = rec(value);
  if (!o) return undefined;
  return {
    title: str(o.title),
    kind: str(o.kind),
    controls: num(o.controls),
    probed: recs(o.probed).map((p) => ({ label: str(p.label) ?? 'Unlabelled', outcome: str(p.outcome), detail: str(p.detail) })),
    closedBy: str(o.closedBy),
    closed: typeof o.closed === 'boolean' ? o.closed : undefined,
    escapeCloses: typeof o.escapeCloses === 'boolean' ? o.escapeCloses : null,
  };
}

function parseInteractions(payload: Rec) {
  const map = rec(payload.interactions);
  if (!map) return null;
  const screens: Screen[] = recs(map.screens).map((screen) => ({
    url: str(screen.url),
    title: str(screen.title),
    controlsFound: num(screen.controlsFound),
    controls: recs(screen.controls).map((control) => ({
      label: str(control.label) ?? 'Unlabelled control',
      kind: str(control.kind),
      role: str(control.role),
      outcome: outcomeOf(control.outcome),
      rawOutcome: str(control.outcome),
      detail: str(control.detail),
      destination: str(control.destination),
      status: typeof control.status === 'number' ? control.status : undefined,
      overlay: parseOverlay(control.overlay),
      change: str(control.change),
      blockedRequest: str(control.blockedRequest),
      error: str(control.error),
    })),
  }));
  const totalsRec = rec(map.totals) ?? {};
  const totals = Object.fromEntries(OUTCOME_KEYS.map((key) => [key, num(totalsRec[key])])) as Record<ControlOutcome, number>;
  // Fall back to counting when totals are missing.
  if (!Object.values(totals).some(Boolean)) {
    for (const screen of screens) for (const control of screen.controls) if (control.outcome) totals[control.outcome] += 1;
  }
  const probed = num(map.probed) || screens.reduce((sum, screen) => sum + screen.controls.length, 0);
  return { screens, totals, probed, durationMs: num(map.durationMs), truncated: map.truncated === true };
}

export function InteractionsView({ payload }: { payload: Rec }) {
  const data = useMemo(() => parseInteractions(payload), [payload]);
  const [filter, setFilter] = useState<Set<ControlOutcome>>(() => new Set());
  const [query, setQuery] = useState('');

  if (!data) {
    return (
      <EmptyState
        icon={MousePointerClick}
        title="No interaction map for this run"
        description="When the interaction map is on in the project's test plan, every control the audit clicks is listed here with what it did."
      />
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (control: Control) =>
    (filter.size === 0 || (control.outcome !== null && filter.has(control.outcome))) &&
    (!q ||
      [control.label, control.detail, control.destination, control.change, control.blockedRequest, control.error, control.overlay?.title]
        .some((text) => (text ?? '').toLowerCase().includes(q)));
  const visibleScreens = data.screens
    .map((screen) => ({ screen, controls: screen.controls.filter(matches) }))
    .filter((item) => item.controls.length > 0);
  const presentOutcomes = OUTCOME_KEYS.filter((key) => data.totals[key] > 0);
  const toggle = (key: ControlOutcome) =>
    setFilter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 [&>*]:-mb-px [&>*]:-mr-px [&>*]:border-b [&>*]:border-r [&>*]:border-border">
        <StatCard
          className="px-4 py-3.5"
          label="Controls probed"
          value={data.probed}
          icon={MousePointerClick}
          hint={`${data.screens.length} screen${data.screens.length === 1 ? '' : 's'}${data.durationMs ? ` in ${formatDuration(data.durationMs)}` : ''}`}
        />
        {presentOutcomes.map((key) => (
          <StatCard key={key} className="px-4 py-3.5" label={OUTCOMES[key].label} value={data.totals[key]} icon={OUTCOMES[key].icon} tone={OUTCOMES[key].tone} />
        ))}
      </div>
      {data.truncated ? (
        <p className="rounded-lg border border-[#f0d6b3] bg-[#fdf6ec] px-4 py-2.5 text-sm text-ink">
          The time or control budget ran out, so some controls were not probed. Raise the limits in the project&apos;s test plan.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {presentOutcomes.length ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by outcome">
            {presentOutcomes.map((key) => {
              const active = filter.has(key);
              const Icon = OUTCOMES[key].icon;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(key)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors',
                    active ? 'border-cobalt bg-[#f0f3fd] text-cobalt' : 'border-border bg-card text-ink hover:bg-well',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {OUTCOMES[key].label}
                  <span className="tabular text-muted-foreground">{data.totals[key]}</span>
                </button>
              );
            })}
            {filter.size ? (
              <button
                type="button"
                onClick={() => setFilter(new Set())}
                className="h-8 rounded-md px-3 text-[13px] font-medium text-cobalt underline-offset-4 hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : (
          <span />
        )}
        <div className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search controls"
            placeholder="Search controls"
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {visibleScreens.length ? (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {visibleScreens.map(({ screen, controls }, index) => (
            <details
              key={`${screen.url ?? 'screen'}-${index}`}
              open={index < 3 || filter.size > 0 || Boolean(q)}
              className="group"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-well focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{screen.title || hostAndPath(screen.url) || 'Screen'}</div>
                  {screen.url ? <div className="mono truncate text-[12px] text-muted-foreground">{hostAndPath(screen.url)}</div> : null}
                </div>
                <span className="tabular shrink-0 text-[13px] text-muted-foreground">
                  {controls.length}
                  {controls.length !== screen.controls.length ? ` of ${screen.controls.length}` : ''}
                  {screen.controlsFound > screen.controls.length ? `, ${screen.controlsFound} found` : ''}
                </span>
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {controls.map((control, i) => (
                  <ControlRow key={`${control.label}-${i}`} control={control} />
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title={data.screens.length ? 'No controls match' : 'No controls were probed'}
          description={data.screens.length ? 'Try another search or clear the outcome filters.' : 'The audit found no clickable controls to probe.'}
        />
      )}
    </div>
  );
}

function ControlRow({ control }: { control: Control }) {
  return (
    <li className="py-3 pl-11 pr-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <OutcomeBadge outcome={control.rawOutcome} />
        <span className="min-w-0 break-words font-medium text-ink">{control.label}</span>
        {control.kind ? <span className="mono text-[12px] text-muted-foreground">{control.kind}</span> : null}
        {typeof control.status === 'number' ? (
          <Badge variant={control.status >= 400 ? 'critical' : 'outline'} className="mono">
            {control.status}
          </Badge>
        ) : null}
      </div>
      <div className="mt-1.5 space-y-1 text-[13px] leading-relaxed text-muted-foreground">
        {control.detail ? <p className="break-words">{control.detail}</p> : null}
        {control.destination ? (
          <p className="flex min-w-0 items-center gap-1">
            <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only">Destination: </span>
            <span className="mono truncate text-[12px]">{hostAndPath(control.destination)}</span>
          </p>
        ) : null}
        {control.change ? (
          <p className="break-words">
            <span className="font-medium text-ink">Changed: </span>
            {control.change}
          </p>
        ) : null}
        {control.blockedRequest ? (
          <p className="break-words text-warning">
            <span className="font-medium">Blocked request: </span>
            <span className="mono text-[12px]">{control.blockedRequest}</span>
          </p>
        ) : null}
        {control.error ? (
          <p className="break-words text-danger">
            <span className="font-medium">Error: </span>
            {control.error}
          </p>
        ) : null}
      </div>
      {control.overlay ? <OverlayCard overlay={control.overlay} /> : null}
    </li>
  );
}

const CLOSED_BY: Record<string, string> = {
  close_button: 'Close button',
  control: 'One of its own buttons',
  escape: 'Escape key',
  backdrop: 'Backdrop click',
  none: 'Could not close',
};

function OverlayCard({ overlay }: { overlay: Overlay }) {
  return (
    <div className="mt-2.5 rounded-md border border-border bg-well p-3">
      <div className="flex flex-wrap items-center gap-2">
        <PanelTop className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="min-w-0 break-words text-[13px] font-medium text-ink">{overlay.title ?? 'Untitled overlay'}</span>
        {overlay.kind ? <Badge variant="outline" className="capitalize">{overlay.kind}</Badge> : null}
        <span className="tabular text-[12px] text-muted-foreground">{overlay.controls} controls</span>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
        {overlay.closedBy ? (
          <div className="flex gap-1">
            <dt>Closed by:</dt>
            <dd className={cn('font-medium', overlay.closedBy === 'none' || overlay.closed === false ? 'text-danger' : 'text-ink')}>
              {CLOSED_BY[overlay.closedBy] ?? overlay.closedBy}
            </dd>
          </div>
        ) : null}
        {overlay.escapeCloses !== null ? (
          <div className="flex gap-1">
            <dt>Escape closes:</dt>
            <dd className={cn('font-medium', overlay.escapeCloses ? 'text-success' : 'text-warning')}>
              {overlay.escapeCloses ? 'Yes' : 'No'}
            </dd>
          </div>
        ) : null}
      </dl>
      {overlay.probed.length ? (
        <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
          {overlay.probed.map((item, index) => (
            <li key={`${item.label}-${index}`} className="flex flex-wrap items-center gap-2 text-[13px]">
              <OutcomeBadge outcome={item.outcome} />
              <span className="min-w-0 break-words text-ink">{item.label}</span>
              {item.detail ? <span className="min-w-0 break-words text-muted-foreground">{item.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
