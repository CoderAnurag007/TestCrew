'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FindingChange, FindingSeverity, FindingStatus } from '@auditor/shared';
import { Bug, CircleCheck, ExternalLink, EyeOff, Globe, Lightbulb, ListOrdered, RotateCcw, ThumbsDown, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/premium';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { EvidenceThumb } from './evidence';
import { TicketBar } from './ticket-button';
import { SEVERITY_LABEL, SEVERITY_ORDER, asSteps, severityVariant, type RunFinding } from './run-utils';

/* One severity ramp, darkest = most severe (matches the Badge severity variants). */
const SEVERITY_BAR: Record<FindingSeverity, string> = {
  CRITICAL: 'bg-[#c42b1c]',
  HIGH: 'bg-[#e0695d]',
  MEDIUM: 'bg-[#a85a00]',
  LOW: 'bg-[#8a8f97]',
  INFO: 'bg-[#cfd3d9]',
};

export function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  return (
    <Badge variant={severityVariant(severity)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', SEVERITY_BAR[severity])} />
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

export function ChangeBadge({ change }: { change?: FindingChange }) {
  if (!change) {
    return null;
  }
  if (change === 'NEW') return <Badge variant="new">New</Badge>;
  if (change === 'REGRESSED') return <Badge variant="regressed">Regressed</Badge>;
  return <Badge variant="muted">Recurring</Badge>;
}

function useIsLarge(): boolean {
  const [large, setLarge] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)');
    const update = () => setLarge(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return large;
}

type Filter = 'ALL' | FindingSeverity;

export function FindingsPanel({
  runId,
  findings,
  pending,
  onStatus,
  onNotABug,
}: {
  runId: string;
  findings: RunFinding[];
  pending: boolean;
  onStatus: (findingId: string, status: FindingStatus) => void;
  onNotABug: (findingId: string, reason?: string) => void;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const large = useIsLarge();

  const hiddenCount = findings.filter((item) => item.suppressed).length;
  const visible = useMemo(
    () => (showHidden ? findings : findings.filter((item) => !item.suppressed)),
    [findings, showHidden],
  );
  const counts = useMemo(() => {
    const result: Record<FindingSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    for (const item of visible) result[item.severity] += 1;
    return result;
  }, [visible]);
  const filtered = filter === 'ALL' ? visible : visible.filter((item) => item.severity === filter);
  const groups = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: filtered
      .filter((item) => item.severity === severity)
      .sort((left, right) => (right.confidence ?? 0.5) - (left.confidence ?? 0.5)),
  })).filter((group) => group.items.length);
  const ordered = groups.flatMap((group) => group.items);
  const selected = ordered.find((item) => item.id === selectedId) ?? (large ? ordered[0] : undefined);

  const select = (id: string) => {
    setSelectedId(id);
    if (!large) setDialogOpen(true);
  };

  if (!findings.length) {
    return (
      <EmptyState
        icon={CircleCheck}
        title="No findings captured"
        description="Nothing looked broken so far. Findings appear here as the audit explores and runs tests."
      />
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filter findings by severity">
          <FilterChip active={filter === 'ALL'} onClick={() => setFilter('ALL')}>
            All <span className="tabular text-muted-foreground">{visible.length}</span>
          </FilterChip>
          {SEVERITY_ORDER.filter((severity) => counts[severity] > 0).map((severity) => (
            <FilterChip key={severity} active={filter === severity} onClick={() => setFilter(severity)}>
              <span aria-hidden className={cn('size-1.5 rounded-full', SEVERITY_BAR[severity])} />
              {SEVERITY_LABEL[severity]} <span className="tabular text-muted-foreground">{counts[severity]}</span>
            </FilterChip>
          ))}
        </div>
        {hiddenCount > 0 ? (
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 rounded accent-[var(--cobalt)]"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
            />
            <EyeOff className="size-3.5" aria-hidden />
            Show hidden ({hiddenCount})
          </label>
        ) : null}

        {groups.length ? (
          <div className="overflow-hidden rounded-lg border border-border bg-card xl:max-h-[calc(100vh-220px)] xl:overflow-y-auto">
            {groups.map((group) => (
              <section key={group.severity} aria-label={`${SEVERITY_LABEL[group.severity]} findings`} className="-mb-px">
                <h3 className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-well px-4 py-1.5 text-[13px] font-medium text-muted-foreground">
                  <span aria-hidden className={cn('size-1.5 rounded-full', SEVERITY_BAR[group.severity])} />
                  {SEVERITY_LABEL[group.severity]}
                  <span className="tabular">{group.items.length}</span>
                </h3>
                <ul className="divide-y divide-border border-b border-border">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <FindingRow item={item} active={selected?.id === item.id} onSelect={() => select(item.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[#cfd3d9] px-4 py-8 text-center text-sm text-muted-foreground">
            {visible.length ? 'No findings at this severity.' : 'All findings in this run are hidden.'}
          </p>
        )}
      </div>

      <div className="hidden min-w-0 xl:block">
        {selected ? (
          <div className="sticky top-6">
            <FindingDetail
              key={selected.id}
              runId={runId}
              finding={selected}
              pending={pending}
              onStatus={(status) => onStatus(selected.id, status)}
              onNotABug={(reason) => onNotABug(selected.id, reason)}
            />
          </div>
        ) : (
          <EmptyState icon={Target} title="Select a finding" description="Pick a finding to see steps, evidence and a suggested fix." />
        )}
      </div>

      {!large ? (
        <Dialog open={dialogOpen && Boolean(selected)} onOpenChange={setDialogOpen}>
          <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto p-0">
            <DialogHeader className="sr-only">
              <DialogTitle>{selected?.title ?? 'Finding'}</DialogTitle>
              <DialogDescription>Finding details</DialogDescription>
            </DialogHeader>
            {selected ? (
              <FindingDetail
                key={selected.id}
                runId={runId}
                finding={selected}
                pending={pending}
                bare
                onStatus={(status) => onStatus(selected.id, status)}
                onNotABug={(reason) => onNotABug(selected.id, reason)}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors',
        active ? 'border-cobalt bg-[#f0f3fd] text-cobalt' : 'border-border bg-card text-ink hover:bg-well',
      )}
    >
      {children}
    </button>
  );
}

/** The first sentence of a description, for the list. */
function firstSentence(text: string): string {
  const urls = text.match(/https?:\/\/[^\s,]+[^\s,.;)]/g) ?? [];
  // A list of addresses: stop before it ("These images did not load: https://…" → "These images did not load").
  // One or two addresses: keep the sentence, shortened to "site.com/path".
  const source =
    urls.length >= 3
      ? text.split(/https?:\/\//)[0]!.trim().replace(/[:,]\s*$/, '')
      : urls.reduce((out, url) => out.replace(url, url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')), text.trim());
  const match = /^(.{20,220}?[.!?])(\s|$)/.exec(source);
  return match ? match[1]! : source;
}

/** "https://site.com/a/b?x" → "/a/b", for display. */
function pagePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

function changeNote(change?: FindingChange): string | null {
  if (change === 'NEW') return 'New in this run';
  if (change === 'REGRESSED') return 'Came back after being fixed';
  if (change === 'RECURRING') return 'Also in the last run';
  return null;
}

function FindingRow({ item, active, onSelect }: { item: RunFinding; active: boolean; onSelect: () => void }) {
  const note = changeNote(item.change);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full gap-3 border-l-2 py-3.5 pl-3.5 pr-4 text-left transition-colors focus-visible:outline-offset-[-2px]',
        active ? 'border-l-ink bg-well' : 'border-l-transparent hover:bg-well',
        item.suppressed && 'opacity-60',
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[14.5px] font-medium leading-snug text-ink">{item.title}</span>
        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-[#4a4f57]">{firstSentence(item.description)}</p>
        <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {item.url ? (
            <span className="flex min-w-0 items-center gap-1">
              <Globe className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{pagePath(item.url)}</span>
            </span>
          ) : null}
          {note ? <span className={item.change === 'NEW' || item.change === 'REGRESSED' ? 'text-cobalt' : undefined}>{note}</span> : null}
          {item.suppressed ? <span>Hidden</span> : null}
        </p>
      </div>
    </button>
  );
}

const STATUS_LABEL: Partial<Record<FindingStatus, string>> = {
  OPEN: 'Open',
  CONFIRMED: 'Confirmed',
  IGNORED: 'Ignored',
  RESOLVED: 'Fixed',
  ACKNOWLEDGED: 'Acknowledged',
  DISMISSED: 'Not a bug',
};

export function FindingDetail({
  runId,
  finding,
  pending,
  bare = false,
  onStatus,
  onNotABug,
}: {
  runId: string;
  finding: RunFinding;
  pending: boolean;
  bare?: boolean;
  onStatus: (status: FindingStatus) => void;
  onNotABug: (reason?: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const dismissed = finding.status === 'DISMISSED' || finding.status === 'IGNORED' || Boolean(finding.suppressed);
  const screenshots = (finding.evidence ?? []).filter(
    (item) => item.type === 'SCREENSHOT' || item.contentType.startsWith('image/'),
  );
  const steps = asSteps(finding.steps);
  const note = changeNote(finding.change);

  const body = (
    <article className="space-y-7">
      <header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <SeverityBadge severity={finding.severity} />
          {note ? <span className="text-[13px] text-muted-foreground">{note}</span> : null}
          {finding.suppressed ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <EyeOff className="size-3.5" aria-hidden /> Hidden in future runs
            </span>
          ) : null}
        </div>
        <h2 className="mt-3 pr-8 text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">{finding.title}</h2>
        {finding.url ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            On page{' '}
            <a
              href={finding.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 align-bottom text-cobalt underline-offset-4 hover:underline"
            >
              <span className="truncate">{pagePath(finding.url)}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          </p>
        ) : null}
      </header>

      <Section title="What’s wrong">
        <Description text={finding.description} />
      </Section>

      {steps.length ? (
        <Section title="How to reproduce" icon={<ListOrdered className="size-3.5" aria-hidden />}>
          <ol className="space-y-2.5">
            {steps.map((step, index) => (
              <li key={`${index}-${step}`} className="flex gap-3">
                <span className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[12px] font-medium text-ink">
                  {index + 1}
                </span>
                <span className="max-w-[60ch] text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{step}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {finding.expected || finding.actual ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-[13px] font-medium text-muted-foreground">What should happen</h3>
            <p className="mt-1.5 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{finding.expected || '—'}</p>
          </section>
          <section className="rounded-lg border border-[#f2c4bf] bg-[#fdf6f5] p-4">
            <h3 className="text-[13px] font-medium text-danger">What actually happened</h3>
            <p className="mt-1.5 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{finding.actual || '—'}</p>
          </section>
        </div>
      ) : null}

      {finding.recommendation || finding.rootCauseHypothesis ? (
        <section className="rounded-lg bg-well p-4">
          <h3 className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <Lightbulb className="size-3.5 text-muted-foreground" aria-hidden /> How to fix
          </h3>
          {finding.recommendation ? (
            <p className="mt-1.5 max-w-[64ch] text-[15px] leading-7 text-ink">{finding.recommendation}</p>
          ) : null}
          {finding.rootCauseHypothesis ? (
            <p className="mt-2 max-w-[64ch] text-[14px] leading-6 text-[#3d4148]">
              <span className="font-medium text-ink">Likely cause: </span>
              {finding.rootCauseHypothesis}
            </p>
          ) : null}
        </section>
      ) : null}

      {screenshots.length ? (
        <Section title={screenshots.length === 1 ? 'Screenshot' : `Screenshots (${screenshots.length})`}>
          <div className="grid gap-3 sm:grid-cols-2">
            {screenshots.map((item) => (
              <EvidenceThumb key={item.id} runId={runId} evidenceId={item.id} caption={screenshotCaption(item.fileName)} />
            ))}
          </div>
        </Section>
      ) : null}

      <TicketBar runId={runId} finding={finding} />

      <footer className="space-y-3 border-t border-border pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Mark as</span>
            <div className="inline-flex w-fit flex-wrap rounded-md border border-border bg-well p-0.5" role="group" aria-label="Finding status">
              {(['OPEN', 'CONFIRMED', 'IGNORED', 'RESOLVED'] as FindingStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={pending}
                  aria-pressed={finding.status === status}
                  onClick={() => onStatus(status)}
                  className={cn(
                    'h-7 rounded-[4px] px-2.5 text-[13px] font-medium transition-colors disabled:opacity-50',
                    finding.status === status ? 'bg-card text-ink ring-1 ring-border' : 'text-muted-foreground hover:text-ink',
                  )}
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          </div>
          {dismissed ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => onStatus('OPEN')}>
              <RotateCcw /> Reopen
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirmOpen(true)}>
              <ThumbsDown /> Not a bug
            </Button>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {finding.category.charAt(0) + finding.category.slice(1).toLowerCase().replace(/_/g, ' ')} · {Math.round((finding.confidence ?? 0.5) * 100)}% confidence
          {finding.mergedCount && finding.mergedCount > 1 ? ` · seen ${finding.mergedCount} times in this run` : ''}
        </p>
      </footer>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>Not a bug?</DialogTitle>
            <DialogDescription>
              The finding is dismissed and hidden in future runs of this project. You can unhide it in project settings.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              onNotABug(reason.trim() || undefined);
              setConfirmOpen(false);
              setReason('');
            }}
          >
            <div className="space-y-2">
              <Label htmlFor={`dismiss-reason-${finding.id}`}>Reason (optional)</Label>
              <Textarea
                id={`dismiss-reason-${finding.id}`}
                className="min-h-16"
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Hide in future runs</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </article>
  );

  if (bare) {
    return <div className="p-5 sm:p-6">{body}</div>;
  }
  return <Card className="p-6 lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto lg:p-8">{body}</Card>;
}

/**
 * A finding's explanation. When it lists many addresses (broken images, failing
 * requests), the sentence is shown first and the addresses become a short list
 * that can be expanded, instead of one wall of URLs.
 */
function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const urls = text.match(/https?:\/\/[^\s,]+[^\s,.;)]/g) ?? [];
  if (urls.length < 3) {
    return <p className="max-w-[64ch] text-[15px] leading-7 text-ink [overflow-wrap:anywhere]">{text}</p>;
  }
  const first = text.indexOf(urls[0]!);
  const lastUrl = urls[urls.length - 1]!;
  const end = text.lastIndexOf(lastUrl) + lastUrl.length;
  const lead = text.slice(0, first).trim().replace(/[:,]\s*$/, '');
  const tail = text
    .slice(end)
    .replace(/^[\s,.…;]+/, '')
    .trim();
  const unique = [...new Set(urls)];
  const shown = expanded ? unique : unique.slice(0, 4);
  return (
    <div className="max-w-[64ch] space-y-3">
      {lead ? <p className="text-[15px] leading-7 text-ink">{lead}:</p> : null}
      <ul className="space-y-1 rounded-md border border-border bg-card px-3 py-2">
        {shown.map((url) => (
          <li key={url} className="mono text-[12.5px] leading-5 text-[#3d4148] [overflow-wrap:anywhere]">
            {url}
          </li>
        ))}
        {unique.length > 4 ? (
          <li className="pt-1">
            <button type="button" onClick={() => setExpanded((value) => !value)} className="text-[13px] font-medium text-cobalt hover:underline">
              {expanded ? 'Show fewer' : `Show all ${unique.length}`}
            </button>
          </li>
        ) : null}
      </ul>
      {tail ? <p className="text-[15px] leading-7 text-ink [overflow-wrap:anywhere]">{tail.charAt(0).toUpperCase() + tail.slice(1)}</p> : null}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

/** "step-3.png" → "Step 3", "after.png" → "After", hashes → "Page". */
function screenshotCaption(fileName?: string | null): string {
  const name = (fileName ?? '').replace(/\.(png|jpe?g|webp)$/i, '');
  if (!name) return 'Screenshot';
  if (/^[a-f0-9]{24,}$/i.test(name)) return 'The page';
  const step = /step-(\d+)/i.exec(name);
  if (step) return `Step ${step[1]}`;
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]+/g, ' ');
}

/** Compact list for the overview: top open findings, most severe first. */
export function TopFindings({ findings, onOpen }: { findings: RunFinding[]; onOpen: () => void }) {
  const top = findings
    .filter((item) => !item.suppressed)
    .sort((left, right) => SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity))
    .slice(0, 5);
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Bug className="size-4 text-muted-foreground" aria-hidden /> Top findings
        </h3>
        {top.length ? (
          <Button variant="ghost" size="sm" onClick={onOpen}>
            View all
          </Button>
        ) : null}
      </div>
      {top.length ? (
        <ul className="divide-y divide-border">
          {top.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', SEVERITY_BAR[item.severity])} />
                <span className="truncate text-ink">{item.title}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <ChangeBadge change={item.change} />
                <SeverityBadge severity={item.severity} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No open findings.</p>
      )}
    </Card>
  );
}
