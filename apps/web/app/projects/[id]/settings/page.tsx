'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { EnvironmentKind, SafetyMode } from '@auditor/shared';
import { Cookie, KeyRound, Loader2, Plus, Trash2, UserRound } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { DangerZone } from '@/components/pages/danger-zone';
import {
  defaultEnvironment,
  EnvironmentKindBadge,
  ProjectHeader,
  SafetyBadge,
} from '@/components/pages/project-header';
import {
  EmptyRow,
  FieldHint,
  ItemList,
  ItemRow,
  SettingsSection,
  ToggleRow,
} from '@/components/pages/settings-ui';
import { ApiTokensCard } from '@/components/project/api-tokens-card';
import { HiddenFindingsCard } from '@/components/project/hidden-findings-card';
import { IntentsCard } from '@/components/project/intents-card';
import { IntegrationsCard } from '@/components/project/integrations-card';
import { MonitoringCard } from '@/components/project/monitoring-card';
import { DomainVerificationCard, SafetyCard } from '@/components/project/safety-cards';
import { TestPlanTab } from '@/components/project/test-plan-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/premium';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { projectApi, type ProjectDetail } from '@/lib/queries';

export default function ProjectSettingsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const tab = useSearchParams().get('tab') ?? 'general';

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.get(projectId),
  });

  return (
    <AppShell>
      <ProjectHeader
        projectId={projectId}
        project={project.data}
        loading={project.isLoading}
        error={project.isError}
      />
      <Tabs defaultValue={tab}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="environments">Environments</TabsTrigger>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="safety">Safety</TabsTrigger>
          <TabsTrigger value="test-plan">Test plan</TabsTrigger>
          <TabsTrigger value="intents">Intents</TabsTrigger>
          <TabsTrigger value="tokens">CI tokens</TabsTrigger>
          <TabsTrigger value="hidden">Hidden findings</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          {project.data ? (
            <div>
              <DetailsCard
                key={`details-${String(project.data.updatedAt)}`}
                project={project.data}
              />
              <ExplorationCard
                key={`limits-${String(project.data.updatedAt)}`}
                project={project.data}
              />
              <DangerZone project={project.data} />
            </div>
          ) : (
            <ProjectState loading={project.isLoading} />
          )}
        </TabsContent>
        <TabsContent value="environments">
          <EnvironmentsTab
            projectId={projectId}
            project={project.data}
            loading={project.isLoading}
          />
        </TabsContent>
        <TabsContent value="credentials">
          <CredentialsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="monitoring">
          {project.data ? (
            <MonitoringCard key={project.data.id} project={project.data} />
          ) : (
            <ProjectState loading={project.isLoading} />
          )}
        </TabsContent>
        <TabsContent value="integrations">
          {project.data ? (
            <IntegrationsCard key={project.data.id} project={project.data} />
          ) : (
            <ProjectState loading={project.isLoading} />
          )}
        </TabsContent>
        <TabsContent value="safety">
          {project.data ? (
            <div>
              <SafetyCard key={project.data.id} project={project.data} />
              <DomainVerificationCard project={project.data} />
            </div>
          ) : (
            <ProjectState loading={project.isLoading} />
          )}
        </TabsContent>
        <TabsContent value="test-plan">
          {project.data ? (
            <TestPlanTab key={project.data.id} project={project.data} />
          ) : (
            <ProjectState loading={project.isLoading} />
          )}
        </TabsContent>
        <TabsContent value="intents">
          {project.data ? (
            <IntentsCard key={project.data.id} project={project.data} />
          ) : (
            <ProjectState loading={project.isLoading} />
          )}
        </TabsContent>
        <TabsContent value="tokens">
          <ApiTokensCard projectId={projectId} />
        </TabsContent>
        <TabsContent value="hidden">
          <HiddenFindingsCard projectId={projectId} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function useProjectUpdate(projectId: string, success: string, failure: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof projectApi.update>[1]) =>
      projectApi.update(projectId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(success);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : failure),
  });
}

function SaveButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? 'Saving…' : children}
    </Button>
  );
}

function DetailsCard({ project }: { project: ProjectDetail }) {
  const update = useProjectUpdate(
    project.id,
    'Project details saved',
    'Could not save project details',
  );
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [baseUrl, setBaseUrl] = useState(project.baseUrl);

  return (
    <SettingsSection
      title="Project details"
      description="The name and address shown across TestCrew."
    >
      <form
        className="grid gap-5 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({
            name: name.trim(),
            description: description.trim() || null,
            baseUrl: baseUrl.trim(),
          });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="details-name">Name</Label>
          <Input
            id="details-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={160}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="details-url">App URL</Label>
          <Input
            id="details-url"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            aria-describedby="details-url-help"
            required
          />
          <FieldHint id="details-url-help">Changing the host resets domain verification.</FieldHint>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="details-description">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="details-description"
            className="min-h-20"
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <SaveButton pending={update.isPending}>Save details</SaveButton>
        </div>
      </form>
    </SettingsSection>
  );
}

function ExplorationCard({ project }: { project: ProjectDetail }) {
  const update = useProjectUpdate(
    project.id,
    'Exploration settings saved',
    'Could not save exploration settings',
  );

  return (
    <SettingsSection
      title="Exploration limits"
      description="Budgets applied to every audit run. Destructive actions stay blocked unless you allow them here."
    >
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          update.mutate({
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
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <NumberField
            id="maxPages"
            label="Max pages"
            hint="Distinct pages to visit, up to 500"
            max={500}
            defaultValue={project.maxPages ?? 40}
          />
          <NumberField
            id="maxActions"
            label="Max actions"
            hint="Clicks, fills and submits, up to 2000"
            max={2000}
            defaultValue={project.maxActions ?? 80}
          />
          <NumberField
            id="maxDepth"
            label="Max depth"
            hint="Steps from the start page, up to 50"
            max={50}
            defaultValue={project.maxDepth ?? 8}
          />
          <NumberField
            id="maxDurationMs"
            label="Max duration"
            hint="Seconds per run, up to 3600"
            max={3600}
            defaultValue={Math.round((project.maxDurationMs ?? 300000) / 1000)}
          />
        </div>
        <div className="space-y-4 border-t border-border pt-6">
          <ToggleRow
            name="allowDestructive"
            title="Allow destructive actions"
            description="Lets the auditor click delete, cancel and similar controls."
            defaultChecked={project.allowDestructive}
            tone="warning"
          />
          <ToggleRow
            name="allowPrivateTargets"
            title="Allow private targets"
            description="Needed for localhost and internal network addresses."
            defaultChecked={project.allowPrivateTargets}
          />
          <ToggleRow
            name="recordVideo"
            title="Record video per test"
            description="Useful for debugging. Uses more storage."
            defaultChecked={project.recordVideo}
          />
        </div>
        <SaveButton pending={update.isPending}>Save exploration settings</SaveButton>
      </form>
    </SettingsSection>
  );
}

function NumberField({
  id,
  label,
  hint,
  max,
  defaultValue,
}: {
  id: string;
  label: string;
  hint: string;
  max: number;
  defaultValue: number;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type="number"
        min={1}
        max={max}
        inputMode="numeric"
        className="mono tabular"
        defaultValue={defaultValue}
        aria-describedby={`${id}-help`}
      />
      <FieldHint id={`${id}-help`}>{hint}</FieldHint>
    </div>
  );
}

const ENV_MODE_OPTIONS: Array<{ value: '' | SafetyMode; label: string }> = [
  { value: '', label: 'Inherit project' },
  { value: 'READ_ONLY', label: 'Read-only' },
  { value: 'FULL', label: 'Full functional' },
];

function EnvironmentsTab({
  projectId,
  project,
  loading,
}: {
  projectId: string;
  project: ProjectDetail | undefined;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [envName, setEnvName] = useState('');
  const [envUrl, setEnvUrl] = useState('');
  const [envKind, setEnvKind] = useState<EnvironmentKind>('STAGING');
  const [envMode, setEnvMode] = useState<'' | SafetyMode>('');

  const addEnv = useMutation({
    mutationFn: () =>
      projectApi.createEnvironment(projectId, {
        name: envName.trim(),
        baseUrl: envUrl.trim(),
        kind: envKind,
        safetyMode: envMode || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setEnvName('');
      setEnvUrl('');
      setEnvKind('STAGING');
      setEnvMode('');
      toast.success('Environment added');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not add environment'),
  });

  const setMode = useMutation({
    mutationFn: ({
      environmentId,
      safetyMode,
    }: {
      environmentId: string;
      safetyMode: SafetyMode | null;
    }) => projectApi.updateEnvironment(projectId, environmentId, { safetyMode }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Environment mode saved');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save environment mode'),
  });

  const projectMode = project?.safetyMode ?? 'READ_ONLY';
  const defaultId = defaultEnvironment(project)?.id;

  return (
    <div>
      <SettingsSection
        title="Environments"
        description="Each environment is a separate base URL. Audits default to Production; pick another from the Start audit menu. Orders, bookings and payments only ever run on a Staging environment in Full mode."
      >
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : project?.environments.length ? (
          <ItemList>
            {project.environments.map((environment) => {
              const selectId = `env-mode-${environment.id}`;
              const effective = environment.safetyMode ?? projectMode;
              const pending =
                setMode.isPending && setMode.variables?.environmentId === environment.id;
              return (
                <li
                  key={environment.id}
                  className="flex flex-col gap-3 bg-card px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        <span className="truncate">{environment.name}</span>
                        <EnvironmentKindBadge kind={environment.kind} />
                        {environment.id === defaultId ? (
                          <Badge variant="default">Default</Badge>
                        ) : null}
                      </div>
                      <div className="mono mt-0.5 truncate text-xs text-muted-foreground">
                        {environment.baseUrl}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:w-60 sm:shrink-0">
                    <label htmlFor={selectId} className="sr-only">
                      Mode for {environment.name}
                    </label>
                    <NativeSelect
                      id={selectId}
                      size="sm"
                      wrapperClassName="flex-1"
                      value={environment.safetyMode ?? ''}
                      disabled={pending}
                      aria-describedby={`${selectId}-effective`}
                      onChange={(event) =>
                        setMode.mutate({
                          environmentId: environment.id,
                          safetyMode: (event.target.value || null) as SafetyMode | null,
                        })
                      }
                    >
                      {ENV_MODE_OPTIONS.map((option) => (
                        <option key={option.value || 'inherit'} value={option.value}>
                          {option.value === ''
                            ? `${option.label} (${projectMode === 'FULL' ? 'Full' : 'Read-only'})`
                            : option.label}
                        </option>
                      ))}
                    </NativeSelect>
                    {pending ? (
                      <Loader2
                        className="size-4 animate-spin text-muted-foreground"
                        aria-label="Saving"
                      />
                    ) : (
                      <SafetyBadge mode={effective} className="hidden sm:inline-flex" />
                    )}
                    <span id={`${selectId}-effective`} className="sr-only">
                      Effective mode: {effective === 'FULL' ? 'Full functional' : 'Read-only'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ItemList>
        ) : (
          <EmptyRow>No environments yet.</EmptyRow>
        )}
      </SettingsSection>
      <SettingsSection
        title="Add environment"
        description="For example a staging or preview deployment."
      >
        <form
          className="max-w-xl space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            addEnv.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="env-name">Name</Label>
            <Input
              id="env-name"
              placeholder="Staging"
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
              maxLength={80}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="env-url">Base URL</Label>
            <Input
              id="env-url"
              type="url"
              placeholder="https://staging.example.com"
              value={envUrl}
              onChange={(e) => setEnvUrl(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="env-kind">Kind</Label>
              <NativeSelect
                id="env-kind"
                value={envKind}
                onChange={(e) => setEnvKind(e.target.value as EnvironmentKind)}
                aria-describedby="env-kind-help"
              >
                <option value="PRODUCTION">Production</option>
                <option value="STAGING">Staging</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="env-mode">Mode</Label>
              <NativeSelect
                id="env-mode"
                value={envMode}
                onChange={(e) => setEnvMode(e.target.value as '' | SafetyMode)}
              >
                {ENV_MODE_OPTIONS.map((option) => (
                  <option key={option.value || 'inherit'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <FieldHint id="env-kind-help">
            Production never places orders. Staging in Full mode may run orders, bookings and
            sandbox payments when the test plan allows them.
          </FieldHint>
          <Button type="submit" disabled={addEnv.isPending}>
            {addEnv.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Save environment
          </Button>
        </form>
      </SettingsSection>
    </div>
  );
}

function CredentialsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const credentials = useQuery({
    queryKey: ['credentials', projectId],
    queryFn: () => projectApi.credentials(projectId),
  });

  const [credName, setCredName] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [sessionLabel, setSessionLabel] = useState('');
  const [sessionJson, setSessionJson] = useState('');

  const addCred = useMutation({
    mutationFn: () => projectApi.createCredential(projectId, { name: credName, username, secret }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['credentials', projectId] });
      setCredName('');
      setUsername('');
      setSecret('');
      toast.success('Credential stored');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not store credential'),
  });

  const addSession = useMutation({
    mutationFn: () =>
      projectApi.createCredential(projectId, {
        name: sessionName,
        type: 'STORAGE_STATE',
        username: sessionLabel,
        secret: sessionJson,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['credentials', projectId] });
      setSessionName('');
      setSessionLabel('');
      setSessionJson('');
      toast.success('Session stored');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not store session'),
  });

  const removeCred = useMutation({
    mutationFn: (credentialId: string) => projectApi.deleteCredential(projectId, credentialId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['credentials', projectId] });
      toast.success('Credential removed');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not remove credential'),
  });

  return (
    <div>
      <SettingsSection
        title="Stored credentials"
        description="Secrets are encrypted at rest and never returned by the API."
      >
        {credentials.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : credentials.isError ? (
          <p className="text-sm text-danger" role="alert">
            Could not load credentials.
          </p>
        ) : credentials.data?.length ? (
          <ItemList>
            {credentials.data.map((credential) => (
              <ItemRow
                key={credential.id}
                icon={credential.type === 'STORAGE_STATE' ? <Cookie /> : <UserRound />}
                title={credential.name}
                meta={credential.username}
                badge={
                  credential.type === 'STORAGE_STATE' ? <Badge variant="info">Session</Badge> : null
                }
                action={
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:bg-well hover:text-danger"
                    disabled={removeCred.isPending}
                    aria-label={`Remove ${credential.name}`}
                    title={`Remove "${credential.name}"?`}
                    description="Audits will no longer be able to sign in with it. The stored secret is deleted."
                    confirmLabel="Remove credential"
                    pending={removeCred.isPending}
                    onConfirm={() => removeCred.mutateAsync(credential.id).catch(() => undefined)}
                  >
                    <Trash2 />
                    <span className="hidden sm:inline">Remove</span>
                  </ConfirmButton>
                }
              />
            ))}
          </ItemList>
        ) : (
          <EmptyRow>No credentials yet. Add one so the auditor can sign in.</EmptyRow>
        )}
      </SettingsSection>

      <SettingsSection
        title="Add username and password"
        description="Used to sign in through your app's login form before exploring."
      >
        <form
          className="max-w-xl space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            addCred.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="cred-name">Name</Label>
            <Input
              id="cred-name"
              placeholder="Test admin"
              value={credName}
              onChange={(e) => setCredName(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="username">Username or email</Label>
              <Input
                id="username"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret">Password</Label>
              <Input
                id="secret"
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                required
              />
            </div>
          </div>
          <FieldHint>Use a dedicated test account, not a real person&apos;s login.</FieldHint>
          <Button type="submit" disabled={addCred.isPending}>
            {addCred.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Encrypt and store
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Add saved session"
        description={
          <>
            For apps behind single sign-on or two-factor login. Sign in once with Playwright, save{' '}
            <code className="mono rounded-[4px] bg-well px-1 py-0.5 text-xs text-ink">
              context.storageState()
            </code>{' '}
            to JSON and paste it here.
          </>
        }
        action={<Badge variant="muted">SSO / MFA</Badge>}
      >
        <form
          className="grid gap-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const parsed = JSON.parse(sessionJson) as { cookies?: unknown };
              if (!parsed || !Array.isArray(parsed.cookies)) {
                throw new Error('missing cookies');
              }
            } catch {
              toast.error(
                'Paste the JSON from context.storageState(). It must contain a cookies array.',
              );
              return;
            }
            addSession.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="session-name">Name</Label>
            <Input
              id="session-name"
              placeholder="Staging SSO"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-label">Label</Label>
            <Input
              id="session-label"
              placeholder="SSO session"
              value={sessionLabel}
              onChange={(e) => setSessionLabel(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="session-json">Storage state JSON</Label>
            <Textarea
              id="session-json"
              className="mono min-h-40 text-xs"
              placeholder='{"cookies": [...], "origins": [...]}'
              maxLength={1_000_000}
              value={sessionJson}
              onChange={(e) => setSessionJson(e.target.value)}
              aria-describedby="session-json-help"
              required
            />
            <FieldHint id="session-json-help">
              Must contain a <span className="mono">cookies</span> array. Sessions expire, so
              refresh this when audits stop getting past the login page.
            </FieldHint>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={addSession.isPending}>
              {addSession.isPending ? <Loader2 className="animate-spin" /> : <Cookie />}
              {addSession.isPending ? 'Saving…' : 'Encrypt and store session'}
            </Button>
          </div>
        </form>
      </SettingsSection>
    </div>
  );
}

function ProjectState({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading project">
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }
  return (
    <p className="text-sm text-danger" role="alert">
      Could not load project.
    </p>
  );
}
