import type { CandidateAction, SemanticElement, SemanticPage } from '@auditor/shared';
import { classifyActionRisk } from '@auditor/browser';

const NAV = /\b(nav|home|dashboard|users|settings|account|profile|reports|analytics|orders|inbox)\b/i;
const FORM = /\b(submit|save|create|add|update|edit|apply)\b/i;
const SEARCH = /\b(search|filter|query)\b/i;
const CRUD = /\b(new|create|edit|update|view|details)\b/i;
const CHECKOUT = /\b(cart|checkout|pay now|payment)\b/i;
const ACCOUNT = /\b(account|profile|password|security)\b/i;
const CHROME =
  /\b(expand|collapse|toggle|open|close)\b.*\b(menu|sidebar|nav|drawer|panel|sidenav)\b|\b(menu|sidebar|nav|drawer|panel|sidenav)\b.*\b(expand|collapse|toggle)\b/i;
const LOGOUT = /\b(log ?out|sign ?out|exit)\b/i;

export function isChromeControl(label: string): boolean {
  return CHROME.test(label.trim());
}

export function isPlaceholderHref(href: string | null | undefined): boolean {
  if (!href) {
    return true;
  }
  const value = href.trim();
  return value === '' || value === '#' || value.startsWith('javascript:') || value.startsWith('mailto:');
}

export function isGenericLabel(label: string): boolean {
  return /^(input|button|div|span|a|li|ul|ol|select|textarea|image|img|label|svg|path|icon)$/i.test(label.trim());
}

export function isMenuExpander(element: Pick<SemanticElement, 'href' | 'expanded' | 'hasPopup' | 'inNavigation' | 'label' | 'text'>): boolean {
  const label = (element.label ?? element.text ?? '').trim();
  if (LOGOUT.test(label) || isChromeControl(label)) {
    return false;
  }
  if (!isPlaceholderHref(element.href)) {
    return false;
  }
  return element.expanded === true || element.expanded === false || Boolean(element.hasPopup);
}

export function describeAction(action: Pick<CandidateAction, 'type' | 'category' | 'label' | 'input'>): string {
  const name = action.label.trim() || 'control';
  if (action.category === 'menu') {
    return `Expanded "${name}" in the sidebar`;
  }
  if (action.category === 'navigation') {
    return `Opened "${name}"`;
  }
  if (action.type === 'fill') {
    return `Filled "${name}"${action.input ? ` with "${action.input}"` : ''}`;
  }
  if (action.type === 'select') {
    return `Chose an option in "${name}"`;
  }
  return `Clicked "${name}"`;
}

export class ActionExtractor {
  extract(page: SemanticPage, options: { allowDestructive: boolean }): CandidateAction[] {
    const actions: CandidateAction[] = [];
    for (const element of page.elements) {
      if (!element.visible || !element.enabled) {
        continue;
      }
      const action = this.fromElement(element);
      if (!action) {
        continue;
      }
      if (action.riskLevel === 'DESTRUCTIVE' && !options.allowDestructive) {
        continue;
      }
      actions.push(action);
    }
    return actions;
  }

  private fromElement(element: SemanticElement): CandidateAction | null {
    const label = this.readableLabel(element);
    if (!label) {
      return null;
    }
    if (isMenuExpander(element) && element.expanded === true) {
      return null;
    }
    const riskLevel = element.riskLevel ?? classifyActionRisk({ text: label, href: element.href, name: element.name });
    const type = this.actionType(element);
    const category = this.category(element, label);
    const stableKey = `${type}:${element.selectors.primary}:${element.href ?? ''}:${label}`;
    return {
      id: element.id,
      type,
      target: element.selectors.primary,
      input: type === 'fill' ? this.sampleInput(element) : null,
      label,
      category,
      riskLevel,
      elementId: element.id,
      href: element.href,
      selectors: element.selectors,
      stableKey,
    };
  }

  private readableLabel(element: SemanticElement): string | null {
    const candidates = [element.label, element.text, element.name, element.placeholder];
    for (const candidate of candidates) {
      const value = (candidate ?? '').trim();
      if (value && !isGenericLabel(value)) {
        return value.slice(0, 80);
      }
    }
    if (!isPlaceholderHref(element.href)) {
      const leaf = element.href!.split(/[/?#]/).filter(Boolean).at(-1);
      if (leaf && !isGenericLabel(leaf)) {
        return leaf.slice(0, 80);
      }
    }
    return null;
  }

  private actionType(element: SemanticElement): CandidateAction['type'] {
    if (element.type === 'select') {
      return 'select';
    }
    if (
      element.type === 'input' &&
      element.inputType !== 'submit' &&
      element.inputType !== 'button' &&
      element.inputType !== 'checkbox' &&
      element.inputType !== 'radio'
    ) {
      return 'fill';
    }
    return 'click';
  }

  private sampleInput(element: SemanticElement): string {
    const kind = (element.inputType ?? element.name ?? '').toLowerCase();
    if (kind.includes('email')) {
      return 'auditor@example.com';
    }
    if (kind.includes('search') || kind.includes('filter') || kind.includes('q')) {
      return 'alpha';
    }
    if (element.placeholder) {
      return 'sample';
    }
    return 'Sample value';
  }

  private category(element: SemanticElement, label: string): string {
    const hay = `${label} ${element.href ?? ''}`;
    if (LOGOUT.test(label)) {
      return 'other';
    }
    if (isChromeControl(label)) {
      return 'chrome';
    }
    if (isMenuExpander(element)) {
      return 'menu';
    }
    if (element.role === 'tab' || element.role === 'menuitem' || element.role === 'treeitem') {
      return 'navigation';
    }
    if (CHECKOUT.test(hay)) {
      return 'checkout';
    }
    if (SEARCH.test(hay)) {
      return 'search';
    }
    if (ACCOUNT.test(hay) || /settings/.test(hay)) {
      return 'settings';
    }
    if (CRUD.test(hay) || FORM.test(hay)) {
      return 'crud';
    }
    if (element.inNavigation || NAV.test(hay) || !isPlaceholderHref(element.href)) {
      return 'navigation';
    }
    return 'other';
  }
}

const CATEGORY_PRIORITY: Record<string, number> = {
  navigation: 100,
  crud: 90,
  form: 85,
  search: 80,
  settings: 70,
  account: 70,
  menu: 62,
  checkout: 40,
  other: 30,
  chrome: 12,
};

export function priorityForAction(action: CandidateAction): number {
  let base = CATEGORY_PRIORITY[action.category] ?? 30;
  if (action.category === 'navigation' && !isPlaceholderHref(action.href)) {
    base += 25;
  }
  if (/^(home|dashboard)$/i.test(action.label.trim())) {
    base -= 45;
  }
  if (action.riskLevel === 'DESTRUCTIVE') {
    return 1;
  }
  if (action.riskLevel === 'CAUTION') {
    return Math.max(10, base - 40);
  }
  return base;
}

export function prioritizeActions(
  actions: CandidateAction[],
  options: { preferKeys?: Set<string> } = {},
): CandidateAction[] {
  return [...actions].sort((left, right) => {
    const leftPreferred = options.preferKeys?.has(left.stableKey) ? 1 : 0;
    const rightPreferred = options.preferKeys?.has(right.stableKey) ? 1 : 0;
    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred;
    }
    return priorityForAction(right) - priorityForAction(left);
  });
}

export class StateDetector {
  constructor(private readonly fingerprintFn: (page: SemanticPage) => string) {}

  detect(page: SemanticPage): string {
    return this.fingerprintFn(page);
  }
}
