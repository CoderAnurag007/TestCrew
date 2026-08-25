'use client';

import Link from 'next/link';
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
import { Textarea } from '@/components/ui/textarea';
import { projectApi } from '@/lib/queries';
import { ApiError } from '@/lib/api';

export default function ProjectsPage() {
  const { currentOrg } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [environmentName, setEnvironmentName] = useState('Production');

  const projects = useQuery({
    queryKey: ['projects', currentOrg?.id],
    queryFn: () => projectApi.list(currentOrg!.id),
    enabled: Boolean(currentOrg),
  });

  const create = useMutation({
    mutationFn: projectApi.create,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects', currentOrg?.id] });
      setOpen(false);
      setName('');
      setDescription('');
      setBaseUrl('');
      setEnvironmentName('Production');
      toast.success('Project created');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not create project'),
  });

  return (
    <AppShell>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Inventory</p>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
        </div>
        <Button disabled={!currentOrg} onClick={() => setOpen(true)}>
          New project
        </Button>
      </div>

      {!currentOrg ? (
        <p className="text-sm text-muted-foreground">Create a workspace before adding projects.</p>
      ) : projects.data?.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No applications yet</CardTitle>
            <CardDescription>Point Auditor at a URL and it will become the unit of audit work.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.data?.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardHeader>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription className="mono">{project.baseUrl}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{project.description ?? 'No description'}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>Register an application URL and its first environment.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!currentOrg) {
                return;
              }
              create.mutate({
                organizationId: currentOrg.id,
                name,
                description: description || undefined,
                baseUrl,
                environmentName,
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="url">Application URL</Label>
              <Input
                id="url"
                type="url"
                placeholder="https://app.example.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="env">Environment</Label>
              <Input
                id="env"
                value={environmentName}
                onChange={(e) => setEnvironmentName(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={create.isPending}>
              Create project
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
