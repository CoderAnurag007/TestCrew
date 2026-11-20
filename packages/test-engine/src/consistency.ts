import {
  classifyField,
  generatedTestCaseSchema,
  valueFor,
  type DiscoveredElement,
  type GeneratedTestCase,
  type SemanticElement,
  type SemanticPage,
  type TestStep,
} from '@auditor/shared';

/**
 * Consistency checks: tests whose expected result comes from the application
 * itself rather than from a human-written spec.
 *
 * - search round-trip: searching for an item that is visibly listed must find
 *   it; searching for nonsense must not return it (read-only, GET forms only)
 * - create then list: a record created through a form must appear on the list
 *   page that links to that form (FULL mode only, mutates data)
 * - edit persists: a value saved through an edit form must still be there when
 *   the form is opened again (FULL mode only, mutates data)
 *
 * Every selector comes from a discovered element. Nothing is invented.
 */
export interface ConsistencyInput {
  pages: SemanticPage[];
  catalog: DiscoveredElement[];
  baseUrl: string;
  /** Allow tests that create or change data. */
  allowMutations: boolean;
  /** Seed for unique values, so each run writes recognisable data. */
  token: string;
}

const CREATE_LABEL = /\b(create|add|new|save|submit|register|post|publish)\b/i;
const EDIT_LABEL = /\b(save|update|apply|change)\b/i;
const SEARCH_LABEL = /\b(search|find|go|filter)\b/i;
const NEVER_SUBMIT = /\b(pay|checkout|purchase|buy|order|delete|remove|logout|log out|sign out|subscribe|unsubscribe)\b/i;

interface FormGroup {
  page: SemanticPage;
  formId: string;
  method: string;
  fields: SemanticElement[];
  submit: SemanticElement | null;
}

export class ConsistencyCheckGenerator {
  generate(input: ConsistencyInput): GeneratedTestCase[] {
    const tests: GeneratedTestCase[] = [];
    const forms = input.pages.flatMap((page) => groupForms(page));
    const catalogKeys = new Set(input.catalog.map((item) => item.selectors.primary));
    const known = (element: SemanticElement) => catalogKeys.has(element.selectors.primary);

    tests.push(...this.searchChecks(forms.filter((form) => form.fields.every(known) && (!form.submit || known(form.submit))), input));
    if (input.allowMutations) {
      tests.push(...this.validationChecks(forms.filter((form) => form.fields.every(known) && form.submit && known(form.submit)), input));
      tests.push(...this.createChecks(forms.filter((form) => form.fields.every(known) && form.submit && known(form.submit)), input));
      tests.push(...this.editChecks(forms.filter((form) => form.fields.every(known) && form.submit && known(form.submit)), input));
    }
    return tests.map((test) => generatedTestCaseSchema.parse(test));
  }

  private searchChecks(forms: FormGroup[], input: ConsistencyInput): GeneratedTestCase[] {
    const out: GeneratedTestCase[] = [];
    const seen = new Set<string>();
    for (const form of forms) {
      if (form.method !== 'get') continue;
      // Results show on the page the form submits to. Only items listed there are
      // things this search is supposed to find; items from other pages are not.
      // A form without its own action (submitted by JavaScript) gives no reliable
      // results page, so no claim is made about it.
      const formAction = form.fields[0]?.constraints?.formAction;
      if (!formAction || formAction === pathOf(form.page.url)) continue;
      const resultsPath = formAction;
      const resultsPages = input.pages.filter((page) => pathOf(page.url) === resultsPath && !new URL(page.url).search);
      // Text that shows up on several other pages is site-wide chrome (banners,
      // footers, marketing lines), not a search result, so it proves nothing.
      const elsewhere = (item: string) =>
        input.pages.filter((page) => pathOf(page.url) !== resultsPath && (page.listItems ?? []).includes(item)).length;
      const term = uniq(resultsPages.flatMap((page) => page.listItems ?? [])).find(
        (item) => /[a-z]/i.test(item) && item.split(' ').length <= 6 && !/@/.test(item) && elsewhere(item) < 2,
      );
      if (!term) continue;
      const field = form.fields.find((item) => classifyField(descriptor(item)) === 'search' || SEARCH_LABEL.test(item.label ?? item.placeholder ?? ''));
      if (!field || form.fields.length > 2) continue;
      if (form.submit && NEVER_SUBMIT.test(form.submit.label ?? form.submit.text ?? '')) continue;
      const key = `${form.page.route}|${field.selectors.primary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pageUrl = absolute(form.page.url, input.baseUrl);
      const typed = term.toLowerCase();
      const submitStep = form.submit
        ? clickStep(form.submit, `Submit the search with ${label(form.submit)}`)
        : null;
      if (!submitStep) continue;
      out.push({
        name: `Search finds a listed item ("${short(term)}")`,
        description: `"${term}" is visible in a list in the app. Typing it the way a user would (lower case) into the search on ${screen(form.page)} must return it.`,
        category: 'HAPPY_PATH',
        priority: 'HIGH',
        risk: 'SAFE',
        preconditions: ['Authenticated browser session'],
        requiresAuth: true,
        flowName: 'Search',
        source: 'consistency',
        mutates: false,
        steps: [
          navigateStep(pageUrl, `Open ${screen(form.page)}`),
          typeStep(field, typed, `Search for "${typed}"`),
          submitStep,
          {
            id: 'search-assert-found',
            type: 'assert',
            description: `Results should include "${term}"`,
            assertion: { kind: 'text', operator: 'matches', expected: caseInsensitivePattern(term) },
          },
        ],
        expectedResults: [`Searching for "${typed}" returns "${term}"`],
      });
      out.push({
        name: `Search with no match hides unrelated items`,
        description: `Searching for a value that matches nothing on ${screen(form.page)} must not keep showing "${term}".`,
        category: 'EMPTY_STATE',
        priority: 'MEDIUM',
        risk: 'SAFE',
        preconditions: ['Authenticated browser session'],
        requiresAuth: true,
        flowName: 'Search',
        source: 'consistency',
        mutates: false,
        steps: [
          navigateStep(pageUrl, `Open ${screen(form.page)}`),
          typeStep(field, `zzq-${input.token}-nomatch`, 'Search for a value that matches nothing'),
          clickStep(form.submit as SemanticElement, `Submit the search with ${label(form.submit as SemanticElement)}`),
          {
            id: 'search-assert-filtered',
            type: 'assert',
            description: `"${term}" should not be listed`,
            assertion: { kind: 'text', operator: 'absent', expected: term },
          },
        ],
        expectedResults: ['Unrelated items are filtered out'],
      });
      if (out.length >= 4) break;
    }
    return out;
  }

  /** Submitting a form with every field empty must be rejected gracefully, never with a server error. */
  private validationChecks(forms: FormGroup[], input: ConsistencyInput): GeneratedTestCase[] {
    const out: GeneratedTestCase[] = [];
    for (const form of forms) {
      if (form.method !== 'post' || !form.submit) continue;
      const submitLabel = label(form.submit);
      if (NEVER_SUBMIT.test(submitLabel)) continue;
      if (form.fields.some((field) => field.inputType === 'password')) continue;
      if (form.fields.some((field) => (field.constraints?.value ?? '').trim().length > 0)) continue;
      const pageUrl = absolute(form.page.url, input.baseUrl);
      out.push({
        name: `Empty form is rejected without a server error (${screen(form.page)})`,
        description: `Submit the form on ${screen(form.page)} with every field empty. The app should show a validation message, not crash.`,
        category: 'VALIDATION',
        priority: 'HIGH',
        risk: 'CAUTION',
        preconditions: ['Authenticated browser session', 'Full safety mode'],
        requiresAuth: true,
        flowName: screen(form.page),
        source: 'consistency',
        mutates: true,
        steps: [
          navigateStep(pageUrl, `Open ${screen(form.page)}`),
          ...form.fields.map((field) => typeStep(field, '', `Clear ${label(field)}`)),
          clickStep(form.submit, `Submit with ${submitLabel}`),
          {
            id: nextId('assert'),
            type: 'assert',
            description: 'The server should not answer with HTTP 500',
            assertion: { kind: 'http', operator: 'absent', statusCode: 500 },
          },
          {
            id: nextId('assert'),
            type: 'assert',
            description: 'The page should not throw an uncaught error',
            assertion: { kind: 'page_error', operator: 'absent' },
          },
        ],
        expectedResults: ['Empty input is rejected with a validation message and no server error'],
      });
      if (out.length >= 4) break;
    }
    return out;
  }

  private createChecks(forms: FormGroup[], input: ConsistencyInput): GeneratedTestCase[] {
    const out: GeneratedTestCase[] = [];
    for (const form of forms) {
      if (form.method !== 'post' || !form.submit) continue;
      const submitLabel = label(form.submit);
      if (!CREATE_LABEL.test(submitLabel) || NEVER_SUBMIT.test(submitLabel)) continue;
      if (form.fields.some((field) => (field.constraints?.value ?? '').trim().length > 0)) continue; // that is an edit form
      if (form.fields.some((field) => field.inputType === 'password')) continue; // login or sign-up
      const fillable = form.fields.filter((field) => valueFor(descriptor(field)) !== null);
      if (fillable.length === 0 || fillable.length !== form.fields.length) continue;
      const token = `${input.token}${out.length}`;
      const values = fillable.map((field) => ({ field, value: valueFor(descriptor(field), { token }) as string }));
      const anchor = values.find(({ field }) => {
        const kind = classifyField(descriptor(field));
        return kind === 'fullName' || kind === 'text' || kind === 'company' || kind === 'username' || kind === 'lastName';
      });
      if (!anchor) continue;
      const listPage = findLinkingPage(form.page, input);
      const steps: TestStep[] = [navigateStep(absolute(form.page.url, input.baseUrl), `Open ${screen(form.page)}`)];
      for (const { field, value } of values) {
        steps.push(typeStep(field, value, `Fill ${label(field)}`));
      }
      steps.push(clickStep(form.submit, `Submit with ${submitLabel}`));
      steps.push({
        id: 'create-no-500',
        type: 'assert',
        description: 'Submitting should not return a server error',
        assertion: { kind: 'http', operator: 'absent', statusCode: 500 },
      });
      if (listPage) {
        steps.push(navigateStep(absolute(listPage.url, input.baseUrl), `Open ${screen(listPage)}, which links to the form`));
      } else {
        steps.push({ id: 'create-reload', type: 'reload', description: 'Reload the page the form led to' });
      }
      steps.push({
        id: 'create-assert-listed',
        type: 'assert',
        description: `The new record "${anchor.value}" should be listed`,
        assertion: { kind: 'text', operator: 'contains', expected: anchor.value },
      });
      out.push({
        name: `Created record appears in its list (${screen(form.page)})`,
        description: `Fill every field of the form on ${screen(form.page)}, submit it, then check that the new record shows up${listPage ? ` on ${screen(listPage)}` : ''}.`,
        category: 'HAPPY_PATH',
        priority: 'HIGH',
        risk: 'CAUTION',
        preconditions: ['Authenticated browser session', 'Full safety mode'],
        requiresAuth: true,
        flowName: listPage ? screen(listPage) : screen(form.page),
        source: 'consistency',
        mutates: true,
        steps,
        expectedResults: [`"${anchor.value}" is listed after it is created`],
      });
      if (out.length >= 3) break;
    }
    return out;
  }

  private editChecks(forms: FormGroup[], input: ConsistencyInput): GeneratedTestCase[] {
    const out: GeneratedTestCase[] = [];
    for (const form of forms) {
      if (form.method !== 'post' || !form.submit) continue;
      const submitLabel = label(form.submit);
      if (!EDIT_LABEL.test(submitLabel) || NEVER_SUBMIT.test(submitLabel)) continue;
      const target = form.fields.find((field) => {
        const kind = classifyField(descriptor(field));
        return (field.constraints?.value ?? '').trim().length > 0 && (kind === 'fullName' || kind === 'text' || kind === 'company' || kind === 'lastName');
      });
      if (!target) continue;
      const original = (target.constraints?.value ?? '').trim();
      const value = `${original.slice(0, 40)} ${input.token}`.trim();
      const pageUrl = absolute(form.page.url, input.baseUrl);
      out.push({
        name: `Edited value is saved (${screen(form.page)})`,
        description: `Change "${label(target)}" on ${screen(form.page)} and save. Opening the same form again must show the new value.`,
        category: 'HAPPY_PATH',
        priority: 'HIGH',
        risk: 'CAUTION',
        preconditions: ['Authenticated browser session', 'Full safety mode'],
        requiresAuth: true,
        flowName: screen(form.page),
        source: 'consistency',
        mutates: true,
        steps: [
          navigateStep(pageUrl, `Open ${screen(form.page)}`),
          typeStep(target, value, `Change ${label(target)}`),
          clickStep(form.submit, `Save with ${submitLabel}`),
          {
            id: 'edit-no-error',
            type: 'assert',
            description: 'Saving should not return a client or server error page',
            assertion: { kind: 'http', operator: 'absent', statusCode: 404 },
          },
          navigateStep(pageUrl, `Open ${screen(form.page)} again`),
          {
            id: 'edit-assert-persisted',
            type: 'assert',
            description: `${label(target)} should now be "${value}"`,
            assertion: { kind: 'value', operator: 'equals', expected: value, selectors: target.selectors },
          },
        ],
        expectedResults: [`${label(target)} keeps the saved value`],
      });
      if (out.length >= 3) break;
    }
    return out;
  }
}

function groupForms(page: SemanticPage): FormGroup[] {
  const groups = new Map<string, FormGroup>();
  for (const element of page.elements) {
    const formId = element.constraints?.formId;
    if (!formId || !element.visible || !element.enabled) continue;
    let group = groups.get(formId);
    if (!group) {
      group = { page, formId, method: element.constraints?.formMethod ?? 'get', fields: [], submit: null };
      groups.set(formId, group);
    }
    const type = (element.inputType ?? '').toLowerCase();
    const isSubmit = (element.type === 'button' && (type === '' || type === 'submit')) || (element.type === 'input' && type === 'submit');
    if (isSubmit) {
      group.submit ??= element;
      continue;
    }
    if ((element.type === 'input' || element.type === 'textarea') && !['hidden', 'checkbox', 'radio', 'file', 'button', 'reset', 'image'].includes(type)) {
      group.fields.push(element);
    }
  }
  return [...groups.values()].filter((group) => group.fields.length > 0);
}

function findLinkingPage(formPage: SemanticPage, input: ConsistencyInput): SemanticPage | null {
  const target = pathOf(formPage.url);
  for (const page of input.pages) {
    if (pathOf(page.url) === target) continue;
    const links = page.elements.some((element) => element.href && pathOf(absolute(element.href, page.url)) === target);
    if (links) return page;
  }
  return null;
}

function descriptor(element: SemanticElement) {
  return {
    inputType: element.inputType,
    name: element.name,
    label: element.label,
    placeholder: element.placeholder,
    tag: element.type,
    autocomplete: element.constraints?.autocomplete,
    min: element.constraints?.min,
    max: element.constraints?.max,
    minLength: element.constraints?.minLength,
    maxLength: element.constraints?.maxLength,
    pattern: element.constraints?.pattern,
  };
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function navigateStep(href: string, description: string): TestStep {
  return { id: nextId('nav'), type: 'navigate', description, href, value: href };
}

function typeStep(element: SemanticElement, value: string, description: string): TestStep {
  return { id: nextId('type'), type: 'type', description, selectors: element.selectors, value };
}

function clickStep(element: SemanticElement, description: string): TestStep {
  return { id: nextId('click'), type: 'click', description, selectors: element.selectors };
}

function label(element: SemanticElement): string {
  return (element.label ?? element.text ?? element.placeholder ?? element.name ?? 'field').trim().slice(0, 60);
}

function screen(page: SemanticPage): string {
  return (page.importantText[0] ?? page.title ?? page.route).trim().slice(0, 60) || page.route;
}

function short(value: string): string {
  return value.length > 30 ? `${value.slice(0, 27)}...` : value;
}

function uniq(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}

export function caseInsensitivePattern(value: string): string {
  return value
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[a-zA-Z]/g, (char) => `[${char.toLowerCase()}${char.toUpperCase()}]`);
}
