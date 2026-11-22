'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';

/**
 * Shown once on a new user's first run (?welcome=1 from the welcome page, or
 * ?welcome=saved after saving a free check), so they know what happens next.
 */
export function WelcomeBanner({
  live,
  designOnly,
  projectId,
}: {
  live: boolean;
  designOnly: boolean;
  projectId: string | undefined;
}) {
  const [kind, setKind] = useState<string | null>(null);
  useEffect(() => {
    setKind(new URLSearchParams(window.location.search).get('welcome'));
  }, []);
  if (!kind) return null;

  const dismiss = () => {
    setKind(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('welcome');
    window.history.replaceState(null, '', url);
  };

  let title: string;
  let detail: React.ReactNode;
  if (kind === 'saved') {
    title = 'Your free check is saved';
    detail = (
      <>
        Every issue is below with its screenshot and how to fix it. Next, run a full audit: it clicks through up to 40 pages and writes and
        runs tests for your key journeys.
        {projectId ? (
          <>
            {' '}
            <Link href={`/projects/${projectId}`} className="font-medium text-ink underline underline-offset-4">
              Open the site
            </Link>
          </>
        ) : null}
      </>
    );
  } else if (live) {
    title = 'Your first audit is running';
    detail = designOnly
      ? 'The design review takes about 3 minutes. Findings appear here as they are found.'
      : 'First findings appear here within a couple of minutes; the whole audit takes 15–25 minutes. You can close this page, it keeps running and is saved in your dashboard.';
  } else {
    title = 'Your first audit is done';
    detail = 'Each finding has the steps to reproduce it, a screenshot and how to fix it. Share the report with a link from the top of the page.';
  }

  return (
    <div role="status" className="mb-6 flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3.5 sm:px-5">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
      <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed">
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-muted-foreground">{detail}</p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-md p-1 text-muted-foreground hover:bg-well hover:text-ink"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
