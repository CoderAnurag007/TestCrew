'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { SafetyMode } from '@auditor/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { projectApi } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** Dialog styling shared by the app's form dialogs. */
export const DIALOG_CLASS = 'w-[calc(100%-2rem)] max-w-lg';

export function CreateProjectDialog({
  open,
  onOpenChange,
  organizationId,
  openAfterCreate = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  openAfterCreate?: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [environmentName, setEnvironmentName] = useState('Production');
  const [safetyMode, setSafetyMode] = useState<SafetyMode>('READ_ONLY');
  const [stagingUrl, setStagingUrl] = useState('');
  const [stagingSafetyMode, setStagingSafetyMode] = useState<SafetyMode>('FULL');

  const create = useMutation({
    mutationFn: projectApi.create,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects', organizationId] });
      await queryClient.invalidateQueries({ queryKey: ['stats', organizationId] });
      onOpenChange(false);
      setName('');
      setDescription('');
      setBaseUrl('');
      setEnvironmentName('Production');
      setSafetyMode('READ_ONLY');
      setStagingUrl('');
      setStagingSafetyMode('FULL');
      toast.success('Project created');
      if (openAfterCreate) {
        router.push(`/projects/${project.id}`);
      }
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create project'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Point TestCrew at an app. You can add credentials, more environments and safety rules
            later.
          </DialogDescription>
        </DialogHeader>
        {!organizationId ? (
          <p className="text-sm text-muted-foreground">
            Create a workspace first, then add projects to it.
          </p>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate({
                organizationId,
                name,
                description: description || undefined,
                baseUrl,
                environmentName,
                safetyMode,
                stagingUrl: stagingUrl.trim() || undefined,
                stagingSafetyMode: stagingUrl.trim() ? stagingSafetyMode : undefined,
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                placeholder="Customer portal"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-url">Production URL</Label>
              <Input
                id="project-url"
                type="url"
                placeholder="https://app.example.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                aria-describedby="project-url-help"
                required
              />
              <p id="project-url-help" className="text-xs leading-relaxed text-muted-foreground">
                Where audits start by default.
              </p>
              <ModeChoice
                name="production-mode"
                legend="Production mode"
                value={safetyMode}
                onChange={setSafetyMode}
                options={[
                  {
                    value: 'READ_ONLY',
                    title: 'Read-only',
                    description: 'Browses and clicks, never changes data. Recommended.',
                  },
                  {
                    value: 'FULL',
                    title: 'Full functional',
                    description: 'May submit forms. Never places orders on production.',
                  },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-staging-url">
                Staging URL <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="project-staging-url"
                type="url"
                placeholder="https://staging.example.com"
                value={stagingUrl}
                onChange={(e) => setStagingUrl(e.target.value)}
                aria-describedby="project-staging-url-help"
              />
              <p
                id="project-staging-url-help"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                Orders, bookings and payments are only ever tested here.
              </p>
              {stagingUrl.trim() ? (
                <ModeChoice
                  name="staging-mode"
                  legend="Staging mode"
                  value={stagingSafetyMode}
                  onChange={setStagingSafetyMode}
                  options={[
                    {
                      value: 'FULL',
                      title: 'Full functional',
                      description: 'Fills forms and runs journeys end to end. Recommended.',
                    },
                    {
                      value: 'READ_ONLY',
                      title: 'Read-only',
                      description: 'Browses only, like production.',
                    },
                  ]}
                />
              ) : null}
            </div>
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="project-env">Environment name</Label>
                <Input
                  id="project-env"
                  value={environmentName}
                  onChange={(e) => setEnvironmentName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-description">
                  Description <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="project-description"
                  className="min-h-20"
                  placeholder="What the app does, who uses it"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <p className="rounded-md bg-well px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
              Full mode on a public site needs domain verification. Until then the auditor runs{' '}
              <span className="font-medium text-ink">Read-only</span>.
            </p>
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" /> : null}
                {create.isPending ? 'Creating…' : 'Create project'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModeChoice({
  name,
  legend,
  value,
  onChange,
  options,
}: {
  name: string;
  legend: string;
  value: SafetyMode;
  onChange: (value: SafetyMode) => void;
  options: Array<{ value: SafetyMode; title: string; description: string }>;
}) {
  return (
    <fieldset className="pt-1">
      <legend className="sr-only">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 transition-colors hover:border-[#b9bdc4] has-[:checked]:border-cobalt',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--cobalt)]"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                {option.value === 'FULL' ? (
                  <ShieldAlert className="size-3.5 text-muted-foreground" aria-hidden />
                ) : (
                  <ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden />
                )}
                {option.title}
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
