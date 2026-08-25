'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { RunStatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { projectApi, runApi } from '@/lib/queries';
import { ApiError } from '@/lib/api';

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const queryClient = useQueryClient();

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.get(projectId),
  });

  const runs = useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => runApi.list(projectId),
  });

  const startAudit = useMutation({
    mutationFn: () => runApi.create(projectId, { environmentId: project.data?.environments[0]?.id }),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ['runs', projectId] });
      toast.success('Audit queued');
      window.location.href = `/runs/${run.id}`;
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not start audit'),
  });

  const lastRun = runs.data?.[0];
  const findings = { open: 0, critical: 0 };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Application</p>
          <h1 className="text-3xl font-semibold tracking-tight">{project.data?.name ?? 'Project'}</h1>
          <p className="mono text-sm text-muted-foreground">{project.data?.baseUrl}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/projects/${projectId}/runs`}>Runs</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/projects/${projectId}/settings`}>Settings</Link>
          </Button>
          <Button onClick={() => startAudit.mutate()} disabled={startAudit.isPending || !project.data}>
            Start Audit
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Environment</CardDescription>
            <CardTitle>{project.data?.environments[0]?.name ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Last run</CardDescription>
            <CardTitle className="text-base">
              {lastRun ? <RunStatusDot status={lastRun.status} /> : 'No runs'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Open findings</CardDescription>
            <CardTitle className="font-mono text-2xl">{findings.open}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Critical findings</CardDescription>
            <CardTitle className="font-mono text-2xl">{findings.critical}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Recent audit activity for this application.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {runs.data?.slice(0, 5).map((run) => (
            <Link key={run.id} href={`/runs/${run.id}`} className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="mono text-xs">{run.id}</span>
              <RunStatusDot status={run.status} />
            </Link>
          ))}
          {!runs.data?.length && <p className="text-sm text-muted-foreground">No audits have been launched.</p>}
        </CardContent>
      </Card>
    </AppShell>
  );
}
