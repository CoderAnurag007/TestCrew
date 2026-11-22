'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ExternalLink,
  FlaskConical,
  Globe,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { DEVICES, type Device, type Environment, type EnvironmentKind, type SafetyMode } from '@auditor/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/premium';
import { track } from '@/lib/analytics';
import { ApiError } from '@/lib/api';
import { runApi, type ProjectDetail } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function SafetyBadge({
  mode,
  className,
}: {
  mode: SafetyMode | null | undefined;
  className?: string;
}) {
  if (mode === 'FULL') {
    return (
      <Badge variant="warning" className={className} title="May submit forms and change data">
        <ShieldAlert className="size-3" aria-hidden />
        Full
      </Badge>
    );
  }
  return (
    <Badge
      variant="muted"
      className={className}
      title="Browse only, data-changing requests are blocked"
    >
      <ShieldCheck className="size-3" aria-hidden />
      Read-only
    </Badge>
  );
}

export function EnvironmentKindBadge({
  kind,
  className,
}: {
  kind: EnvironmentKind | null | undefined;
  className?: string;
}) {
  if (kind === 'STAGING') {
    return (
      <Badge variant="info" className={className}>
        <FlaskConical className="size-3" aria-hidden />
        Staging
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={className}>
      <Globe className="size-3" aria-hidden />
      Production
    </Badge>
  );
}

/** The environment audits use unless the user picks another: the first Production one, else the first. */
export function defaultEnvironment(project: ProjectDetail | undefined): Environment | undefined {
  const environments = project?.environments ?? [];
  return (
    environments.find((environment) => (environment.kind ?? 'PRODUCTION') === 'PRODUCTION') ??
    environments[0]
  );
}

/** Starts an audit on the chosen environment (default: Production) and opens the live run. */
export function useStartAudit(projectId: string, project: ProjectDetail | undefined) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (choice?: { environmentId?: string; device?: Device; bugAudit?: boolean; designReview?: boolean }) =>
      runApi.create(projectId, {
        environmentId: choice?.environmentId ?? defaultEnvironment(project)?.id,
        device: choice?.device,
        bugAudit: choice?.bugAudit,
        designReview: choice?.designReview,
      }),
    onSuccess: async (run) => {
      track('audit_started', { first: false, type: run.bugAudit === false ? 'design' : run.designReview ? 'full' : 'bugs', device: run.device });
      await queryClient.invalidateQueries({ queryKey: ['runs', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      toast.success(run.bugAudit === false ? 'Design review queued' : 'Audit queued');
      router.push(`/runs/${run.id}`);
    },
    onError: (error) => {
      // Plan limits get their own upgrade dialog.
      if (error instanceof ApiError && error.status === 402) return;
      toast.error(error instanceof ApiError ? error.message : 'Could not start audit');
    },
  });
}

export function StartAuditButton({
  projectId,
  project,
  className,
  size = 'default',
}: {
  projectId: string;
  project: ProjectDetail | undefined;
  className?: string;
  size?: 'default' | 'sm' | 'lg';
}) {
  const start = useStartAudit(projectId, project);
  const environments = project?.environments ?? [];
  const fallback = defaultEnvironment(project);
  // What this audit checks; starts from the project's setting until changed here.
  const [chosenChecks, setChecks] = useState<{ bugs: boolean; design: boolean } | null>(null);
  const checks = chosenChecks ?? { bugs: true, design: Boolean(project?.designReview) };
  const what = { bugAudit: checks.bugs, designReview: checks.design };
  const label = start.isPending ? 'Starting…' : checks.bugs ? 'Start audit' : 'Start design review';
  const icon = start.isPending ? <Loader2 className="animate-spin" /> : <Play />;

  return (
    <div className={cn('inline-flex rounded-md', className)} role="group" aria-label="Start audit">
      <Button
        size={size}
        className="rounded-r-none"
        onClick={() => start.mutate({ environmentId: fallback?.id, ...what })}
        disabled={start.isPending || !project}
        title={
          fallback
            ? `${checks.bugs ? `Audit ${fallback.name}${checks.design ? ' with a design review' : ''}` : `Design review of ${fallback.name}`} on desktop Chrome`
            : undefined
        }
      >
        {icon}
        {label}
        {fallback ? <span className="sr-only"> on {fallback.name}</span> : null}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size={size}
            className="rounded-l-none border-l border-white/20 px-2.5"
            disabled={start.isPending || !project}
            aria-label="Choose device or environment to audit"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-[min(20rem,calc(100vw-2rem))]">
          <DropdownMenuLabel>Check for</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={checks.bugs}
            disabled={checks.bugs && !checks.design}
            onCheckedChange={(value) => setChecks({ ...checks, bugs: Boolean(value) })}
          >
            <span className="block font-medium text-ink">Bugs and broken flows</span>
            <span className="block text-[12px] text-muted-foreground">Clicks through every page, button and form · 15–25 min</span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={checks.design}
            disabled={checks.design && !checks.bugs}
            onCheckedChange={(value) => setChecks({ ...checks, design: Boolean(value) })}
          >
            <span className="block font-medium text-ink">Design review</span>
            <span className="block text-[12px] text-muted-foreground">Layout, readability, phone and accessibility from screenshots · 2–4 min</span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{checks.bugs ? 'Audit' : 'Review'} {fallback ? fallback.name : 'the site'} as</DropdownMenuLabel>
          {(Object.keys(DEVICES) as Device[]).map((device) => (
            <DropdownMenuItem
              key={device}
              onSelect={() => start.mutate({ environmentId: fallback?.id, device, ...what })}
              className="flex-col items-stretch gap-0.5 px-2 py-1.5"
            >
              <span className="font-medium text-ink">{DEVICES[device].label}</span>
              <span className="text-[12px] text-muted-foreground">
                {DEVICES[device].mobile ? 'Phone screen, touch' : 'Laptop screen'}
              </span>
            </DropdownMenuItem>
          ))}
          {environments.length > 1 ? <DropdownMenuSeparator /> : null}
          {environments.length > 1 ? <DropdownMenuLabel>Audit environment</DropdownMenuLabel> : null}
          {(environments.length > 1 ? environments : []).map((environment) => {
            const mode = environment.safetyMode ?? project?.safetyMode ?? 'READ_ONLY';
            return (
              <DropdownMenuItem
                key={environment.id}
                onSelect={() => start.mutate({ environmentId: environment.id, ...what })}
                className="flex-col items-stretch gap-1 px-2 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-ink">{environment.name}</span>
                  {environment.id === fallback?.id ? (
                    <span className="text-[12px] text-muted-foreground">Default</span>
                  ) : null}
                </span>
                <span className="mono truncate text-[12px] text-muted-foreground">
                  {environment.baseUrl}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <EnvironmentKindBadge kind={environment.kind} />
                  <SafetyBadge mode={mode} />
                  {environment.safetyMode == null ? (
                    <span className="text-[12px] text-muted-foreground">Inherited</span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const SUBNAV = [
  { suffix: '', label: 'Overview' },
  { suffix: '/runs', label: 'Runs' },
  { suffix: '/settings', label: 'Settings' },
];

/** Shared header for the project overview, runs and settings pages. */
export function ProjectHeader({
  projectId,
  project,
  loading,
  error,
  actions,
}: {
  projectId: string;
  project: ProjectDetail | undefined;
  loading?: boolean;
  error?: boolean;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <div className="mb-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Link
            href="/projects"
            className="mb-1 inline-block text-[13px] text-muted-foreground transition-colors hover:text-ink"
          >
            Projects
          </Link>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          ) : error ? (
            <div>
              <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                Project unavailable
              </h1>
              <p className="mt-1.5 text-sm text-danger" role="alert">
                Could not load this project. It may have been deleted or you may not have access.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                  {project?.name ?? 'Project'}
                </h1>
                <SafetyBadge mode={project?.safetyMode} />
              </div>
              {project ? (
                <a
                  href={project.baseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mono mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-[4px] text-[13px] text-muted-foreground transition-colors hover:text-cobalt"
                >
                  <span className="truncate">{project.baseUrl}</span>
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : null}
              {project?.description ? (
                <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
                  {project.description}
                </p>
              ) : null}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <StartAuditButton projectId={projectId} project={project} />
        </div>
      </div>
      <nav
        aria-label="Project sections"
        className="mt-6 flex h-10 items-stretch gap-5 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SUBNAV.map((item) => {
          const href = `${base}${item.suffix}`;
          const active = pathname === href;
          return (
            <Link
              key={item.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px inline-flex items-center whitespace-nowrap border-b-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cobalt',
                active
                  ? 'border-ink text-ink'
                  : 'border-transparent text-muted-foreground hover:text-ink',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
