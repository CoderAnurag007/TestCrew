import { describe, expect, it } from 'vitest';
import type { GeneratedTestCase, SemanticElement, SemanticPage } from '@auditor/shared';
import { AssertionEngine, expandTemplate } from '../src/assertions.js';
import { catalogFromSemantic } from '../src/catalog.js';
import { ConsistencyCheckGenerator, caseInsensitivePattern } from '../src/consistency.js';
import { exportPlaywrightSpec } from '../src/playwright-export.js';
import { classifyFailure } from '../src/runner.js';
import { testKeyFor } from '../src/test-key.js';

const base = 'http://app.test';

function el(id: string, partial: Partial<SemanticElement>): SemanticElement {
  return {
    id,
    type: 'input',
    role: null,
    text: null,
    label: null,
    placeholder: null,
    name: null,
    href: null,
    inputType: null,
    visible: true,
    enabled: true,
    boundingBox: null,
    riskLevel: 'SAFE',
    selectors: {
      testId: id,
      id: null,
      role: null,
      accessibleName: null,
      label: null,
      name: null,
      text: null,
      css: null,
      primary: `[data-testid="${id}"]`,
    },
    ...partial,
  };
}

function page(url: string, elements: SemanticElement[], extra: Partial<SemanticPage> = {}): SemanticPage {
  return { url, title: 'T', route: new URL(url).pathname, modalOpen: false, importantText: [], elements, ...extra };
}

const dashboard = page(`${base}/dashboard`, [
  el('search', { name: 'q', placeholder: 'Search users', constraints: { formId: '/users', formMethod: 'get', formAction: '/users' } }),
  el('search-submit', { type: 'button', text: 'Search', label: 'Search', inputType: 'submit', constraints: { formId: '/users', formMethod: 'get', formAction: '/users' } }),
]);
const users = page(
  `${base}/users`,
  [el('new-user', { type: 'a', text: 'New user', label: 'New user', href: '/users/new' })],
  { listItems: ['Ada Lovelace', 'Grace Hopper'], importantText: ['Users'] },
);
const newUser = page(
  `${base}/users/new`,
  [
    el('user-name', { label: 'Name', name: 'name', constraints: { formId: '/users', formMethod: 'post', formAction: '/users' } }),
    el('user-email', { label: 'Email', name: 'email', inputType: 'email', constraints: { formId: '/users', formMethod: 'post', formAction: '/users' } }),
    el('save-user', { type: 'button', text: 'Create user', label: 'Create user', inputType: 'submit', constraints: { formId: '/users', formMethod: 'post', formAction: '/users' } }),
  ],
  { importantText: ['New user'] },
);
const editUser = page(
  `${base}/users/1/edit`,
  [
    el('edit-name', { label: 'Name', name: 'name', constraints: { formId: '/users/1', formMethod: 'post', formAction: '/users/1', value: 'Ada Lovelace' } }),
    el('edit-save', { type: 'button', text: 'Save', label: 'Save', inputType: 'submit', constraints: { formId: '/users/1', formMethod: 'post', formAction: '/users/1' } }),
  ],
  { importantText: ['Edit user'] },
);
const shop = page(`${base}/shop`, [], { listItems: ['Blue Mug'] });
const pages = [dashboard, users, newUser, editUser, shop];
const catalog = pages.flatMap((item) => catalogFromSemantic(item));

describe('consistency checks', () => {
  it('only builds read-only search checks in read-only mode, using items from the results page', () => {
    const tests = new ConsistencyCheckGenerator().generate({ pages, catalog, baseUrl: base, allowMutations: false, token: 'tok' });
    expect(tests.every((test) => !test.mutates)).toBe(true);
    const found = tests.find((test) => test.name.startsWith('Search finds'));
    expect(found?.name).toContain('Ada Lovelace');
    expect(JSON.stringify(found)).not.toContain('Blue Mug');
    const typed = found?.steps.find((step) => step.type === 'type');
    expect(typed?.value).toBe('ada lovelace');
  });

  it('adds validation, create-then-list and edit-persists checks in full mode', () => {
    const tests = new ConsistencyCheckGenerator().generate({ pages, catalog, baseUrl: base, allowMutations: true, token: 'tok' });
    const names = tests.map((test) => test.name);
    expect(names.some((name) => name.startsWith('Empty form is rejected'))).toBe(true);
    const create = tests.find((test) => test.name.startsWith('Created record appears'));
    expect(create?.mutates).toBe(true);
    expect(create?.steps.some((step) => step.type === 'navigate' && step.href === `${base}/users`)).toBe(true);
    const edit = tests.find((test) => test.name.startsWith('Edited value is saved'));
    const last = edit?.steps.at(-1);
    expect(last?.assertion).toMatchObject({ kind: 'value', operator: 'equals' });
  });

  it('only uses selectors that were discovered', () => {
    const known = new Set(catalog.map((item) => item.selectors.primary));
    const tests = new ConsistencyCheckGenerator().generate({ pages, catalog, baseUrl: base, allowMutations: true, token: 'tok' });
    for (const test of tests) {
      for (const step of test.steps) {
        if (step.selectors) expect(known.has(step.selectors.primary)).toBe(true);
      }
    }
  });

  it('builds case-insensitive patterns', () => {
    expect(new RegExp(caseInsensitivePattern('Ada L.')).test('ADA L.')).toBe(true);
    expect(new RegExp(caseInsensitivePattern('Ada L.')).test('ada lx')).toBe(false);
  });
});

describe('assertions with captured values', () => {
  it('expands {{var}} and {{var+1}}', () => {
    expect(expandTemplate('{{count+1}}', { count: '2' })).toBe('3');
    expect(expandTemplate('Total {{total}}', { total: '$5' })).toBe('Total $5');
    expect(expandTemplate('{{missing}}', {})).toBe('{{missing}}');
  });

  it('compares element numbers', () => {
    const engine = new AssertionEngine();
    const context = {
      url: '',
      title: '',
      text: '',
      elementExists: true,
      elementVisible: true,
      elementText: 'Cart (2)',
      count: 1,
      httpFailures: [],
      consoleErrors: [],
      pageErrors: [],
    };
    expect(engine.evaluate({ kind: 'element_text', operator: 'equals', expected: '1' }, context).passed).toBe(false);
    expect(engine.evaluate({ kind: 'element_text', operator: 'gte', expected: '2' }, context).passed).toBe(true);
    expect(engine.evaluate({ kind: 'element_text', operator: 'contains', expected: 'Cart' }, context).passed).toBe(true);
    expect(
      engine.evaluate({ kind: 'element_text', operator: 'contains', expected: 'Cart' }, { ...context, elementExists: false }).passed,
    ).toBe(false);
  });
});

describe('failure classification', () => {
  const result = (partial: Partial<Parameters<typeof classifyFailure>[0]>) => ({
    status: 'FAILED' as const,
    errorMessage: '',
    httpFailures: [],
    pageErrors: [],
    actualResults: [],
    assertions: [],
    ...partial,
  });
  it('separates app bugs, broken tests and environment problems', () => {
    expect(classifyFailure(result({ httpFailures: [{ url: 'x', status: 500 }] }))).toBe('APP_BUG');
    expect(classifyFailure(result({ errorMessage: 'Expected text contains Ada' }))).toBe('APP_BUG');
    expect(classifyFailure(result({ status: 'ERROR', errorMessage: "locator.waitFor: Timeout 8000ms exceeded. waiting for getByTestId('x')" }))).toBe('TEST_BUG');
    expect(classifyFailure(result({ status: 'ERROR', errorMessage: 'page.goto: net::ERR_CONNECTION_RESET' }))).toBe('ENVIRONMENT');
    expect(classifyFailure(result({ httpFailures: [{ url: 'x', status: 503 }] }))).toBe('ENVIRONMENT');
  });
});

describe('Playwright export', () => {
  const test: GeneratedTestCase = {
    name: 'Cart counts one item',
    description: 'Adding an item increases the cart count by one.',
    category: 'HAPPY_PATH',
    priority: 'HIGH',
    risk: 'SAFE',
    preconditions: [],
    requiresAuth: true,
    steps: [
      { id: '1', type: 'navigate', description: 'Open shop', href: `${base}/shop` },
      { id: '2', type: 'capture', description: 'Remember count', captureAs: 'cart', captureMode: 'text', selectors: dashboard.elements[0]!.selectors },
      { id: '3', type: 'type', description: 'Login', value: '{{credential.password}}', selectors: dashboard.elements[0]!.selectors },
      {
        id: '4',
        type: 'assert',
        description: 'Count went up',
        assertion: { kind: 'element_text', operator: 'equals', expected: '{{cart+1}}', selectors: dashboard.elements[0]!.selectors },
      },
    ],
    expectedResults: ['Count is one higher'],
  };

  it('writes a runnable spec with env-based credentials and captured values', () => {
    const spec = exportPlaywrightSpec([test, test], { baseUrl: base, projectName: 'Demo' });
    expect(spec).toContain("import { expect, test, type Page } from '@playwright/test';");
    expect(spec).toContain("page.getByTestId('search')");
    expect(spec).toContain('.fill(PASSWORD)');
    expect(spec).toContain("String(Number(vars['cart']) + 1)");
    expect(spec).toContain("url('http://app.test/shop')");
    expect(spec).toContain('Cart counts one item (2)');
    expect(spec).not.toMatch(/demo-password/);
  });
});

describe('test keys', () => {
  it('stay the same across runs even when per-run tokens differ', () => {
    const a = testKeyFor({ name: 'Created record appears (abc123)', category: 'HAPPY_PATH', steps: [], source: 'consistency' });
    const b = testKeyFor({ name: 'Created record appears (def456)', category: 'HAPPY_PATH', steps: [], source: 'consistency' });
    expect(a).toBe(b);
  });
});
