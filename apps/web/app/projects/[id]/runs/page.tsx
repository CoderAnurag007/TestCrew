'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { byNewest, refetchWhileRunning } from '@/components/pages/format';
import { ProjectHeader, StartAuditButton } from '@/components/pages/project-header';
import { RunsTable } from '@/components/pages/runs-table';
import { Card } from '@/components/ui/card';
import { EmptyState, SectionTitle } from '@/components/ui/premium';
import { projectApi, runApi } from '@/lib/queries';

export default function ProjectRunsPage() {
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

  return (
    <AppShell>
      <ProjectHeader
        projectId={projectId}
        project={project.data}
        loading={project.isLoading}
        error={project.isError}
      />
      <SectionTitle
        title="Audit history"
        description={
          sorted?.length
            ? `${sorted.length} ${sorted.length === 1 ? 'run' : 'runs'}, newest first.`
            : undefined
        }
      />
      <Card className="overflow-hidden">
        <RunsTable
          runs={sorted}
          loading={runs.isLoading}
          error={runs.isError}
          empty={
            <EmptyState
              icon={History}
              title="No runs yet"
              description="Every audit you start shows up here with its status and score."
              action={<StartAuditButton projectId={projectId} project={project.data} />}
              className="border-0"
            />
          }
        />
      </Card>
    </AppShell>
  );
}
