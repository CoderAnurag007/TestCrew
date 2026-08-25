import { createHash } from 'node:crypto';
import type { SemanticPage } from '@auditor/shared';

export function canonicalizeRoute(url: string): string {
  const parsed = new URL(url);
  const hash = parsed.hash.replace(/^#/, '');
  if (hash.startsWith('/')) {
    return hash.replace(/\/+$/, '') || '/';
  }
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return hash && hash !== '' ? `${path}#${hash}` : path;
}

export function fingerprintState(page: SemanticPage): string {
  const route = page.route || canonicalizeRoute(page.url);
  const interactive = page.elements
    .filter((element) => element.visible && element.inNavigation !== true)
    .map(
      (element) =>
        `${element.type}|${element.role ?? ''}|${element.name ?? ''}|${(element.text ?? element.label ?? '').slice(0, 40)}`,
    )
    .sort()
    .join('\n');
  const payload = [
    canonicalizeUrl(page.url),
    route,
    page.title.trim(),
    page.modalOpen ? 'modal:1' : 'modal:0',
    page.importantText.join('|'),
    page.contentSignature ?? '',
    interactive,
  ].join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

export function canonicalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.sort();
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'session', 'sid'].forEach((key) =>
    parsed.searchParams.delete(key),
  );
  const hash = parsed.hash && parsed.hash !== '#' ? parsed.hash : '';
  return `${parsed.origin}${parsed.pathname}${parsed.search}${hash}`;
}

export function nameForState(page: SemanticPage): string {
  const title = page.title.trim();
  const headings = page.importantText.map((item) => item.trim()).filter(Boolean);
  const route = (page.route || canonicalizeRoute(page.url)).replace(/^\//, '') || '/';
  const looksLikePath = (value: string) => value.includes('/') && !value.includes(' ');
  const specificHeading = [...headings].reverse().find((heading) => {
    if (looksLikePath(heading)) {
      return false;
    }
    if (title && heading.toLowerCase() === title.toLowerCase()) {
      return headings.length === 1;
    }
    return true;
  });
  const routeLeaf = route.split(/[#/?]/).filter(Boolean).at(-1);
  const primary =
    specificHeading || (!looksLikePath(title) && title) || routeLeaf || headings[0] || title || route;
  if (page.modalOpen) {
    return `${primary} (modal)`;
  }
  return primary;
}
