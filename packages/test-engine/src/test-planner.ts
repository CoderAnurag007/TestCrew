import type { DiscoveredElement, TestCategory } from '@auditor/shared';

export interface PlannedScenario {
  name: string;
  category: TestCategory;
  reason: string;
  elementIds: string[];
  requiresAuth: boolean;
  viewport?: 'desktop' | 'tablet' | 'mobile';
  flowName?: string;
  targetUrl?: string;
}

const PRIORITY_CATEGORIES: TestCategory[] = [
  'HAPPY_PATH',
  'NEGATIVE',
  'VALIDATION',
  'NAVIGATION',
  'ERROR_HANDLING',
];

export class TestPlanner {
  plan(input: {
    catalog: DiscoveredElement[];
    flows: Array<{ name: string }>;
    states?: Array<{ id: string; name: string; url?: string | null; title?: string | null; visited?: boolean }>;
    allowDestructive?: boolean;
  }): PlannedScenario[] {
    const scenarios: PlannedScenario[] = [];
    const username = input.catalog.find((item) => item.selectors.testId === 'username' || item.selectors.name === 'username');
    const password = input.catalog.find((item) => item.inputType === 'password' || item.selectors.testId === 'password');
    const submit = input.catalog.find(
      (item) => item.selectors.testId === 'login-submit' || /sign in|log in/i.test(item.label),
    );
    if (username && password && submit) {
      scenarios.push({
        name: 'Sign in with valid credentials',
        category: 'HAPPY_PATH',
        reason: 'Login form was discovered',
        elementIds: [username.id, password.id, submit.id],
        requiresAuth: false,
        flowName: 'Authentication',
      });
      scenarios.push({
        name: 'Reject invalid credentials',
        category: 'NEGATIVE',
        reason: 'Negative authentication coverage',
        elementIds: [username.id, password.id, submit.id],
        requiresAuth: false,
        flowName: 'Authentication',
      });
    }

    const covered = new Set<string>();
    const visited = (input.states ?? []).filter((state) => state.visited !== false && state.url && state.name);
    for (const state of uniqueBy(visited, (item) => canonicalizeScreen(item.url ?? item.name)).slice(0, 16)) {
      if (/login|signin/i.test(`${state.name} ${state.url ?? ''}`)) {
        continue;
      }
      const key = state.name.trim().toLowerCase();
      covered.add(key);
      scenarios.push({
        name: `Open ${state.name}`,
        category: 'NAVIGATION',
        reason: 'Exploration visited this screen',
        elementIds: [],
        targetUrl: state.url ?? undefined,
        requiresAuth: true,
        flowName: state.name,
      });
    }

    const nav = input.catalog.filter((item) => {
      if (isChromeControl(item.label) || isGenericControlLabel(item.label) || isShellLabel(item.label)) {
        return false;
      }
      if (item.category === 'chrome' || item.category === 'menu') {
        return false;
      }
      if (covered.has(item.label.trim().toLowerCase())) {
        return false;
      }
      return Boolean(item.href && !isPlaceholderHref(item.href)) || item.category === 'navigation';
    });
    for (const link of uniqueBy(nav, (item) => item.href || item.label).slice(0, 8)) {
      covered.add(link.label.trim().toLowerCase());
      scenarios.push({
        name: `Navigate to ${link.label}`,
        category: 'NAVIGATION',
        reason: 'Discovered navigation control',
        elementIds: [link.id],
        requiresAuth: true,
        flowName: link.label,
      });
    }

    const forms = input.catalog.filter((item) => item.category === 'crud' || /save|create|submit/i.test(item.label));
    if (forms.length > 0) {
      scenarios.push({
        name: 'Submit discovered form',
        category: 'HAPPY_PATH',
        reason: 'CRUD/form controls were discovered',
        elementIds: forms.map((item) => item.id),
        requiresAuth: true,
        flowName: 'CRUD',
      });
      scenarios.push({
        name: 'Submit form without required values',
        category: 'VALIDATION',
        reason: 'Forms need empty-input coverage',
        elementIds: forms.map((item) => item.id),
        requiresAuth: true,
        flowName: 'CRUD',
      });
    }

    const risky = input.catalog.filter((item) => {
      const hay = `${item.label} ${item.href ?? ''}`;
      return /\b(error page|server error|broken|boom|crash)\b/i.test(hay) || /\/(error|boom|crash)\b/i.test(item.href ?? '');
    });
    for (const item of risky) {
      scenarios.push({
        name: `Error handling for ${item.label}`,
        category: 'ERROR_HANDLING',
        reason: 'Potentially failing destination discovered',
        elementIds: [item.id],
        requiresAuth: true,
        flowName: item.label,
      });
    }

    const search = input.catalog.find((item) => item.category === 'search' || item.selectors.testId === 'search');
    if (search) {
      scenarios.push({
        name: 'Search empty results',
        category: 'EMPTY_STATE',
        reason: 'Search control discovered',
        elementIds: [search.id],
        requiresAuth: true,
        flowName: 'Search',
      });
    }

    return scenarios.filter(
      (scenario) => PRIORITY_CATEGORIES.includes(scenario.category) || scenario.category === 'EMPTY_STATE',
    );
  }
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(item);
  }
  return out;
}

function canonicalizeScreen(value: string): string {
  return value.replace(/\/+$/, '').replace(/#.*$/, '').toLowerCase();
}

function isChromeControl(label: string): boolean {
  return /\b(expand|collapse|toggle|open|close)\b.*\b(menu|sidebar|nav|drawer|panel|sidenav)\b|\b(menu|sidebar|nav|drawer|panel|sidenav)\b.*\b(expand|collapse|toggle)\b/i.test(
    label,
  );
}

function isGenericControlLabel(label: string): boolean {
  return /^(input|button|div|span|a|li|ul|select|textarea|image|img|label)$/i.test(label.trim());
}

function isShellLabel(label: string): boolean {
  return /^(home|dashboard)$/i.test(label.trim());
}

function isPlaceholderHref(href: string | null | undefined): boolean {
  if (!href) {
    return true;
  }
  const value = href.trim();
  return value === '' || value === '#' || value.startsWith('javascript:') || value.startsWith('mailto:');
}
