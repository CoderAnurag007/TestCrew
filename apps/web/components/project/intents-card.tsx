'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Intent } from '@auditor/shared';
import { Button } from '@/components/ui/button';
import { EmptyRow, SettingsSection } from '@/components/pages/settings-ui';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { projectApi, type ProjectDetail } from '@/lib/queries';

const MAX_INTENTS = 100;

export function IntentsCard({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const [intents, setIntents] = useState<Intent[]>(project.intents ?? []);
  const [draft, setDraft] = useState('');

  const save = useMutation({
    mutationFn: (next: Intent[]) => projectApi.update(project.id, { intents: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      toast.success('Intents saved');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save intents'),
  });

  const update = (id: string, patch: Partial<Intent>) =>
    setIntents((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const add = () => {
    const text = draft.trim();
    if (text.length < 3) {
      toast.error('An intent needs at least 3 characters');
      return;
    }
    if (intents.length >= MAX_INTENTS) {
      toast.error(`At most ${MAX_INTENTS} intents`);
      return;
    }
    setIntents((items) => [...items, { id: crypto.randomUUID().slice(0, 8), text, enabled: true }]);
    setDraft('');
  };

  const submit = () => {
    const cleaned = intents.map((item) => ({ ...item, text: item.text.trim() }));
    const invalid = cleaned.find((item) => item.text.length < 3 || item.text.length > 1000);
    if (invalid) {
      toast.error('Each intent must be 3 to 1000 characters');
      return;
    }
    save.mutate(cleaned);
  };

  return (
    <SettingsSection
      title="Intents"
      description="Describe what the app should do, for example 'Adding an item to the cart increases the cart count by 1'. Disabled intents are kept but skipped. Needs an AI provider."
    >
      <div className="max-w-2xl space-y-5">
        {intents.length ? (
          <ol className="space-y-3">
            {intents.map((intent, index) => (
              <li
                key={intent.id}
                className={cn(
                  'rounded-md border border-border bg-card p-3',
                  !intent.enabled && 'bg-well',
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="tabular mt-2 w-5 shrink-0 text-right text-[13px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <Textarea
                    aria-label={`Intent ${index + 1}`}
                    className={cn('min-h-16 flex-1', !intent.enabled && 'text-muted-foreground')}
                    maxLength={1000}
                    value={intent.text}
                    onChange={(event) => update(intent.id, { text: event.target.value })}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 pl-8">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-[var(--ink)]"
                      checked={intent.enabled}
                      onChange={(event) => update(intent.id, { enabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:bg-well hover:text-danger"
                    aria-label={`Delete intent ${index + 1}`}
                    onClick={() =>
                      setIntents((items) => items.filter((item) => item.id !== intent.id))
                    }
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyRow>No intents yet. Add one below.</EmptyRow>
        )}
        <div className="space-y-2 border-t border-border pt-5">
          <label htmlFor="new-intent" className="block text-sm font-medium text-ink">
            New intent
          </label>
          <Textarea
            id="new-intent"
            className="min-h-16"
            maxLength={1000}
            placeholder="Adding an item to the cart increases the cart count by 1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            One rule per intent, in plain English. Changes apply after you save.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
              <Plus />
              Add intent
            </Button>
            <Button type="button" onClick={submit} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              {save.isPending ? 'Saving…' : 'Save intents'}
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
