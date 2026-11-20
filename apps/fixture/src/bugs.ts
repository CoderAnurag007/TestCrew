/**
 * Ground truth for the benchmark: every bug planted in the fixture app, and how
 * to recognise a finding that reports it. A finding that matches no planted bug
 * is counted as a false positive.
 *
 * `needs` says what the auditor must be able to do to catch the bug:
 * - 'readonly': visible by browsing alone
 * - 'full': only visible when the audit may submit forms (FULL safety mode)
 * - 'ai': only catchable through a plain-English intent, which needs an AI provider
 * - 'transaction': only visible when orders may be placed (staging, FULL, sandbox payment)
 */
export interface FindingLike {
  title: string;
  description?: string | null;
  signature?: string | null;
  url?: string | null;
  category: string;
  severity: string;
}

export interface PlantedBug {
  id: string;
  summary: string;
  needs: 'readonly' | 'full' | 'ai' | 'transaction';
  category: string;
  match: (finding: FindingLike) => boolean;
}

const path = (finding: FindingLike): string => {
  try {
    return new URL(finding.url ?? '').pathname;
  } catch {
    return finding.url ?? '';
  }
};
const text = (finding: FindingLike): string => `${finding.title} ${finding.description ?? ''} ${finding.signature ?? ''}`;

export const PLANTED_BUGS: PlantedBug[] = [
  {
    id: 'B1-reports-500',
    summary: '/reports returns HTTP 500',
    needs: 'readonly',
    category: 'BUG',
    match: (f) => f.category === 'BUG' && (/\/reports\b/.test(text(f)) || path(f) === '/reports') && /500|server error|unavailable/i.test(text(f)),
  },
  {
    id: 'B2-account-crash',
    summary: '/account throws an uncaught JavaScript error',
    needs: 'readonly',
    category: 'BUG',
    match: (f) => f.category === 'BUG' && (path(f) === '/account' || /\/account\b/.test(text(f))) && /uncaught|crash|error/i.test(text(f)),
  },
  {
    id: 'B3-create-empty-500',
    summary: 'Creating a user with an empty name crashes the server (HTTP 500)',
    needs: 'full',
    category: 'BUG',
    match: (f) => f.category === 'BUG' && (/without required|empty|required values/i.test(text(f)) || (/\/users\b/.test(text(f)) && /500/.test(text(f)))) && !/link/i.test(f.title),
  },
  {
    id: 'B4-edit-not-saved',
    summary: 'Saving the edit-user form returns 404 and the change is lost',
    needs: 'full',
    category: 'BUG',
    match: (f) => f.category === 'BUG' && /edit|edited|saved/i.test(text(f)) && /\/users\/\d+/.test(`${f.url ?? ''} ${text(f)}`),
  },
  {
    id: 'B5-broken-logo',
    summary: 'The dashboard logo image (/logo.png) does not load',
    needs: 'readonly',
    category: 'VISUAL',
    match: (f) => /logo\.png/.test(text(f)) || (/broken image|missing resource/i.test(f.title) && path(f) === '/dashboard'),
  },
  {
    id: 'B6-broken-help-link',
    summary: 'The "Help center" link points to /help, which returns 404',
    needs: 'readonly',
    category: 'BUG',
    match: (f) => /\/help\b/.test(text(f)) && /404|broken/i.test(text(f)),
  },
  {
    id: 'B7-search-case-sensitive',
    summary: 'Search is case-sensitive: "ada lovelace" does not find "Ada Lovelace"',
    needs: 'readonly',
    category: 'BUG',
    match: (f) => f.category === 'BUG' && /search/i.test(f.title) && /ada lovelace|grace hopper/i.test(text(f)),
  },
  {
    id: 'B8-list-truncated',
    summary: 'The users list silently shows only two users, so a newly created user never appears',
    needs: 'full',
    category: 'BUG',
    match: (f) => f.category === 'BUG' && /created record|appears in its list|should be listed|new record/i.test(text(f)),
  },
  {
    id: 'B9-cart-double-count',
    summary: '"Add to cart" increases the cart count by 2 instead of 1',
    needs: 'ai',
    category: 'BUG',
    match: (f) => /intent not met/i.test(f.title) && /cart/i.test(f.title),
  },
  {
    id: 'B10-unlabeled-input',
    summary: 'The workspace code field on /settings has no label',
    needs: 'readonly',
    category: 'ACCESSIBILITY',
    match: (f) => f.category === 'ACCESSIBILITY' && path(f) === '/settings' && /accessible name|label/i.test(f.title),
  },
  {
    id: 'B11-overlapping-buttons',
    summary: 'Two buttons on the dashboard overlap',
    needs: 'readonly',
    category: 'VISUAL',
    match: (f) => /overlap/i.test(f.title),
  },
  {
    id: 'B12-logo-missing-alt',
    summary: 'The dashboard logo image has no alt text',
    needs: 'readonly',
    category: 'ACCESSIBILITY',
    match: (f) => f.category === 'ACCESSIBILITY' && /alternative text|alt/i.test(f.title),
  },
  {
    id: 'B13-search-unlabeled',
    summary: 'The dashboard search box has only a placeholder, no label',
    needs: 'readonly',
    category: 'ACCESSIBILITY',
    match: (f) => f.category === 'ACCESSIBILITY' && path(f) === '/dashboard' && /accessible name|label/i.test(f.title),
  },
  {
    id: 'B14-cart-subtotal',
    summary: 'The cart subtotal ignores quantities (2 bottles are charged as 1)',
    needs: 'full',
    category: 'BUG',
    match: (f) => f.category === 'BUG' && /subtotal/i.test(f.title),
  },
  {
    id: 'B15-size-guide-escape',
    summary: 'The "Size guide" popup ignores the Escape key',
    needs: 'readonly',
    category: 'ACCESSIBILITY',
    match: (f) => /size guide/i.test(f.title) && /escape/i.test(f.title),
  },
  {
    id: 'B16-compare-dead',
    summary: 'The "Compare" button on product pages does nothing',
    needs: 'readonly',
    category: 'UX',
    match: (f) => /"compare"/i.test(f.title) && /does nothing/i.test(f.title),
  },
  {
    id: 'B17-order-history',
    summary: 'A placed order is missing from "My orders"',
    needs: 'transaction',
    category: 'BUG',
    match: (f) => f.category === 'BUG' && /order history/i.test(f.title),
  },
  {
    id: 'B18-status-dialog-escape',
    summary: 'The dashboard "Status" dialog ignores the Escape key',
    needs: 'readonly',
    category: 'ACCESSIBILITY',
    match: (f) => /status/i.test(f.title) && /escape/i.test(f.title),
  },
  {
    id: 'B19-dead-overlap-buttons',
    summary: 'The dashboard "Primary" and "Secondary" buttons do nothing',
    needs: 'readonly',
    category: 'UX',
    match: (f) => /"(primary|secondary)"/i.test(f.title) && /does nothing/i.test(f.title),
  },
];

/**
 * Findings that are true statements about the fixture but are not planted bugs
 * (for example generic UX advice). They are neither hits nor false positives.
 */
export const NEUTRAL_FINDING = (finding: FindingLike): boolean => finding.category === 'UX' && finding.severity === 'LOW';

export interface BenchmarkScore {
  detected: string[];
  missed: string[];
  falsePositives: FindingLike[];
  recall: number;
  precision: number;
  recallByNeed: Record<PlantedBug['needs'], { detected: number; total: number }>;
}

export function scoreFindings(findings: FindingLike[], options: { exclude?: Array<PlantedBug['needs']> } = {}): BenchmarkScore {
  const bugs = PLANTED_BUGS.filter((bug) => !(options.exclude ?? []).includes(bug.needs));
  const detected = new Set<string>();
  const falsePositives: FindingLike[] = [];
  let truePositives = 0;
  for (const finding of findings) {
    const hits = PLANTED_BUGS.filter((bug) => bug.match(finding));
    if (hits.length > 0) {
      truePositives += 1;
      for (const hit of hits) detected.add(hit.id);
    } else if (!NEUTRAL_FINDING(finding)) {
      falsePositives.push(finding);
    }
  }
  const recallByNeed = {
    readonly: { detected: 0, total: 0 },
    full: { detected: 0, total: 0 },
    ai: { detected: 0, total: 0 },
    transaction: { detected: 0, total: 0 },
  };
  for (const bug of PLANTED_BUGS) {
    recallByNeed[bug.needs].total += 1;
    if (detected.has(bug.id)) recallByNeed[bug.needs].detected += 1;
  }
  const inScope = bugs.map((bug) => bug.id);
  const hit = inScope.filter((id) => detected.has(id));
  return {
    detected: hit,
    missed: inScope.filter((id) => !detected.has(id)),
    falsePositives,
    recall: inScope.length === 0 ? 1 : hit.length / inScope.length,
    precision: truePositives + falsePositives.length === 0 ? 1 : truePositives / (truePositives + falsePositives.length),
    recallByNeed,
  };
}
