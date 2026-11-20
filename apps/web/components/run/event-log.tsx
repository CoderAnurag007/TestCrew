'use client';

import { useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { EmptyState } from '@/components/ui/premium';
import type { RunDetail } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { eventStyle } from './live-view';

type RunEvent = NonNullable<RunDetail['events']>[number];

/** Full chronological worker log with a filter per event kind. */
export function EventLog({ events }: { events: RunEvent[] }) {
  const [kind, setKind] = useState<string>('all');
  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
    return [...counts.entries()];
  }, [events]);
  const shown = kind === 'all' ? events : events.filter((event) => event.kind === kind);
  const first = events[0];
  const start = first ? new Date(first.createdAt).getTime() : 0;

  if (!events.length) {
    return <EmptyState icon={ScrollText} title="No events yet" description="Worker events stream in here while the audit runs." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Filter events by kind">
        {[['all', events.length] as const, ...kinds].map(([key, count]) => (
          <button
            key={key}
            type="button"
            aria-pressed={kind === key}
            onClick={() => setKind(key)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium capitalize transition-colors',
              kind === key ? 'border-cobalt bg-[#f0f3fd] text-cobalt' : 'border-border bg-card text-ink hover:bg-well',
            )}
          >
            {key === 'all' ? 'All' : eventStyle(key).label} <span className="tabular text-muted-foreground">{count}</span>
          </button>
        ))}
      </div>
      <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {shown.map((event) => {
          const style = eventStyle(event.kind);
          const Icon = style.icon;
          const at = new Date(event.createdAt);
          const offset = Math.max(0, Math.round((at.getTime() - start) / 1000));
          return (
            <li key={event.id} className="flex gap-3 px-4 py-2.5">
              <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md', style.tone)} aria-hidden>
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm leading-snug', event.kind === 'error' ? 'text-danger' : event.kind === 'warning' ? 'text-warning' : 'text-ink')}>
                  <span className="sr-only">{style.label}: </span>
                  {event.message}
                </p>
                {event.url ? (
                  <p className="mono mt-0.5 truncate text-[12px] text-muted-foreground" title={event.url}>
                    {event.url}
                  </p>
                ) : null}
              </div>
              <time
                className="mono tabular shrink-0 pt-0.5 text-right text-[12px] leading-tight text-muted-foreground"
                dateTime={at.toISOString()}
                title={at.toLocaleString()}
              >
                {at.toLocaleTimeString()}
                <span className="block text-muted-foreground">+{offset}s</span>
              </time>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
