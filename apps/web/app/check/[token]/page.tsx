'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Lock } from 'lucide-react';
import { TRIAL_DAYS, type FreeScanIssue, type FreeScanView } from '@auditor/shared';
import { FreeCheckForm } from '@/components/landing/free-check-form';
import { useSession } from '@/components/session-provider';
import { Brand } from '@/components/shell/brand';
import { track } from '@/lib/analytics';
import { ApiError } from '@/lib/api';
import { freeScanApi } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** A free check usually takes about this long; the progress bar is paced by it. */
const TYPICAL_SECONDS = 180;

const STEPS = [
  { label: 'Opening your site in a fresh browser', from: 0 },
  { label: 'Quick bug scan: links, errors, broken images', from: 12 },
  { label: 'Design review on desktop and phone', from: 55 },
  { label: 'Scoring and writing up what it found', from: 150 },
];

const SEVERITY: Record<string, { label: string; dot: string }> = {
  CRITICAL: { label: 'Critical', dot: 'bg-[#e0695d]' },
  HIGH: { label: 'High', dot: 'bg-[#e0695d]' },
  MEDIUM: { label: 'Medium', dot: 'bg-[#e3a24a]' },
  LOW: { label: 'Low', dot: 'bg-[#8a8f98]' },
  INFO: { label: 'Info', dot: 'bg-[#5b6068]' },
};

export default function FreeCheckPage() {
  const { token } = useParams<{ token: string }>();
  const check = useQuery({
    queryKey: ['free-check', token],
    queryFn: () => freeScanApi.get(token),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 3,
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return phase === 'completed' || phase === 'failed' ? false : 2500;
    },
  });

  return (
    <div className="night min-h-screen">
      <header className="border-b border-[var(--night-line)]">
        <div className="mx-auto flex h-16 max-w-[1080px] items-center justify-between px-4 sm:px-6">
          <Brand tone="night" />
          <Link href={`/login?scan=${encodeURIComponent(token)}`} className="text-[14px] text-[var(--night-dim)] hover:text-[var(--night-ink)]">
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1080px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        {check.isLoading ? (
          <div className="space-y-4" aria-label="Loading the check">
            <div className="h-8 w-56 animate-pulse rounded bg-[var(--night-raised)]" />
            <div className="h-48 animate-pulse rounded-xl bg-[var(--night-raised)]" />
          </div>
        ) : check.isError || !check.data ? (
          <Missing gone={check.error instanceof ApiError && check.error.status === 404} />
        ) : (
          <CheckView token={token} data={check.data} />
        )}
      </main>
    </div>
  );
}

function Missing({ gone }: { gone: boolean }) {
  return (
    <div className="mx-auto max-w-[520px] py-10">
      <h1 className="display text-[32px]">{gone ? 'This check has expired' : 'Could not load the check'}</h1>
      <p className="mt-3 text-[15px] text-[var(--night-dim)]">
        {gone ? 'Free checks are kept for 14 days. Run a new one, it takes about three minutes.' : 'Check your connection and reload the page.'}
      </p>
      <FreeCheckForm source="check-page" className="mt-8" />
    </div>
  );
}

function CheckView({ token, data }: { token: string; data: FreeScanView }) {
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    if (data.phase === 'completed' && data.result) {
      reported.current = true;
      track('free_check_completed', { score: data.result.designScore, issues: data.result.totalIssues, bugs: data.result.bugCount });
    } else if (data.phase === 'failed') {
      reported.current = true;
      track('free_check_failed', { stage: 'run' });
    }
  }, [data]);

  return (
    <>
      <div className="index-label text-[var(--night-dim)]">Free check</div>
      <h1 className="display mt-3 break-words text-[34px] sm:text-[48px]">{data.host.replace(/^www\./, '')}</h1>
      {data.phase === 'completed' && data.result ? (
        <Results token={token} data={data} result={data.result} />
      ) : data.phase === 'failed' ? (
        <Failed data={data} />
      ) : (
        <Progress data={data} />
      )}
    </>
  );
}

/* --------------------------------------------------------------- running */

function useElapsed(startedAt: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
}

function Progress({ data }: { data: FreeScanView }) {
  const elapsed = useElapsed(data.startedAt);
  const queued = data.phase === 'queued';
  const current = queued ? 0 : STEPS.reduce((index, step, position) => (elapsed >= step.from ? position : index), 0);
  // Never claims to be done before it is: the bar eases towards 95% and waits there.
  const percent = queued ? 3 : Math.min(95, Math.round((elapsed / TYPICAL_SECONDS) * 100));
  const remaining = Math.max(0, TYPICAL_SECONDS - elapsed);

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section aria-live="polite" className="rounded-xl border border-[var(--night-line)] bg-[var(--night-raised)] p-6 sm:p-8">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[15px] font-medium">{queued ? 'Waiting for a free browser…' : 'Checking your site'}</p>
          <p className="mono text-[13px] text-[var(--night-dim)]">
            {remaining > 0 && !queued ? `about ${Math.max(1, Math.ceil(remaining / 60))} min left` : queued ? '' : 'almost done'}
          </p>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--night-line)]">
          <div className="h-full rounded-full bg-[var(--lamp)] transition-[width] duration-1000 ease-out" style={{ width: `${percent}%` }} />
        </div>
        <ol className="mt-7 space-y-4">
          {STEPS.map((step, index) => {
            const done = !queued && index < current;
            const active = !queued && index === current;
            return (
              <li key={step.label} className="flex items-center gap-3 text-[14.5px]">
                <span
                  aria-hidden
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border',
                    done ? 'border-[var(--night-ink)] bg-[var(--night-ink)] text-black' : active ? 'border-[var(--lamp)]' : 'border-[var(--night-faint)]',
                  )}
                >
                  {done ? <Check className="size-3.5" /> : active ? <span className="size-2 animate-pulse rounded-full bg-[var(--lamp)]" /> : null}
                </span>
                <span className={done || active ? 'text-[var(--night-ink)]' : 'text-[#5b6068]'}>
                  {step.label}
                  <span className="sr-only">{done ? ' (done)' : active ? ' (in progress)' : ''}</span>
                </span>
              </li>
            );
          })}
        </ol>
        {data.activity ? (
          <p className="mono mt-7 truncate border-t border-[var(--night-line)] pt-4 text-[12.5px] text-[var(--night-dim)]" title={data.activity}>
            {data.activity}
          </p>
        ) : null}
      </section>
      <section className="rounded-xl border border-[var(--night-line)] p-6 sm:p-8">
        <h2 className="text-[15px] font-medium">What you will get</h2>
        <ul className="mt-5 space-y-4 text-[14px] leading-relaxed text-[var(--night-dim)]">
          <li>
            <span className="text-[var(--night-ink)]">A design score out of 100</span>, across layout, readability, accessibility, consistency
            and how it looks on a phone.
          </li>
          <li>
            <span className="text-[var(--night-ink)]">The first bugs</span>: broken links, page errors and images that don’t load.
          </li>
          <li>
            <span className="text-[var(--night-ink)]">How to fix each one</span>, with a screenshot of where it is.
          </li>
        </ul>
        <p className="mt-6 text-[13px] text-[#6b7079]">You can leave this page open; it updates on its own.</p>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- failed */

function Failed({ data }: { data: FreeScanView }) {
  return (
    <div className="mt-8 max-w-[620px] rounded-xl border border-[var(--night-line)] bg-[var(--night-raised)] p-6 sm:p-8">
      <p className="text-[16px] font-medium">We couldn’t finish checking this site</p>
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--night-dim)]">
        {friendlyError(data.error)} Some sites block automated browsers or need a sign-in first. Try the address again, or another page of
        the site.
      </p>
      <FreeCheckForm source="check-page" className="mt-6" />
    </div>
  );
}

function friendlyError(error: string | null): string {
  if (!error) return 'The check stopped before it could finish.';
  if (/net::|ERR_|timeout|Timeout|could not open/i.test(error)) return 'The site did not load for our browser in time.';
  return error.length > 160 ? `${error.slice(0, 157)}…` : error;
}

/* --------------------------------------------------------------- results */

function grade(score: number): { word: string; tone: string } {
  if (score >= 90) return { word: 'Strong', tone: 'text-[#7fd1a0]' };
  if (score >= 75) return { word: 'Good, with fixes to make', tone: 'text-[var(--lamp)]' };
  if (score >= 55) return { word: 'Needs work', tone: 'text-[#e3a24a]' };
  return { word: 'Hurting your visitors', tone: 'text-[#f0a49b]' };
}

function Results({ token, data, result }: { token: string; data: FreeScanView; result: NonNullable<FreeScanView['result']> }) {
  const { user } = useSession();
  const score = result.designScore;
  const serious = (result.severityCounts.CRITICAL ?? 0) + (result.severityCounts.HIGH ?? 0);
  const locked = Math.max(0, result.totalIssues - result.preview.length);
  const minutes = data.completedAt ? Math.max(1, Math.round((new Date(data.completedAt).getTime() - new Date(data.startedAt).getTime()) / 60000)) : null;

  return (
    <div className="mt-8 space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="rounded-xl border border-[var(--night-line)] bg-[var(--night-raised)] p-6 sm:p-8">
          <p className="index-label text-[var(--night-dim)]">Design score</p>
          {score != null ? (
            <>
              <p className="mt-3 flex items-baseline gap-2">
                <span className="font-display text-[72px] font-bold leading-none [font-stretch:125%]">{Math.round(score)}</span>
                <span className="text-[18px] text-[var(--night-dim)]">/ 100</span>
              </p>
              <p className={cn('mt-2 text-[15px] font-medium', grade(score).tone)}>{grade(score).word}</p>
            </>
          ) : (
            <p className="mt-3 text-[15px] text-[var(--night-dim)]">The design review could not score this site.</p>
          )}
          {result.areas.length ? (
            <ul className="mt-7 space-y-3">
              {result.areas.map((area) => (
                <li key={area.area} className="grid grid-cols-[110px_minmax(0,1fr)_32px] items-center gap-3 text-[13px]">
                  <span className="text-[var(--night-dim)]">{area.label}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-[var(--night-line)]">
                    <span
                      className={cn('block h-full rounded-full', area.score >= 90 ? 'bg-[#7fd1a0]' : area.score >= 75 ? 'bg-[var(--lamp)]' : 'bg-[#e3a24a]')}
                      style={{ width: `${area.score}%` }}
                    />
                  </span>
                  <span className="mono text-right text-[var(--night-ink)]">{area.score}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-xl border border-[var(--night-line)]">
          {result.screenshot ? (
            <div className="relative">
              <img
                src={freeScanApi.screenshotUrl(token)}
                alt={`The homepage of ${data.host}`}
                className="block max-h-[340px] w-full object-cover object-top"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-5 pb-4 pt-16 text-[13px] text-[var(--night-ink)]">
                Each issue is marked on screenshots like this in the full report.
              </div>
            </div>
          ) : null}
          <dl className="grid grid-cols-3 divide-x divide-[var(--night-line)] border-t border-[var(--night-line)] first:border-t-0">
            <Stat label="Issues found" value={result.totalIssues} />
            <Stat label="High priority" value={serious} />
            <Stat label="Bugs" value={result.bugCount} />
          </dl>
        </section>
      </div>

      <section className="rounded-xl border border-[var(--night-line)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--night-line)] px-6 py-4">
          <h2 className="text-[16px] font-medium">{result.totalIssues ? 'What we found' : 'Nothing to fix on this first look'}</h2>
          {minutes ? <p className="text-[13px] text-[var(--night-dim)]">Checked in {minutes} min</p> : null}
        </div>
        {result.totalIssues === 0 ? (
          <p className="px-6 py-6 text-[14px] leading-relaxed text-[var(--night-dim)]">
            The homepage looks clean. A full audit goes much deeper: it clicks through up to 40 pages, fills forms, and writes and runs tests
            for your key journeys.
          </p>
        ) : (
          <ol className="divide-y divide-[var(--night-line)]">
            {result.preview.map((issue, index) => (
              <IssueRow key={`${issue.title}-${index}`} issue={issue} />
            ))}
            {locked > 0 ? <LockedRows count={locked} /> : null}
          </ol>
        )}
      </section>

      <Unlock token={token} data={data} locked={locked} signedIn={Boolean(user)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-5 py-5">
      <dt className="text-[12.5px] text-[var(--night-dim)]">{label}</dt>
      <dd className="font-display mt-1 text-[28px] font-bold leading-none [font-stretch:125%]">{value}</dd>
    </div>
  );
}

function IssueRow({ issue }: { issue: FreeScanIssue }) {
  const severity = SEVERITY[issue.severity] ?? SEVERITY.LOW!;
  return (
    <li className="px-6 py-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--night-dim)]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn('size-2 rounded-full', severity.dot)} />
          {severity.label}
        </span>
        {issue.path ? <span className="mono truncate">{issue.path}</span> : null}
      </div>
      <p className="mt-1.5 text-[15.5px] font-medium text-[var(--night-ink)]">{issue.title}</p>
      <p className="mt-1 text-[14px] leading-relaxed text-[var(--night-dim)]">{issue.description}</p>
    </li>
  );
}

function LockedRows({ count }: { count: number }) {
  const shown = Math.min(count, 3);
  return (
    <li className="relative px-6 py-5">
      <div aria-hidden className="select-none space-y-4 blur-[5px]">
        {Array.from({ length: shown }, (_, index) => (
          <div key={index}>
            <div className="h-3 w-24 rounded bg-[var(--night-faint)]" />
            <div className="mt-2 h-4 w-3/4 rounded bg-[var(--night-faint)]" />
            <div className="mt-2 h-3 w-full rounded bg-[var(--night-line)]" />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-[var(--night-faint)] bg-[var(--night)] px-4 py-2 text-[13.5px]">
          <Lock className="size-3.5" aria-hidden />
          {count} more issue{count === 1 ? '' : 's'} with screenshots and fixes
        </p>
      </div>
    </li>
  );
}

function Unlock({ token, data, locked, signedIn }: { token: string; data: FreeScanView; locked: number; signedIn: boolean }) {
  const scan = encodeURIComponent(token);
  if (data.claimed) {
    return (
      <section className="rounded-xl border border-[var(--night-line)] px-6 py-6 text-[14px] text-[var(--night-dim)]">
        This check is saved to an account.{' '}
        <Link href="/login" className="text-[var(--night-ink)] underline underline-offset-4">
          Sign in
        </Link>{' '}
        to see the full report.
      </section>
    );
  }
  const headline = locked > 0 ? `See all ${data.result?.totalIssues ?? locked} issues, free` : 'Get the full report, free';
  return (
    <section className="rounded-xl border border-[var(--lamp)]/40 bg-[var(--night-raised)] px-6 py-7 sm:px-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-[56ch]">
          <h2 className="text-[20px] font-semibold">{headline}</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--night-dim)]">
            {signedIn
              ? 'Save this check to your workspace to see every issue, marked on its screenshot, with how to fix it.'
              : `Create a free account to see every issue marked on its screenshot, with how to fix it. You also get ${TRIAL_DAYS} days of Pro: full audits that click through up to 40 pages and write and run tests. No card needed.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:flex-row sm:items-center md:flex-col md:items-end">
          <Link
            href={signedIn ? `/welcome?scan=${scan}` : `/register?scan=${scan}`}
            onClick={() => track('free_check_signup_clicked', { signedIn, locked })}
            className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[var(--lamp)] px-5 text-[15px] font-medium text-black transition-colors hover:bg-white"
          >
            {signedIn ? 'Save to my workspace' : 'See the full report'} <ArrowRight className="size-4" aria-hidden />
          </Link>
          {signedIn ? null : (
            <Link href={`/login?scan=${scan}`} className="text-[13.5px] text-[var(--night-dim)] underline-offset-4 hover:text-[var(--night-ink)] hover:underline">
              I already have an account
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
