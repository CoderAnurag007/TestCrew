'use client';

import Link from 'next/link';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, FolderPlus, Loader2, Plus, Radar } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useSession } from '@/components/session-provider';
import { CreateProjectDialog, DIALOG_CLASS } from '@/components/pages/create-project-dialog';
import { byNewest, refetchWhileRunning } from '@/components/pages/format';
import { RunsTable, type RunRow } from '@/components/pages/runs-table';
import { NEW_WORKSPACE_EVENT, NEW_WORKSPACE_FLAG, useOpenSignal } from '@/components/shell/events';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState, PageHeader, SectionTitle, Skeleton, StatCard, StatStrip } from '@/components/ui/premium';
import { orgApi, projectApi, runApi } from '@/lib/queries';
import { ApiError } from '@/lib/api';

const RECENT_PROJECTS = 12;
const RECENT_RUNS = 8;

export default function DashboardPage() {
  const { currentOrg, isLoading, setCurrentOrgId, user } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [name, setName] = useState('');

  useOpenSignal(NEW_WORKSPACE_EVENT, NEW_WORKSPACE_FLAG, () => setOpen(true));

  const stats = useQuery({
    queryKey: ['stats', currentOrg?.id],
    queryFn: () => orgApi.stats(currentOrg!.id),
    enabled: Boolean(currentOrg),
  });

  const projects = useQuery({
    queryKey: ['projects', currentOrg?.id],
    queryFn: () => projectApi.list(currentOrg!.id),
    enabled: Boolean(currentOrg),
  });

  const recentProjects = (projects.data ?? []).slice(0, RECENT_PROJECTS);
  const runQueries = useQueries({
    queries: recentProjects.map((project) => ({
      queryKey: ['runs', project.id],
      queryFn: () => runApi.list(project.id),
      refetchInterval: refetchWhileRunning,
    })),
  });
  const runsLoading = projects.isLoading || runQueries.some((query) => query.isLoading);

  // When a run finishes, the workspace totals (findings, score) change too.
  const statusKey = runQueries.map((query) => (query.data ?? []).map((run) => run.status).join(',')).join('|');
  useEffect(() => {
    if (currentOrg) {
      void queryClient.invalidateQueries({ queryKey: ['stats', currentOrg.id] });
    }
  }, [statusKey, currentOrg, queryClient]);
  const recentRuns: RunRow[] = recentProjects
    .flatMap((project, index) =>
      (runQueries[index]?.data ?? []).map((run) => ({ ...run, projectName: project.name })),
    )
    .sort(byNewest)
    .slice(0, RECENT_RUNS);

  const createOrg = useMutation({
    mutationFn: orgApi.create,
    onSuccess: async (org) => {
      setCurrentOrgId(org.id);
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      setOpen(false);
      setName('');
      toast.success('Workspace created');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not create workspace'),
  });

  const score = stats.data?.averageQualityScore;
  const scoreTone = score == null ? 'default' : score >= 85 ? 'success' : score >= 60 ? 'warning' : 'danger';
  const hasProjects = (projects.data?.length ?? 0) > 0;

  return (
    <AppShell>
      <PageHeader
        eyebrow={user?.name ? `Signed in as ${user.name}` : undefined}
        title={currentOrg?.name ?? 'Overview'}
        description="How every project in this workspace is doing, and the audits that ran most recently."
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen(true)}>
              New workspace
            </Button>
            {currentOrg ? (
              <Button onClick={() => setProjectOpen(true)}>
                <Plus />
                New project
              </Button>
            ) : null}
          </>
        }
        className="mb-8"
      />

      {!isLoading && !currentOrg ? (
        <EmptyState
          icon={Building2}
          title="Create your first workspace"
          description="A workspace holds your projects, credentials and audit runs. You can invite teammates to it later."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus />
              Create workspace
            </Button>
          }
        />
      ) : (
        <>
          {stats.isLoading || isLoading ? (
            <Skeleton className="h-[92px] rounded-lg" />
          ) : (
            <StatStrip>
              <StatCard
                label="Quality score"
                tone={scoreTone}
                value={score == null ? '–' : Math.round(score)}
                hint={score == null ? 'After your first completed audit' : 'Average of completed audits'}
              />
              <StatCard
                label="Critical findings"
                tone={(stats.data?.criticalFindings ?? 0) > 0 ? 'danger' : 'default'}
                value={stats.data?.criticalFindings ?? 0}
                hint="Fix these first"
              />
              <StatCard label="Open findings" value={stats.data?.openFindings ?? 0} hint="Not fixed or dismissed" />
              <StatCard label="Projects" value={stats.data?.totalProjects ?? 0} hint="Apps in this workspace" />
              <StatCard label="Audit runs" value={stats.data?.totalRuns ?? 0} hint="All time" />
            </StatStrip>
          )}
          {stats.isError ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              Could not load workspace stats.
            </p>
          ) : null}

          <section className="mt-12">
            <SectionTitle
              title="Recent runs"
              description="Latest audits across your projects."
              action={
                hasProjects ? (
                  <Link href="/projects" className="text-[13px] font-medium text-cobalt hover:underline">
                    All projects
                  </Link>
                ) : null
              }
            />
            {!projects.isLoading && !hasProjects && !projects.isError ? (
              <EmptyState
                icon={FolderPlus}
                title="Create your first project"
                description="Add the URL of a web app. TestCrew explores it, writes and runs tests, and reports what is broken."
                action={
                  <Button onClick={() => setProjectOpen(true)}>
                    <Plus />
                    Create your first project
                  </Button>
                }
              />
            ) : (
              <Card className="overflow-hidden">
                <RunsTable
                  runs={recentRuns}
                  loading={runsLoading}
                  error={projects.isError}
                  showProject
                  empty={
                    <EmptyState
                      icon={Radar}
                      title="No audits yet"
                      description="Open a project and start an audit. Results appear here as runs finish."
                      action={
                        <Button variant="outline" asChild>
                          <Link href="/projects">Go to projects</Link>
                        </Button>
                      }
                      className="m-3 border-0 bg-transparent py-10"
                    />
                  }
                />
              </Card>
            )}
          </section>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={DIALOG_CLASS}>
          <DialogHeader className="mb-6 pr-6">
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>Workspaces keep projects, secrets and audit history separate.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              createOrg.mutate({ name });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                placeholder="Acme QA"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={createOrg.isPending}>
                {createOrg.isPending ? <Loader2 className="animate-spin" /> : null}
                {createOrg.isPending ? 'Creating…' : 'Create workspace'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <CreateProjectDialog
        open={projectOpen}
        onOpenChange={setProjectOpen}
        organizationId={currentOrg?.id}
        openAfterCreate
      />
    </AppShell>
  );
}
