'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Send } from 'lucide-react';
import type { Integration, IntegrationBody, IntegrationProvider } from '@auditor/shared';
import { FieldHint, SettingsSection } from '@/components/pages/settings-ui';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { launchApi, orgApi, type ProjectDetail } from '@/lib/queries';

type Field = { key: string; label: string; placeholder: string; hint?: ReactNode; secret?: boolean };

const PROVIDERS: Record<
  IntegrationProvider,
  { name: string; blurb: string; fields: Field[]; secretLabel: string; secretHint: ReactNode }
> = {
  slack: {
    name: 'Slack',
    blurb: 'Posts new bugs to a channel.',
    fields: [],
    secretLabel: 'Incoming webhook URL',
    secretHint: 'In Slack: Apps → Incoming Webhooks → Add to a channel, then copy the URL.',
  },
  webhook: {
    name: 'Webhook',
    blurb: 'Sends a JSON message to any https address (Discord bots, Zapier, your own server).',
    fields: [],
    secretLabel: 'Webhook URL',
    secretHint: 'We POST { event, subject, text, findings, runUrl } when a run finds new bugs.',
  },
  github: {
    name: 'GitHub Issues',
    blurb: 'One click turns a finding into an issue with steps and a fix hint.',
    fields: [
      { key: 'repo', label: 'Repository', placeholder: 'your-org/your-repo' },
      { key: 'labels', label: 'Labels', placeholder: 'bug, testcrew', hint: 'Comma separated.' },
    ],
    secretLabel: 'Access token',
    secretHint: 'A fine-grained token with “Issues: read and write” on this repository.',
  },
  jira: {
    name: 'Jira',
    blurb: 'Creates a Jira issue in your project.',
    fields: [
      { key: 'site', label: 'Site', placeholder: 'your-team.atlassian.net' },
      { key: 'email', label: 'Your Atlassian email', placeholder: 'you@company.com' },
      { key: 'projectKey', label: 'Project key', placeholder: 'WEB' },
      { key: 'issueType', label: 'Issue type', placeholder: 'Bug' },
    ],
    secretLabel: 'API token',
    secretHint: 'Create one at id.atlassian.com → Security → API tokens.',
  },
  linear: {
    name: 'Linear',
    blurb: 'Creates a Linear issue for the team you choose.',
    fields: [{ key: 'teamId', label: 'Team ID', placeholder: 'Team UUID', hint: 'Linear → Settings → Teams → copy the team ID.' }],
    secretLabel: 'Personal API key',
    secretHint: 'Linear → Settings → Security & access → Personal API keys.',
  },
};

export function IntegrationsCard({ project }: { project: ProjectDetail }) {
  const integrations = useQuery({
    queryKey: ['integrations', project.id],
    queryFn: () => launchApi.integrations(project.id),
  });
  const byProvider = new Map((integrations.data ?? []).map((item) => [item.provider, item]));

  if (integrations.isLoading) return <div className="shimmer mt-2 h-64 rounded-md" aria-label="Loading integrations" />;

  return (
    <div>
      <SettingsSection title="Alert channels" description="Where alerts go. Choose what triggers them in the Monitoring tab.">
        <div className="space-y-3">
          {(['slack', 'webhook'] as const).map((provider) => (
            <ProviderRow key={provider} projectId={project.id} provider={provider} saved={byProvider.get(provider)} />
          ))}
        </div>
      </SettingsSection>
      <SettingsSection
        title="Bug trackers"
        description="Adds a “Create ticket” button to every finding. The ticket carries the steps, what went wrong and how to fix it."
      >
        <div className="space-y-3">
          {(['github', 'jira', 'linear'] as const).map((provider) => (
            <ProviderRow key={provider} projectId={project.id} provider={provider} saved={byProvider.get(provider)} />
          ))}
        </div>
      </SettingsSection>
      <BrandingSection organizationId={project.organizationId} />
    </div>
  );
}

function ProviderRow({
  projectId,
  provider,
  saved,
}: {
  projectId: string;
  provider: IntegrationProvider;
  saved?: Integration;
}) {
  const meta = PROVIDERS[provider];
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const initial = Object.fromEntries(
    meta.fields.map((field) => {
      const value = saved?.config[field.key];
      return [field.key, Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : ''];
    }),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [secret, setSecret] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations', projectId] });
  const save = useMutation({
    mutationFn: () => launchApi.saveIntegration(projectId, buildBody(provider, values, secret)),
    onSuccess: async () => {
      await refresh();
      setSecret('');
      setOpen(false);
      toast.success(`${meta.name} connected`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : `Could not save ${meta.name}`),
  });
  const remove = useMutation({
    mutationFn: () => launchApi.removeIntegration(projectId, provider),
    onSuccess: async () => {
      await refresh();
      setValues(Object.fromEntries(meta.fields.map((field) => [field.key, ''])));
      toast.success(`${meta.name} disconnected`);
    },
    onError: () => toast.error(`Could not disconnect ${meta.name}`),
  });
  const test = useMutation({
    mutationFn: () => launchApi.testIntegration(projectId, provider as 'slack' | 'webhook'),
    onSuccess: () => toast.success('Test message sent. Check the channel.'),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'The test message failed'),
  });

  const connected = Boolean(saved?.hasSecret);
  const summary = connected
    ? provider === 'github'
      ? String(saved?.config.repo ?? '')
      : provider === 'jira'
        ? `${String(saved?.config.site ?? '')} · ${String(saved?.config.projectKey ?? '')}`
        : provider === 'linear'
          ? 'Team connected'
          : `URL ${saved?.secretHint ?? ''}`
    : meta.blurb;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
            {meta.name}
            {connected ? (
              <span className="inline-flex items-center gap-1 text-[12px] font-normal text-[#1a7f37]">
                <Check className="size-3.5" aria-hidden /> Connected
              </span>
            ) : null}
          </p>
          <p className="truncate text-[13px] text-muted-foreground">{summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connected && (provider === 'slack' || provider === 'webhook') ? (
            <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send test
            </Button>
          ) : null}
          {connected ? (
            <ConfirmButton
              size="sm"
              variant="outline"
              title={`Disconnect ${meta.name}?`}
              description="The saved token or URL is deleted. Existing tickets are not touched."
              confirmLabel="Disconnect"
              onConfirm={() => remove.mutate()}
            >
              Disconnect
            </ConfirmButton>
          ) : null}
          <Button size="sm" variant={connected ? 'outline' : 'default'} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? 'Close' : connected ? 'Edit' : 'Connect'}
          </Button>
        </div>
      </div>
      {open ? (
        <form
          className="space-y-4 border-t border-border px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {meta.fields.map((field) => (
              <div key={field.key} className="grid gap-2">
                <Label htmlFor={`${provider}-${field.key}`}>{field.label}</Label>
                <Input
                  id={`${provider}-${field.key}`}
                  placeholder={field.placeholder}
                  value={values[field.key] ?? ''}
                  onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                />
                {field.hint ? <FieldHint>{field.hint}</FieldHint> : null}
              </div>
            ))}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${provider}-secret`}>{meta.secretLabel}</Label>
            <Input
              id={`${provider}-secret`}
              type="password"
              autoComplete="off"
              placeholder={connected ? `Saved (${saved?.secretHint ?? 'hidden'}). Leave empty to keep it.` : ''}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
            <FieldHint>{meta.secretHint} Stored encrypted; never shown again.</FieldHint>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              Save {meta.name}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function buildBody(provider: IntegrationProvider, values: Record<string, string>, secret: string): IntegrationBody {
  const token = secret.trim() || undefined;
  switch (provider) {
    case 'slack':
      return { provider, config: {}, secret: token };
    case 'webhook':
      return { provider, config: {}, secret: token };
    case 'github':
      return {
        provider,
        config: {
          repo: (values.repo ?? '').trim(),
          labels: (values.labels ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        },
        secret: token,
      };
    case 'jira':
      return {
        provider,
        config: {
          site: (values.site ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
          email: (values.email ?? '').trim(),
          projectKey: (values.projectKey ?? '').trim().toUpperCase(),
          issueType: (values.issueType ?? '').trim() || 'Bug',
        },
        secret: token,
      };
    case 'linear':
      return { provider, config: { teamId: (values.teamId ?? '').trim() }, secret: token };
  }
}

function BrandingSection({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const org = useQuery({ queryKey: ['organization', organizationId], queryFn: () => orgApi.get(organizationId) });
  const save = useMutation({
    mutationFn: (payload: { brandName: string | null; brandLogoUrl: string | null; brandColor: string | null; brandFooter: string | null }) =>
      launchApi.saveBranding(organizationId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['organization', organizationId] });
      toast.success('Report branding saved');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not save branding'),
  });

  return (
    <SettingsSection
      title="Shared report branding"
      description="Shared report links show your name, logo and colour instead of TestCrew’s. Applies to every project in this workspace."
    >
      {org.data ? (
        <form
          key={String(org.data.updatedAt)}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const text = (key: string) => String(data.get(key) ?? '').trim() || null;
            save.mutate({
              brandName: text('brandName'),
              brandLogoUrl: text('brandLogoUrl'),
              brandColor: text('brandColor'),
              brandFooter: text('brandFooter'),
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="brandName">Name on the report</Label>
              <Input id="brandName" name="brandName" placeholder={org.data.name} defaultValue={org.data.brandName ?? ''} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="brandColor">Accent colour</Label>
              <Input id="brandColor" name="brandColor" placeholder="#1F6FEB" defaultValue={org.data.brandColor ?? ''} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="brandLogoUrl">Logo URL</Label>
              <Input
                id="brandLogoUrl"
                name="brandLogoUrl"
                placeholder="https://youragency.com/logo.png"
                defaultValue={org.data.brandLogoUrl ?? ''}
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="brandFooter">Footer note</Label>
              <Input
                id="brandFooter"
                name="brandFooter"
                placeholder="Prepared by Your Agency · hello@youragency.com"
                defaultValue={org.data.brandFooter ?? ''}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              Save branding
            </Button>
          </div>
        </form>
      ) : (
        <div className="shimmer h-40 rounded-md" aria-label="Loading branding" />
      )}
    </SettingsSection>
  );
}
