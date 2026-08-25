export interface DuplicateCandidate {
  id?: string;
  title: string;
  url?: string | null;
  component?: string | null;
  signature?: string | null;
  error?: string | null;
  category?: string;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findingSignature(input: DuplicateCandidate): string {
  const urlPath = safePath(input.url);
  return [input.category ?? '', urlPath, normalizeTitle(input.title), (input.error ?? '').slice(0, 80)].join('|');
}

export function tokenSimilarity(left: string, right: string): number {
  const a = new Set(normalizeTitle(left).split(' ').filter(Boolean));
  const b = new Set(normalizeTitle(right).split(' ').filter(Boolean));
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const token of a) {
    if (b.has(token)) {
      inter += 1;
    }
  }
  return inter / new Set([...a, ...b]).size;
}

export class DuplicateDetector {
  isDuplicate(left: DuplicateCandidate, right: DuplicateCandidate): boolean {
    if (left.signature && right.signature && left.signature === right.signature) {
      return true;
    }
    if (findingSignature(left) === findingSignature(right)) {
      return true;
    }
    const sameUrl = safePath(left.url) === safePath(right.url) && Boolean(safePath(left.url));
    const sameComponent = Boolean(left.component) && left.component === right.component;
    const similar = tokenSimilarity(left.title, right.title) >= 0.72;
    const sameError = Boolean(left.error) && left.error === right.error;
    return (sameUrl && similar) || (sameComponent && similar) || (sameError && similar);
  }

  merge<T extends DuplicateCandidate>(findings: T[]): T[] {
    const kept: T[] = [];
    for (const finding of findings) {
      const existing = kept.find((item) => this.isDuplicate(item, finding));
      if (!existing) {
        kept.push(finding);
      }
    }
    return kept;
  }
}

function safePath(url?: string | null): string {
  if (!url) {
    return '';
  }
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
