'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CopyButton } from '@/components/copy-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { EmptyRow, SettingsSection } from '@/components/pages/settings-ui';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { projectApi } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function ApiTokensCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const tokens = useQuery({
    queryKey: ['tokens', projectId],
    queryFn: () => projectApi.tokens(projectId),
  });

  const create = useMutation({
    mutationFn: () => projectApi.createToken(projectId, { name: name.trim() }),
    onSuccess: async (data) => {
      setCreated({ name: data.name, token: data.token });
      setName('');
      await queryClient.invalidateQueries({ queryKey: ['tokens', projectId] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create token'),
  });

  const revoke = useMutation({
    mutationFn: (tokenId: string) => projectApi.revokeToken(projectId, tokenId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tokens', projectId] });
      toast.success('Token revoked');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not revoke token'),
  });

  return (
    <div>
      <SettingsSection
        title="CI tokens"
        description={
          <>
            Tokens let CI start runs and read results for this project only. Use them with the{' '}
            <code className="mono rounded-[4px] bg-well px-1 py-0.5 text-xs text-ink">
              testcrew
            </code>{' '}
            CLI.
          </>
        }
      >
        {tokens.isLoading ? (
          <div className="shimmer h-24 rounded-md" aria-label="Loading tokens" />
        ) : null}
        {tokens.isError ? (
          <p className="text-sm text-danger" role="alert">
            Could not load tokens.
          </p>
        ) : null}
        {tokens.data?.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {tokens.data.map((token) => (
              <li
                key={token.id}
                className={cn(
                  'flex items-center gap-3 bg-card px-4 py-3',
                  token.revokedAt && 'bg-well',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    <span
                      className={cn(
                        'truncate',
                        token.revokedAt && 'text-muted-foreground line-through',
                      )}
                    >
                      {token.name}
                    </span>
                    {token.revokedAt ? <Badge variant="muted">Revoked</Badge> : null}
                  </div>
                  <div className="mt-0.5 flex min-w-0 gap-x-3 text-xs text-muted-foreground">
                    <span className="mono shrink-0">{token.prefix}…</span>
                    <span className="truncate">
                      {token.lastUsedAt
                        ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                        : 'Never used'}
                    </span>
                  </div>
                </div>
                {!token.revokedAt ? (
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:bg-well hover:text-danger"
                    disabled={revoke.isPending}
                    aria-label={`Revoke ${token.name}`}
                    title={`Revoke "${token.name}"?`}
                    description="CI jobs that use this token will stop working. This cannot be undone; create a new token if you need one again."
                    confirmLabel="Revoke token"
                    pending={revoke.isPending}
                    onConfirm={() => revoke.mutateAsync(token.id).catch(() => undefined)}
                  >
                    Revoke
                  </ConfirmButton>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {tokens.data && !tokens.data.length && <EmptyRow>No tokens yet.</EmptyRow>}
      </SettingsSection>
      <SettingsSection
        title="Create token"
        description="Name it after the pipeline that will use it."
      >
        <div className="max-w-xl space-y-5">
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                placeholder="GitHub Actions"
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              {create.isPending ? 'Creating…' : 'Create token'}
            </Button>
          </form>
          {created ? (
            <div
              className="space-y-3 rounded-md border border-border bg-well p-4 text-sm"
              role="status"
            >
              <p className="font-medium text-ink">
                Copy &quot;{created.name}&quot; now. It will not be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="mono flex h-8 min-w-0 flex-1 items-center truncate rounded-md border border-border bg-card px-3 text-xs text-ink">
                  {created.token}
                </code>
                <CopyButton value={created.token} />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  );
}
