'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/app-shell';
import { RunStatusDot } from '@/components/status';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { runApi } from '@/lib/queries';

export default function ProjectRunsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const runs = useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => runApi.list(projectId),
  });

  return (
    <AppShell>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Runs</h1>
      <Card>
        <CardHeader>
          <CardTitle>Audit history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {runs.data?.map((run) => (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="flex items-center justify-between rounded-md border px-3 py-3 hover:bg-accent"
            >
              <div>
                <div className="mono text-xs">{run.id}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(run.createdAt).toLocaleString()}
                </div>
              </div>
              <RunStatusDot status={run.status} />
            </Link>
          ))}
          {!runs.data?.length && <p className="text-sm text-muted-foreground">No runs yet.</p>}
        </CardContent>
      </Card>
    </AppShell>
  );
}
