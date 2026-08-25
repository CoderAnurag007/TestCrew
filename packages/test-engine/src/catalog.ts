import type { CandidateAction, DiscoveredElement, SemanticPage, SelectorMeta } from '@auditor/shared';

export function catalogFromSemantic(page: SemanticPage, stateId?: string): DiscoveredElement[] {
  return page.elements.map((element) => ({
    id: element.id,
    stateId,
    url: page.url,
    title: page.title,
    type: element.type,
    label: (element.label ?? element.text ?? element.name ?? element.type).trim() || element.type,
    href: element.href,
    category: categoryFor(element.type, element.label ?? element.text, element.href),
    riskLevel: element.riskLevel,
    inputType: element.inputType,
    selectors: element.selectors,
  }));
}

export function catalogFromActions(
  actions: Array<{
    id: string;
    type: string;
    selector?: string | null;
    target?: string | null;
    href?: string | null;
    label?: string | null;
    category?: string | null;
    riskLevel?: DiscoveredElement['riskLevel'];
    sourceStateId?: string | null;
    selectors?: SelectorMeta | null;
  }>,
  urlByStateId: Map<string, string>,
): DiscoveredElement[] {
  const catalog: DiscoveredElement[] = [];
  for (const action of actions) {
    const primary = action.selectors?.primary ?? action.target ?? action.selector;
    if (!primary) {
      continue;
    }
    const selectors = action.selectors ?? selectorsFromPrimary(primary);
    catalog.push({
      id: action.id,
      stateId: action.sourceStateId ?? undefined,
      url: (action.sourceStateId && urlByStateId.get(action.sourceStateId)) || '',
      type: action.type,
      label: action.label ?? primary,
      href: action.href,
      category: action.category ?? 'other',
      riskLevel: action.riskLevel ?? 'SAFE',
      selectors,
    });
  }
  return catalog;
}

export function mergeCatalogs(...lists: DiscoveredElement[][]): DiscoveredElement[] {
  const seen = new Set<string>();
  const merged: DiscoveredElement[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = `${item.selectors.primary}|${item.href ?? ''}|${item.label}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

export function selectorsFromPrimary(primary: string): SelectorMeta {
  const testId = primary.match(/\[data-testid=["']([^"']+)["']\]/)?.[1] ?? null;
  const id = primary.startsWith('#') ? primary.slice(1) : null;
  return {
    testId,
    id,
    role: null,
    accessibleName: null,
    label: null,
    name: null,
    text: null,
    css: primary,
    primary,
  };
}

function isChromeLabel(label: string): boolean {
  return /\b(expand|collapse|toggle|open|close)\b.*\b(menu|sidebar|nav|drawer|panel|sidenav)\b|\b(menu|sidebar|nav|drawer|panel|sidenav)\b.*\b(expand|collapse|toggle)\b/i.test(
    label,
  );
}

function isPlaceholderHref(href: string | null | undefined): boolean {
  if (!href) {
    return true;
  }
  const value = href.trim();
  return value === '' || value === '#' || value.startsWith('javascript:') || value.startsWith('mailto:');
}

function categoryFor(type: string, label: string | null | undefined, href: string | null): string {
  const hay = `${label ?? ''} ${href ?? ''}`.toLowerCase();
  if (isChromeLabel(label ?? '')) {
    return 'chrome';
  }
  if (/search|filter/.test(hay)) {
    return 'search';
  }
  if (/login|sign in|password/.test(hay) || type === 'password') {
    return 'auth';
  }
  if (/new|create|edit|save|delete|user/.test(hay)) {
    return 'crud';
  }
  if (!isPlaceholderHref(href) || /home|dashboard|settings|account|users|reports|analytics/.test(hay)) {
    return 'navigation';
  }
  return type;
}

export function findByTestId(catalog: DiscoveredElement[], testId: string): DiscoveredElement | undefined {
  return catalog.find((item) => item.selectors.testId === testId);
}

export function findByLabel(catalog: DiscoveredElement[], pattern: RegExp): DiscoveredElement | undefined {
  return catalog.find((item) => pattern.test(item.label));
}

export function toCandidate(element: DiscoveredElement): CandidateAction {
  return {
    id: element.id,
    type: element.type === 'select' ? 'select' : element.type === 'input' || element.type === 'fill' ? 'fill' : 'click',
    target: element.selectors.primary,
    input: null,
    label: element.label,
    category: element.category,
    riskLevel: element.riskLevel,
    elementId: element.id,
    href: element.href ?? null,
    selectors: element.selectors,
    stableKey: `${element.type}:${element.selectors.primary}`,
  };
}
