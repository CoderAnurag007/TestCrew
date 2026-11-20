'use client';

import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Building2, FolderPlus, Plus } from 'lucide-react';
import type { Run } from '@auditor/shared';
import { AppShell } from '@/components/layout/app-shell';
import { useSession } from '@/components/session-provider';
import { CreateProjectDialog } from '@/components/pages/create-project-dialog';
import {
  byNewest,
  fullDate,
  hostOf,
  timeAgo,
  refetchWhileRunning,
} from '@/components/pages/format';
import { SafetyBadge } from '@/components/pages/project-header';
import { NEW_PROJECT_EVENT, NEW_PROJECT_FLAG, useOpenSignal } from '@/components/shell/events';
import { RunStatusDot, ScorePill } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/premium';
import { projectApi, runApi } from '@/lib/queries';
import { cn } from '@/lib/utils';

const COLUMNS = 'md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_150px_56px_96px]';

export default function ProjectsPage() {
  const { currentOrg, isLoading: sessionLoading } = useSession();
  const [open, setOpen] = useState(false);

  useOpenSignal(NEW_PROJECT_EVENT, NEW_PROJECT_FLAG, () => setOpen(true), !sessionLoading);

  const projects = useQuery({
    queryKey: ['projects', currentOrg?.id],
    queryFn: () => projectApi.list(currentOrg!.id),
    enabled: Boolean(currentOrg),
  });

  const runQueries = useQueries({
    queries: (projects.data ?? []).map((project) => ({
      queryKey: ['runs', project.id],
      queryFn: () => runApi.list(project.id),
      refetchInterval: refetchWhileRunning,
    })),
  });
  const latestRun = new Map<string, Run | undefined>();
  const runsLoaded = new Map<string, boolean>();
  (projects.data ?? []).forEach((project, index) => {
    const result = runQueries[index];
    runsLoaded.set(project.id, Boolean(result?.isFetched));
    latestRun.set(project.id, result?.data ? [...result.data].sort(byNewest)[0] : undefined);
  });

  const count = projects.data?.length ?? 0;

  return (
    <AppShell>
      <PageHeader
        eyebrow={currentOrg?.name ?? 'Projects'}
        title="Projects"
        description="Each project is one web app Snaghunt audits, with its own environments, credentials and safety rules."
        actions={
          <Button disabled={!currentOrg} onClick={() => setOpen(true)}>
            <Plus />
            New project
          </Button>
        }
        className="mb-8"
      />

      {!sessionLoading && !currentOrg ? (
        <EmptyState
          icon={Building2}
          title="Create a workspace first"
          description="Workspaces hold your projects, secrets and audit history. Create one from the Overview page."
          action={
            <Button asChild>
              <Link href="/dashboard?workspace=1">Create workspace</Link>
            </Button>
          }
        />
      ) : projects.isLoading || sessionLoading ? (
        <div
          className="divide-y divide-border overflow-hidden rounded-lg border border-border"
          aria-busy="true"
          aria-label="Loading projects"
        >
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="px-5 py-3.5">
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </div>
      ) : projects.isError ? (
        <Card className="p-5">
          <p className="text-sm text-danger" role="alert">
            Could not load projects. Refresh the page to try again.
          </p>
        </Card>
      ) : count === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="No projects yet"
          description="Add the URL of an app you want audited. Snaghunt starts in read-only mode, so nothing in your app changes."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus />
              Create your first project
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div
            className={cn(
              'hidden h-9 items-center gap-4 border-b border-border bg-well px-5 text-[13px] text-muted-foreground md:grid',
              COLUMNS,
            )}
            aria-hidden
          >
            <span>Project</span>
            <span>URL</span>
            <span>Last run</span>
            <span>Score</span>
            <span className="text-right">Run at</span>
          </div>
          <ul className="divide-y divide-border">
            {projects.data?.map((project) => {
              const run = latestRun.get(project.id);
              const loaded = runsLoaded.get(project.id);
              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className={cn(
                      'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-well focus-visible:bg-well focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cobalt',
                      COLUMNS,
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{project.name}</span>
                      {project.safetyMode === 'FULL' ? (
                        <SafetyBadge mode={project.safetyMode} />
                      ) : null}
                    </div>
                    <span
                      className="mono order-3 col-span-2 truncate text-xs text-muted-foreground md:order-none md:col-span-1 md:text-[13px]"
                      title={project.baseUrl}
                    >
                      {hostOf(project.baseUrl)}
                    </span>
                    <div className="justify-self-end md:justify-self-start">
                      {run ? (
                        <RunStatusDot status={run.status} />
                      ) : loaded ? (
                        <span className="text-[13px] text-muted-foreground">Not audited yet</span>
                      ) : (
                        <Skeleton className="h-5 w-24" />
                      )}
                    </div>
                    <div className="hidden md:block">
                      {run ? <ScorePill score={run.qualityScore} /> : <ScorePill score={null} />}
                    </div>
                    <div
                      className="hidden text-right text-[13px] text-muted-foreground md:block"
                      title={run ? fullDate(run.createdAt) : undefined}
                    >
                      {run ? timeAgo(run.createdAt) : '–'}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <CreateProjectDialog
        open={open}
        onOpenChange={setOpen}
        organizationId={currentOrg?.id}
        openAfterCreate
      />
    </AppShell>
  );
}
