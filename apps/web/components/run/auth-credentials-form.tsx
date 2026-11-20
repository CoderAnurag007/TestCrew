'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Loader2, LogIn, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  const [useSession, setUseSession] = useState(false);
  const [sessionLabel, setSessionLabel] = useState('SSO session');
  const [sessionJson, setSessionJson] = useState('');
  const host = hostFrom(loginUrl);

  const saveAndContinue = useMutation({
    mutationFn: async () => {
      if (useSession) {
        await projectApi.createCredential(projectId, {
          name: host ? `Session for ${host}` : 'Saved session',
          type: 'STORAGE_STATE',
          username: sessionLabel,
          secret: sessionJson,
        });
      } else {
        await projectApi.createCredential(projectId, {
          name: host ? `Login for ${host}` : 'Application login',
          username,
          secret,
        });
      }
      return runApi.retry(runId);
    },
    onSuccess: async () => {
      setUsername('');
      setSecret('');
      setSessionJson('');
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      toast.success('Credentials stored. Resuming the audit.');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not store credentials'),
  });

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Login credentials required</CardTitle>
        </div>
        <CardDescription>
          The app opened a login page. Username and password (or a saved session) are encrypted and stored on this
          project, then the audit continues. The secret is never shown again.
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
            <p className="mono truncate rounded-md border border-border bg-well px-3 py-2 text-[12px] text-ink sm:col-span-2">
              {loginUrl}
            </p>
          ) : null}
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-[var(--cobalt)]" checked={useSession} onChange={(event) => setUseSession(event.target.checked)} />
            Use a saved session instead (SSO/MFA)
          </label>
          {useSession ? (
            <>
              <p className="text-[13px] text-muted-foreground sm:col-span-2">
                For SSO/MFA apps: log in once with Playwright and save context.storageState() to JSON.
              </p>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="audit-session-label">Label</Label>
                <Input
                  id="audit-session-label"
                  value={sessionLabel}
                  onChange={(event) => setSessionLabel(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="audit-session-json">Storage state JSON</Label>
                <Textarea
                  id="audit-session-json"
                  className="mono min-h-32 text-[12px]"
                  placeholder='{"cookies": [...], "origins": [...]}'
                  maxLength={1_000_000}
                  value={sessionJson}
                  onChange={(event) => setSessionJson(event.target.value)}
                  required
                />
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
          <div className="sm:col-span-2">
            <Button
              type="submit"
              disabled={
                saveAndContinue.isPending || (useSession ? !sessionLabel || !sessionJson : !username || !secret)
              }
            >
              {saveAndContinue.isPending ? <Loader2 className="animate-spin" /> : <LogIn />}
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
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <RotateCcw className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Retry login</CardTitle>
        </div>
        <CardDescription>
          The login form uses an email address field. Retry this run with the credentials already stored on the
          project.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
          {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
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
