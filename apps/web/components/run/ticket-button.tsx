'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ExternalLink, Loader2, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import type { TicketProvider } from '@auditor/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError } from '@/lib/api';
import { launchApi } from '@/lib/queries';
import type { RunFinding } from './run-utils';

const NAMES: Record<TicketProvider, string> = { github: 'GitHub', jira: 'Jira', linear: 'Linear' };
const TRACKERS: TicketProvider[] = ['github', 'jira', 'linear'];

/** "Create ticket" for a finding, or a link to the ticket once it exists. */
export function TicketBar({ runId, finding }: { runId: string; finding: RunFinding }) {
  const queryClient = useQueryClient();
  const integrations = useQuery({
    queryKey: ['integrations', finding.projectId],
    queryFn: () => launchApi.integrations(finding.projectId),
    staleTime: 60_000,
  });
  const create = useMutation({
    mutationFn: (provider: TicketProvider) => launchApi.createTicket(runId, finding.id, provider),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      toast.success(result.existing ? 'This finding already has a ticket' : `Ticket created in ${NAMES[result.provider]}`, {
        action: { label: 'Open', onClick: () => window.open(result.url, '_blank', 'noopener,noreferrer') },
      });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not create the ticket'),
  });

  if (finding.ticketUrl) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <p className="flex items-center gap-2 text-[14px] text-ink">
          <Ticket className="size-4 text-muted-foreground" aria-hidden />
          Ticket in {NAMES[finding.ticketProvider as TicketProvider] ?? 'your tracker'}
        </p>
        <a
          href={finding.ticketUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[14px] font-medium text-cobalt underline-offset-4 hover:underline"
        >
          Open ticket <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </section>
    );
  }

  const connected = TRACKERS.filter((provider) => integrations.data?.some((item) => item.provider === provider && item.hasSecret));

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <p className="text-[14px] text-ink">
        Send this to your developers
        <span className="block text-[13px] text-muted-foreground">
          {connected.length
            ? 'The ticket carries the steps, what went wrong and how to fix it.'
            : 'Connect GitHub, Jira or Linear to create tickets in one click.'}
        </span>
      </p>
      {connected.length === 0 ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/projects/${finding.projectId}/settings?tab=integrations`}>Connect a tracker</Link>
        </Button>
      ) : connected.length === 1 ? (
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate(connected[0]!)}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Ticket />}
          Create {NAMES[connected[0]!]} ticket
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Ticket />}
              Create ticket
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {connected.map((provider) => (
              <DropdownMenuItem key={provider} onSelect={() => create.mutate(provider)}>
                {NAMES[provider]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </section>
  );
}
