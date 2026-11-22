'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { normalizeScanUrl } from '@auditor/shared';
import { useSession } from '@/components/session-provider';
import { Brand } from '@/components/shell/brand';
import { useEnsureWorkspace } from '@/components/shell/use-ensure-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { track } from '@/lib/analytics';
import { ApiError } from '@/lib/api';
import { freeScanApi, projectApi, runApi } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * First run after sign-up: from a new account to an audit running in under a minute.
 *
 * With ?scan=<token> (signed up from a free check) it saves that check into the
 * new workspace and opens its report. Otherwise it asks for one thing, the site
 * address, starts the first audit and opens it live.
 */
export default function WelcomePage() {
  const { user, isLoading } = useSession();
  const { workspace, failed } = useEnsureWorkspace();
  const [scan, setScan] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setScan(new URLSearchParams(window.location.search).get('scan'));
  }, []);

  const ready = Boolean(user && workspace) && scan !== undefined;

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 max-w-[1080px] items-center justify-between px-4 sm:px-6">
        <Brand />
        {user ? (
          <Link href="/dashboard" className="text-[13.5px] text-muted-foreground hover:text-ink">
            Skip to dashboard
          </Link>
        ) : null}
      </header>
      <main className="mx-auto max-w-[640px] px-4 pb-20 pt-8 sm:px-6 sm:pt-14">
        {failed ? (
          <p role="alert" className="text-sm text-danger">
            Could not set up your workspace. <Link href="/dashboard" className="underline">Open the dashboard</Link> to try again.
          </p>
        ) : !ready || isLoading ? (
          <div className="flex items-center gap-3 text-[15px] text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Setting up your workspace…
          </div>
        ) : scan ? (
          <SaveFreeCheck token={scan} organizationId={workspace!.id} />
        ) : (
          <FirstAudit organizationId={workspace!.id} firstName={user!.name?.trim().split(/\s+/)[0] ?? ''} />
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------ add the first site */

type Checks = 'full' | 'design';

function FirstAudit({ organizationId, firstName }: { organizationId: string; firstName: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [checks, setChecks] = useState<Checks>('full');
  const [error, setError] = useState<string | null>(null);

  // Someone who already has a site doesn't need this page.
  const projects = useQuery({ queryKey: ['projects', organizationId], queryFn: () => projectApi.list(organizationId) });
  useEffect(() => {
    if (projects.data && projects.data.length > 0) router.replace('/dashboard');
  }, [projects.data, router]);

  const start = useMutation({
    mutationFn: async (address: URL) => {
      const host = address.hostname.replace(/^www\./, '');
      const project = await projectApi.create({
        organizationId,
        name: host,
        baseUrl: address.toString(),
        environmentName: 'Production',
        safetyMode: 'READ_ONLY',
        designReview: true,
      });
      track('site_added', { first: true });
      const run = await runApi.create(project.id, { bugAudit: checks === 'full', designReview: true });
      track('audit_started', { first: true, type: checks });
      return run;
    },
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ['projects', organizationId] });
      await queryClient.invalidateQueries({ queryKey: ['onboarding', organizationId] });
      router.replace(`/runs/${run.id}?welcome=1`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not start the audit. Try again.'),
  });

  if (projects.isLoading || (projects.data && projects.data.length > 0)) {
    return <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />;
  }

  return (
    <>
      <Steps current={0} />
      <h1 className="display mt-8 text-[32px] text-ink sm:text-[38px]">
        {firstName ? `Welcome, ${firstName}.` : 'Welcome.'} Which site should we check first?
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        Paste its address and your first audit starts right away. First findings show up within a couple of minutes.
      </p>
      <form
        className="mt-8 space-y-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const address = normalizeScanUrl(url);
          if (!address) {
            setError('Enter your website address, like yourshop.com');
            return;
          }
          start.mutate(address);
        }}
      >
        {error ? (
          <p role="alert" className="rounded-md border border-[#f2c4bf] bg-[#fdf1ef] px-3 py-2.5 text-sm text-[#a32418]">
            {error}
          </p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="site-url">Website address</Label>
          <Input
            id="site-url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="yourshop.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="h-12 text-[16px]"
            autoFocus
          />
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-ink">What should it check?</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Choice
              name="checks"
              value="full"
              checked={checks === 'full'}
              onChange={() => setChecks('full')}
              title="Full audit"
              badge="Recommended"
              detail="Bugs and design. Clicks through up to 40 pages, then writes and runs tests. 15–25 minutes."
            />
            <Choice
              name="checks"
              value="design"
              checked={checks === 'design'}
              onChange={() => setChecks('design')}
              title="Design review only"
              detail="Layout, readability, accessibility and phone. About 3 minutes."
            />
          </div>
        </fieldset>
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          Read-only: it browses and clicks like a visitor and never submits orders or changes your data.
        </p>
        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={start.isPending}>
          {start.isPending ? <Loader2 className="animate-spin" /> : null}
          {start.isPending ? 'Starting your audit…' : 'Start my first audit'}
        </Button>
      </form>
    </>
  );
}

function Choice({
  name,
  value,
  checked,
  onChange,
  title,
  detail,
  badge,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  detail: string;
  badge?: string;
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col rounded-lg border p-4 transition-colors',
        checked ? 'border-ink bg-card shadow-[0_0_0_1px_var(--color-ink)]' : 'border-border bg-card hover:border-[#c4c7cc]',
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      <span className="flex items-center justify-between gap-2">
        <span className="text-[14.5px] font-medium text-ink">{title}</span>
        {badge ? <span className="rounded-full bg-well px-2 py-0.5 text-[11.5px] text-muted-foreground">{badge}</span> : null}
      </span>
      <span className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{detail}</span>
    </label>
  );
}

function Steps({ current }: { current: number }) {
  const steps = ['Add your site', 'First audit runs', 'Read the report'];
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]" aria-label="Getting started">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              'flex size-5 items-center justify-center rounded-full border text-[11px] font-medium',
              index === current ? 'border-ink bg-ink text-white' : 'border-border text-muted-foreground',
            )}
          >
            {index + 1}
          </span>
          <span className={index === current ? 'font-medium text-ink' : 'text-muted-foreground'} aria-current={index === current ? 'step' : undefined}>
            {step}
          </span>
          {index < steps.length - 1 ? <span aria-hidden className="ml-1 h-px w-6 bg-border" /> : null}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------ save a free check */

function SaveFreeCheck({ token, organizationId }: { token: string; organizationId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const check = useQuery({
    queryKey: ['free-check', token],
    queryFn: () => freeScanApi.get(token),
    retry: false,
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return phase === 'queued' || phase === 'running' ? 2500 : false;
    },
  });

  const claim = useMutation({
    mutationFn: () => freeScanApi.claim(token, organizationId),
    onSuccess: async ({ runId, alreadyClaimed }) => {
      if (!alreadyClaimed) track('free_check_claimed');
      await queryClient.invalidateQueries({ queryKey: ['projects', organizationId] });
      await queryClient.invalidateQueries({ queryKey: ['onboarding', organizationId] });
      router.replace(`/runs/${runId}?welcome=saved`);
    },
  });

  const phase = check.data?.phase;
  const attempted = useRef(false);
  useEffect(() => {
    if (phase !== 'completed' || attempted.current) return;
    attempted.current = true;
    claim.mutate();
  }, [phase, claim]);

  if (check.isError) {
    return (
      <Problem
        title="That free check has expired"
        detail="Free checks are kept for 14 days. Add your site and run a full audit instead."
      />
    );
  }
  if (phase === 'failed') {
    return <Problem title="The free check didn’t finish" detail="Add your site and we’ll run a full audit, which tries harder to load it." />;
  }
  if (claim.isError) {
    const message = claim.error instanceof ApiError ? claim.error.message : 'Could not save the check.';
    return <Problem title="Couldn’t save the free check" detail={message} />;
  }
  return (
    <div role="status" className="rounded-xl border border-border bg-card p-6 sm:p-8">
      <p className="flex items-center gap-3 text-[16px] font-medium text-ink">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {phase === 'completed' ? 'Saving your free check…' : 'Finishing your free check…'}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
        {phase === 'completed'
          ? 'Adding the site and its report to your workspace.'
          : `Still checking ${check.data?.host ?? 'your site'}. It’s saved to your workspace and opened as soon as it finishes, usually within a few minutes.`}
      </p>
    </div>
  );
}

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
      <p className="text-[16px] font-medium text-ink">{title}</p>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{detail}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button asChild>
          <a href="/welcome">Add your site</a>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Go to the dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
