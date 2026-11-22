'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, Globe, Loader2 } from 'lucide-react';
import { normalizeScanUrl } from '@auditor/shared';
import { track } from '@/lib/analytics';
import { ApiError } from '@/lib/api';
import { freeScanApi } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** Example addresses the empty field cycles through, so it reads as "your site goes here". */
const EXAMPLES = ['yourshop.com', 'yourstartup.io', 'yourclient.co.uk', 'yourapp.dev'];
const PROMISES = ['No sign-up', 'About 3 minutes', 'Read-only'];

/**
 * "Paste your site, get a free check": the landing page's main call to action.
 * Starts a design review and quick bug scan with no account, then opens its
 * live page at /check/<token>.
 */
export function FreeCheckForm({ source, className }: { source: 'hero' | 'cta' | 'check-page'; className?: string }) {
  const router = useRouter();
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [example, setExample] = useState(0);

  // Cycle the example while the field is empty and idle (never with reduced motion).
  useEffect(() => {
    if (url || focused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setExample((index) => (index + 1) % EXAMPLES.length), 2600);
    return () => clearInterval(timer);
  }, [url, focused]);

  const start = useMutation({
    mutationFn: freeScanApi.start,
    onSuccess: ({ token, reused }) => {
      track('free_check_started', { source, reused });
      router.push(`/check/${token}`);
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not start the check. Try again in a moment.';
      setError(message);
      track('free_check_failed', { source, stage: 'start', status: err instanceof ApiError ? err.status : 0 });
    },
  });

  return (
    <form
      className={cn('w-full max-w-[540px]', className)}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (!normalizeScanUrl(url)) {
          setError('Enter a website address, like yourshop.com');
          input.current?.focus();
          return;
        }
        start.mutate(url);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Your website address
      </label>
      <div
        onClick={() => input.current?.focus()}
        className={cn(
          'group relative flex cursor-text items-center gap-2 rounded-2xl border bg-[#0e0f12] p-2 pl-4 transition-[border-color,box-shadow] duration-300',
          'shadow-[0_24px_60px_-28px_rgb(255_233_184/0.35)]',
          error
            ? 'border-[#e0695d]'
            : focused
              ? 'border-[var(--lamp)]/70 shadow-[0_0_0_4px_rgb(255_233_184/0.08),0_24px_60px_-24px_rgb(255_233_184/0.45)]'
              : 'border-[#2f3238] hover:border-[#454951]',
        )}
      >
        <Globe aria-hidden className={cn('size-[18px] shrink-0 transition-colors', focused ? 'text-[var(--lamp)]' : 'text-[#6b7079]')} />
        <div className="relative h-11 min-w-0 flex-1">
          <input
            ref={input}
            id={inputId}
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            value={url}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              setUrl(event.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={hintId}
            className="h-full w-full bg-transparent text-[16px] text-[var(--night-ink)]"
            // The whole field glows on focus, so the page-wide focus ring would draw a second box inside it.
            style={{ outline: 'none' }}
          />
          {/* The placeholder, animated: the example address slides in, one after another. */}
          {url ? null : (
            <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-[16px] text-[#5b6068]">
              <span key={EXAMPLES[example]} className={focused ? undefined : 'free-check-example'}>
                {EXAMPLES[example]}
              </span>
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={start.isPending}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[var(--lamp)] px-4 text-[15px] font-semibold text-black transition-[background-color,transform] hover:bg-white active:scale-[0.98] disabled:opacity-70 sm:px-5"
        >
          {start.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          <span className="sm:hidden">{start.isPending ? 'Starting…' : 'Check free'}</span>
          <span className="hidden sm:inline">{start.isPending ? 'Starting…' : 'Check my site free'}</span>
          {start.isPending ? null : <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />}
        </button>
      </div>
      <div id={hintId} className="mt-3.5 min-h-5 pl-1 text-[13px]">
        {error ? (
          <p role="alert" className="text-[#f0a49b]">
            {error}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[#8a8f98]">
            {PROMISES.map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5">
                <Check aria-hidden className="size-3.5 text-[var(--lamp)]" strokeWidth={2.5} />
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
