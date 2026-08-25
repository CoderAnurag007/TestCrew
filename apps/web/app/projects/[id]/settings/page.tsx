'use client';

import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { projectApi } from '@/lib/queries';
import { ApiError } from '@/lib/api';

export default function ProjectSettingsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const queryClient = useQueryClient();

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.get(projectId),
  });
  const credentials = useQuery({
    queryKey: ['credentials', projectId],
    queryFn: () => projectApi.credentials(projectId),
  });

  const [envName, setEnvName] = useState('');
  const [envUrl, setEnvUrl] = useState('');
  const [credName, setCredName] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');

  const addEnv = useMutation({
    mutationFn: () => projectApi.createEnvironment(projectId, { name: envName, baseUrl: envUrl }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setEnvName('');
      setEnvUrl('');
      toast.success('Environment added');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not add environment'),
  });

  const addCred = useMutation({
    mutationFn: () =>
      projectApi.createCredential(projectId, {
        name: credName,
        username,
        secret,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['credentials', projectId] });
      setCredName('');
      setUsername('');
      setSecret('');
      toast.success('Credential stored');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not store credential'),
  });

  const removeCred = useMutation({
    mutationFn: (credentialId: string) => projectApi.deleteCredential(projectId, credentialId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['credentials', projectId] });
      toast.success('Credential removed');
    },
  });

  const updateProject = useMutation({
    mutationFn: (payload: Parameters<typeof projectApi.update>[1]) => projectApi.update(projectId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Exploration settings saved');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save exploration settings'),
  });

  return (
    <AppShell>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">
        {project.data?.name ?? 'Project'} settings
      </h1>
      <Tabs defaultValue="environments">
        <TabsList>
          <TabsTrigger value="environments">Environments</TabsTrigger>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          <TabsTrigger value="exploration">Exploration</TabsTrigger>
        </TabsList>
        <TabsContent value="environments">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Registered environments</CardTitle>
                <CardDescription>Each environment is a distinct base URL for audit runs.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {project.data?.environments.map((environment) => (
                  <div key={environment.id} className="rounded-md border px-3 py-2">
                    <div className="text-sm font-medium">{environment.name}</div>
                    <div className="mono text-xs text-muted-foreground">{environment.baseUrl}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Add environment</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addEnv.mutate();
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="env-name">Name</Label>
                    <Input id="env-name" value={envName} onChange={(e) => setEnvName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="env-url">Base URL</Label>
                    <Input
                      id="env-url"
                      type="url"
                      value={envUrl}
                      onChange={(e) => setEnvUrl(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" disabled={addEnv.isPending}>
                    Save environment
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="credentials">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Stored credentials</CardTitle>
                <CardDescription>Secrets are encrypted at rest and never returned by the API.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {credentials.data?.map((credential) => (
                  <div key={credential.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{credential.name}</div>
                      <div className="mono text-xs text-muted-foreground">{credential.username}</div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeCred.mutate(credential.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                {!credentials.data?.length && (
                  <p className="text-sm text-muted-foreground">No credentials stored.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Add username/password</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addCred.mutate();
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="cred-name">Name</Label>
                    <Input id="cred-name" value={credName} onChange={(e) => setCredName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="secret">Secret</Label>
                    <Input
                      id="secret"
                      type="password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" disabled={addCred.isPending}>
                    Encrypt and store
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="exploration">
          <Card>
            <CardHeader>
              <CardTitle>Exploration limits</CardTitle>
              <CardDescription>
                These budgets are applied to every audit run. Destructive actions stay blocked unless enabled.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const data = new FormData(form);
                  updateProject.mutate({
                    maxPages: Number(data.get('maxPages')),
                    maxActions: Number(data.get('maxActions')),
                    maxDepth: Number(data.get('maxDepth')),
                    maxDurationMs: Number(data.get('maxDurationMs')) * 1000,
                    allowDestructive: data.get('allowDestructive') === 'on',
                    allowPrivateTargets: data.get('allowPrivateTargets') === 'on',
                    recordVideo: data.get('recordVideo') === 'on',
                  });
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="maxPages">Max pages</Label>
                  <Input id="maxPages" name="maxPages" type="number" defaultValue={project.data?.maxPages ?? 40} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxActions">Max actions</Label>
                  <Input id="maxActions" name="maxActions" type="number" defaultValue={project.data?.maxActions ?? 80} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxDepth">Max depth</Label>
                  <Input id="maxDepth" name="maxDepth" type="number" defaultValue={project.data?.maxDepth ?? 8} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxDurationMs">Max duration (seconds)</Label>
                  <Input
                    id="maxDurationMs"
                    name="maxDurationMs"
                    type="number"
                    defaultValue={Math.round((project.data?.maxDurationMs ?? 300000) / 1000)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="allowDestructive" defaultChecked={project.data?.allowDestructive} />
                  Allow destructive actions
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="allowPrivateTargets"
                    defaultChecked={project.data?.allowPrivateTargets}
                  />
                  Allow private / localhost targets
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="recordVideo" defaultChecked={project.data?.recordVideo} />
                  Record video per test (increases storage cost)
                </label>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={updateProject.isPending}>
                    Save exploration settings
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
