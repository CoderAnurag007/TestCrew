'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Radar } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { byNewest, timeAgo, refetchWhileRunning } from '@/components/pages/format';
import { ProjectHeader, StartAuditButton } from '@/components/pages/project-header';
import { RunsTable } from '@/components/pages/runs-table';
import { RunStatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, SectionTitle, StatCard, StatStrip } from '@/components/ui/premium';
import { projectApi, runApi } from '@/lib/queries';

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.get(projectId),
  });

  const runs = useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => runApi.list(projectId),
    refetchInterval: refetchWhileRunning,
  });

  const sorted = runs.data ? [...runs.data].sort(byNewest) : undefined;
  const lastRun = sorted?.[0];
  const lastScored = sorted?.find((run) => typeof run.qualityScore === 'number');
  const environments = project.data?.environments ?? [];
  const score = lastScored?.qualityScore;
  const scoreTone =
    typeof score !== 'number'
      ? 'default'
      : score >= 85
        ? 'success'
        : score >= 60
          ? 'warning'
          : 'danger';

  return (
    <AppShell>
      <ProjectHeader
        projectId={projectId}
        project={project.data}
        loading={project.isLoading}
        error={project.isError}
      />

      <StatStrip>
        <StatCard
          label="Latest run"
          value={
            lastRun ? (
              <RunStatusDot status={lastRun.status} className="text-sm" />
            ) : (
              <span className="text-base font-medium text-muted-foreground">No runs yet</span>
            )
          }
          hint={lastRun ? `Started ${timeAgo(lastRun.createdAt)}` : 'Start an audit to see results'}
        />
        <StatCard
          label="Quality score"
          tone={scoreTone}
          value={typeof score === 'number' ? Math.round(score) : '–'}
          hint={
            lastScored
              ? `From the run ${timeAgo(lastScored.createdAt)}`
              : 'After the first completed audit'
          }
        />
        <StatCard
          label="Latest tests passed"
          value={
            lastRun && typeof lastRun.testsGenerated === 'number' && lastRun.testsGenerated > 0
              ? `${lastRun.testsPassed ?? 0}/${lastRun.testsGenerated}`
              : '–'
          }
          tone={lastRun?.testsFailed ? 'danger' : 'default'}
          hint={
            lastRun?.testsFailed
              ? `${lastRun.testsFailed} failed in the latest run`
              : 'Passed of generated tests'
          }
        />
        <StatCard
          label="Total runs"
          value={runs.isLoading ? '–' : (runs.data?.length ?? 0)}
          hint="All audits for this project"
        />
      </StatStrip>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section>
          <SectionTitle
            title="Recent runs"
            description="The last five audits of this app."
            action={
              runs.data?.length ? (
                <Button variant="link" size="sm" asChild>
                  <Link href={`/projects/${projectId}/runs`}>View all runs</Link>
                </Button>
              ) : null
            }
          />
          <Card className="overflow-hidden">
            <RunsTable
              runs={sorted?.slice(0, 5)}
              loading={runs.isLoading}
              error={runs.isError}
              empty={
                <EmptyState
                  icon={Radar}
                  title="No audits yet"
                  description="Start an audit and Snaghunt will explore the app, write tests, run them and report what it finds."
                  action={<StartAuditButton projectId={projectId} project={project.data} />}
                  className="border-0"
                />
              }
            />
          </Card>
        </section>

        <section>
          <SectionTitle title="Environments" />
          <Card className="divide-y divide-border">
            {environments.map((environment, index) => (
              <div key={environment.id} className="px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <span className="truncate">{environment.name}</span>
                  {index === 0 ? (
                    <span className="shrink-0 text-[12px] font-normal text-muted-foreground">
                      Used for audits
                    </span>
                  ) : null}
                </div>
                <div className="mono mt-0.5 truncate text-xs text-muted-foreground">
                  {environment.baseUrl}
                </div>
              </div>
            ))}
            {!environments.length ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">
                {project.isLoading ? 'Loading…' : 'No environments yet.'}
              </p>
            ) : null}
            <div className="px-4 py-2.5">
              <Button variant="link" size="sm" asChild>
                <Link href={`/projects/${projectId}/settings`}>Manage in settings</Link>
              </Button>
            </div>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
