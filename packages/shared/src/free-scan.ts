import { z } from 'zod';

/** Starting a free check from the landing page: just the site address. */
export const startFreeScanBodySchema = z.object({
  url: z.string().trim().min(3).max(2048),
});

/** How many issues the teaser shows in full; the rest need a free account. */
export const FREE_SCAN_PREVIEW_ISSUES = 3;

export type FreeScanPhase = 'queued' | 'running' | 'completed' | 'failed';

export type FreeScanIssue = {
  title: string;
  severity: string;
  category: string;
  /** Page path the issue is on, or null for the whole site. */
  path: string | null;
  description: string;
};

/** What anyone with the link sees of a free check: progress, then a teaser of the results. */
export type FreeScanView = {
  url: string;
  host: string;
  phase: FreeScanPhase;
  /** What the browser is doing right now, while it runs. */
  activity: string | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  claimed: boolean;
  result: {
    designScore: number | null;
    areas: Array<{ area: string; label: string; score: number; issues: number }>;
    totalIssues: number;
    severityCounts: Record<string, number>;
    /** Broken links, errors and other bugs from the quick scan. */
    bugCount: number;
    preview: FreeScanIssue[];
    /** True when there is a homepage screenshot at /public/free-scans/:token/screenshot. */
    screenshot: boolean;
  } | null;
};

/** Normalises what a visitor typed ("shop.com", "https://shop.com/?a=1#x") into an audit URL. */
export function normalizeScanUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  // A real public host: has a dot and a letter-only top-level domain.
  if (!/\.[a-z]{2,}$/i.test(url.hostname)) return null;
  url.hash = '';
  url.search = '';
  return url;
}
