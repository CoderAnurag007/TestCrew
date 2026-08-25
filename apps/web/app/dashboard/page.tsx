'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { orgApi } from '@/lib/queries';
import { ApiError } from '@/lib/api';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-3xl tracking-tight">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export default function DashboardPage() {
  const { currentOrg, isLoading, setCurrentOrgId } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const stats = useQuery({
    queryKey: ['stats', currentOrg?.id],
    queryFn: () => orgApi.stats(currentOrg!.id),
    enabled: Boolean(currentOrg),
  });

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

  return (
    <AppShell>
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Command center</p>
          <h1 className="text-3xl font-semibold tracking-tight">Audit operations</h1>
        </div>
        <Button onClick={() => setOpen(true)}>New workspace</Button>
      </div>

      {!isLoading && !currentOrg ? (
        <Card className="command-grid">
          <CardHeader>
            <CardTitle>Create your first workspace</CardTitle>
            <CardDescription>
              Accounts start without an organization. Create a workspace to own projects, credentials, and
              audit runs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setOpen(true)}>Create workspace</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Total projects" value={String(stats.data?.totalProjects ?? 0)} />
          <Metric label="Total runs" value={String(stats.data?.totalRuns ?? 0)} />
          <Metric label="Open findings" value={String(stats.data?.openFindings ?? 0)} />
          <Metric label="Critical findings" value={String(stats.data?.criticalFindings ?? 0)} />
          <Metric
            label="Avg quality score"
            value={
              stats.data?.averageQualityScore == null
                ? '—'
                : stats.data.averageQualityScore.toFixed(1)
            }
          />
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>Workspaces isolate projects, secrets, and audit history.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createOrg.mutate({ name });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <Button type="submit" disabled={createOrg.isPending}>
              Create
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
