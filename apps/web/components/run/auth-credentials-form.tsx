'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { projectApi, runApi } from '@/lib/queries';

export function needsLoginCredentials(run: {
  status: string;
  currentAction?: string | null;
  errorMessage?: string | null;
}): boolean {
  const waiting =
    run.currentAction === 'authentication-required' ||
    (run.errorMessage ?? '').includes('AUTHENTICATION_REQUIRED');
  return waiting && (run.status === 'AUTHENTICATING' || run.status === 'FAILED');
}

export function canRetryLoginFailure(run: {
  status: string;
  errorMessage?: string | null;
}): boolean {
  if (run.status !== 'FAILED' && run.status !== 'AUTHENTICATING') {
    return false;
  }
  return /username or password fields were not found|AUTHENTICATION_REQUIRED|Authentication did not leave/i.test(
    run.errorMessage ?? '',
  );
}

export function AuthCredentialsForm({
  runId,
  projectId,
  loginUrl,
}: {
  runId: string;
  projectId: string;
  loginUrl?: string | null;
}) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const host = hostFrom(loginUrl);

  const saveAndContinue = useMutation({
    mutationFn: async () => {
      await projectApi.createCredential(projectId, {
        name: host ? `Login for ${host}` : 'Application login',
        username,
        secret,
      });
      return runApi.retry(runId);
    },
    onSuccess: async () => {
      setUsername('');
      setSecret('');
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      toast.success('Credentials stored. Resuming the audit.');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not store credentials'),
  });

  return (
    <Card className="mb-6 border-primary/40">
      <CardHeader>
        <CardTitle>Login credentials required</CardTitle>
        <CardDescription>
          The app opened a login page. Username and password are encrypted and stored on this project, then the
          audit continues. The secret is never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            saveAndContinue.mutate();
          }}
        >
          {loginUrl ? (
            <p className="mono sm:col-span-2 truncate text-xs text-muted-foreground">{loginUrl}</p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="audit-username">Username</Label>
            <Input
              id="audit-username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-secret">Password</Label>
            <Input
              id="audit-secret"
              type="password"
              autoComplete="current-password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saveAndContinue.isPending || !username || !secret}>
              {saveAndContinue.isPending ? 'Saving…' : 'Save and continue audit'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function RetryLoginButton({ runId }: { runId: string }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => runApi.retry(runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      toast.success('Retrying the audit with saved credentials');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not retry the audit'),
  });

  return (
    <Card className="mb-6 border-primary/40">
      <CardHeader>
        <CardTitle>Retry login</CardTitle>
        <CardDescription>
          The login form uses an email address field. Retry this run with the credentials already stored on the
          project.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
          {retry.isPending ? 'Retrying…' : 'Retry audit'}
        </Button>
      </CardContent>
    </Card>
  );
}

function hostFrom(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
