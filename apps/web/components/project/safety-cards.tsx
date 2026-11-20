'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BadgeCheck, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { SafetyMode } from '@auditor/shared';
import { CopyField } from '@/components/copy-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/components/pages/settings-ui';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import {
  projectApi,
  type ProjectDetail,
  type VerificationCheck,
  type VerificationInstructions,
} from '@/lib/queries';

const SAFETY_OPTIONS: Array<{ value: SafetyMode; title: string; description: string }> = [
  {
    value: 'READ_ONLY',
    title: 'Read-only',
    description: 'Browse only. Requests that change data are blocked.',
  },
  {
    value: 'FULL',
    title: 'Full',
    description:
      'May submit forms and create data. Payment providers and blocked paths are always blocked. Public sites need domain verification.',
  },
];

export function SafetyCard({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SafetyMode>(project.safetyMode ?? 'READ_ONLY');
  const [resetHookUrl, setResetHookUrl] = useState(project.resetHookUrl ?? '');
  const [patterns, setPatterns] = useState((project.blockedPathPatterns ?? []).join('\n'));

  const save = useMutation({
    mutationFn: (payload: Parameters<typeof projectApi.update>[1]) =>
      projectApi.update(project.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      toast.success('Safety settings saved');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save safety settings'),
  });

  return (
    <SettingsSection
      title="Safety"
      description="Controls what the auditor is allowed to change in your app."
    >
      <form
        className="max-w-2xl space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          const lines = patterns
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
          const invalid = lines.find((line) => !line.startsWith('/'));
          if (invalid) {
            toast.error(`Blocked path "${invalid}" must start with /`);
            return;
          }
          if (lines.length > 50) {
            toast.error('At most 50 blocked paths');
            return;
          }
          save.mutate({
            safetyMode: mode,
            resetHookUrl: resetHookUrl.trim() || null,
            blockedPathPatterns: lines,
          });
        }}
      >
        <fieldset className="space-y-2.5">
          <legend className="mb-2.5 text-sm font-medium text-ink">Mode</legend>
          {SAFETY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm transition-colors hover:border-[#b9bdc4] has-[:checked]:border-cobalt"
            >
              <input
                type="radio"
                name="safetyMode"
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--cobalt)]"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium text-ink">
                  {option.value === 'FULL' ? (
                    <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
                  ) : (
                    <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
                  )}
                  {option.title}
                </span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor="resetHookUrl">Reset hook URL</Label>
          <Input
            id="resetHookUrl"
            type="url"
            placeholder="https://staging.example.com/test/reset"
            value={resetHookUrl}
            onChange={(event) => setResetHookUrl(event.target.value)}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Optional. Called before each Full run to reset test data.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="blockedPaths">Blocked paths</Label>
          <Textarea
            id="blockedPaths"
            className="mono text-xs"
            placeholder={'/checkout*\n/api/orders'}
            value={patterns}
            onChange={(event) => setPatterns(event.target.value)}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            One per line. Must start with /. Use * as a wildcard. Data-changing requests to these
            paths are always blocked.
          </p>
        </div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : null}
          {save.isPending ? 'Saving…' : 'Save safety settings'}
        </Button>
      </form>
    </SettingsSection>
  );
}

type VerificationTarget = {
  /** Select value: environment id, or '' for the project URL. */
  value: string;
  label: string;
  host: string | null;
  environmentId?: string;
};

function verificationTargets(project: ProjectDetail): VerificationTarget[] {
  const targets: VerificationTarget[] = project.environments.map((environment) => ({
    value: environment.id,
    label: `${environment.name} (${environment.kind === 'STAGING' ? 'Staging' : 'Production'})`,
    host: hostOf(environment.baseUrl),
    environmentId: environment.id,
  }));
  const projectHost = hostOf(project.baseUrl);
  if (!targets.some((target) => target.host === projectHost)) {
    targets.unshift({ value: '', label: 'Project URL', host: projectHost });
  }
  return targets;
}

export function DomainVerificationCard({ project }: { project: ProjectDetail }) {
  const targets = verificationTargets(project);
  const [selected, setSelected] = useState(targets[0]?.value ?? '');
  const target = targets.find((item) => item.value === selected) ?? targets[0];
  const verifiedHosts = new Set((project.verifiedHosts ?? []).map((host) => host.toLowerCase()));
  if (project.verifiedAt && project.verifiedHost) {
    verifiedHosts.add(project.verifiedHost.toLowerCase());
  }
  const hostsToShow = Array.from(
    new Set(targets.map((item) => item.host).filter((host): host is string => Boolean(host))),
  );

  return (
    <SettingsSection
      title="Domain verification"
      description="Prove you own a host before Full mode can run on a public site. Each environment's host is verified separately."
    >
      <div className="max-w-2xl space-y-5 text-sm">
        {hostsToShow.length ? (
          <ul className="flex flex-wrap gap-2" aria-label="Host verification status">
            {hostsToShow.map((host) => {
              const ok = verifiedHosts.has(host);
              return (
                <li key={host}>
                  <Badge variant={ok ? 'success' : 'muted'} className="max-w-full">
                    {ok ? <BadgeCheck className="size-3" aria-hidden /> : null}
                    <span className="mono truncate font-medium">{host}</span>
                    <span className="sr-only">{ok ? ' verified' : ' not verified'}</span>
                  </Badge>
                </li>
              );
            })}
          </ul>
        ) : null}
        {targets.length > 1 ? (
          <div className="space-y-2">
            <Label htmlFor="verify-target">Environment</Label>
            <NativeSelect
              id="verify-target"
              value={target?.value ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              {targets.map((item) => (
                <option key={item.value || 'project'} value={item.value}>
                  {item.label}
                  {item.host ? `, ${item.host}` : ''}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {target ? (
          <VerificationPanel
            key={target.value || 'project'}
            project={project}
            target={target}
            alreadyVerified={Boolean(target.host && verifiedHosts.has(target.host))}
          />
        ) : null}
      </div>
    </SettingsSection>
  );
}

function VerificationPanel({
  project,
  target,
  alreadyVerified,
}: {
  project: ProjectDetail;
  target: VerificationTarget;
  alreadyVerified: boolean;
}) {
  const queryClient = useQueryClient();
  const [instructions, setInstructions] = useState<VerificationInstructions | null>(null);
  const [check, setCheck] = useState<VerificationCheck | null>(null);

  const verified = check?.verified ?? instructions?.verified ?? alreadyVerified;
  const verifiedAt = check?.verifiedAt ?? instructions?.verifiedAt ?? null;
  const shown = check ?? instructions;

  const request = useMutation({
    mutationFn: () => projectApi.requestVerification(project.id, target.environmentId),
    onSuccess: (data) => {
      setInstructions(data);
      setCheck(null);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not get instructions'),
  });

  const runCheck = useMutation({
    mutationFn: () => projectApi.checkVerification(project.id, target.environmentId),
    onSuccess: async (data) => {
      setCheck(data);
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      if (data.verified) {
        toast.success(`${data.host} verified`);
      } else {
        toast.error('Domain not verified yet');
      }
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not check the domain'),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-3">
        <span className="min-w-0">
          <span className="block text-[13px] text-muted-foreground">Host</span>
          <span className="mono block truncate text-ink">
            {shown?.host ?? target.host ?? 'Unknown'}
          </span>
        </span>
        {verified ? (
          <Badge variant="success">
            <BadgeCheck className="size-3" aria-hidden />
            Verified
          </Badge>
        ) : (
          <Badge variant="muted">Not verified</Badge>
        )}
      </div>
      {verified && verifiedAt ? (
        <p className="text-xs text-muted-foreground">
          Verified {new Date(verifiedAt).toLocaleString()}.
        </p>
      ) : null}
      {shown ? (
        <div className="space-y-4">
          <div className="space-y-3 rounded-md border border-border p-4">
            <h3 className="font-medium text-ink">Option 1: DNS TXT record</h3>
            <CopyField label="Name" value={shown.dnsRecordName} />
            <CopyField label="Value" value={shown.dnsRecordValue} />
          </div>
          <div className="space-y-3 rounded-md border border-border p-4">
            <h3 className="font-medium text-ink">Option 2: File on your site</h3>
            <CopyField label="URL" value={shown.fileUrl} />
            <CopyField label="Contents" value={shown.fileContents} />
          </div>
        </div>
      ) : null}
      {check ? (
        <p
          role="status"
          className={
            check.verified
              ? 'rounded-md border border-[#bfe3cc] bg-[#eef8f1] px-3 py-2.5 text-success'
              : 'rounded-md border border-[#f2c4bf] bg-[#fdf1ef] px-3 py-2.5 text-danger'
          }
        >
          {check.detail}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={shown ? 'outline' : 'default'}
          onClick={() => request.mutate()}
          disabled={request.isPending}
        >
          {request.isPending ? 'Loading…' : shown ? 'Show instructions again' : 'Get instructions'}
        </Button>
        {shown || project.verificationToken ? (
          <Button type="button" onClick={() => runCheck.mutate()} disabled={runCheck.isPending}>
            {runCheck.isPending ? 'Checking…' : 'Check now'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}
