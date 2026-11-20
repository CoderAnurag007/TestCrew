import { describe, expect, it } from 'vitest';
import type { DiscoveredElement, GeneratedTestCase } from '@auditor/shared';
import { AssertionEngine } from '../src/assertions.js';
import { TestGenerator } from '../src/test-generator.js';
import { TestPlanner } from '../src/test-planner.js';
import { ScenarioGenerator } from '../src/scenario-generator.js';

const username: DiscoveredElement = {
  id: 'username',
  url: 'http://127.0.0.1/login',
  type: 'input',
  label: 'Username',
  category: 'auth',
  riskLevel: 'SAFE',
  inputType: 'text',
  selectors: {
    testId: 'username',
    id: null,
    role: null,
    accessibleName: 'Username',
    label: 'Username',
    name: 'username',
    text: null,
    css: '[data-testid="username"]',
    primary: '[data-testid="username"]',
  },
};

const password: DiscoveredElement = {
  ...username,
  id: 'password',
  label: 'Password',
  inputType: 'password',
  selectors: { ...username.selectors, testId: 'password', name: 'password', primary: '[data-testid="password"]', css: '[data-testid="password"]' },
};

const submit: DiscoveredElement = {
  ...username,
  id: 'login-submit',
  type: 'button',
  label: 'Sign in',
  inputType: null,
  selectors: { ...username.selectors, testId: 'login-submit', name: null, primary: '[data-testid="login-submit"]', css: '[data-testid="login-submit"]' },
};

describe('test generation validation', () => {
  it('builds happy-path and negative login tests from discovered selectors only', () => {
    const catalog = [username, password, submit];
    const planner = new TestPlanner();
    const scenarios = planner.plan({ catalog, flows: [{ name: 'Authentication' }] });
    const tests = new ScenarioGenerator().generate({
      scenarios,
      catalog,
      baseUrl: 'http://127.0.0.1',
    });
    expect(tests.some((test) => test.category === 'HAPPY_PATH')).toBe(true);
    expect(tests.some((test) => test.category === 'NEGATIVE')).toBe(true);
    const generator = new TestGenerator();
    for (const test of tests) {
      expect(generator.validate(test, catalog).ok).toBe(true);
    }
  });

  it('keeps deterministic tests when the AI agent returns an empty suite', async () => {
    const tests = await new TestGenerator().generate({
      catalog: [username, password, submit],
      flows: [{ id: 'auth', name: 'Authentication' }],
      states: [],
      baseUrl: 'http://127.0.0.1',
    });
    expect(tests.tests.length).toBeGreaterThan(0);
    expect(tests.tests.some((test) => test.category === 'HAPPY_PATH')).toBe(true);
  });

  it('rejects tests that invent selectors', () => {
    const catalog = [username];
    const invented: GeneratedTestCase = {
      name: 'Invented',
      description: 'Uses a selector that was never discovered',
      category: 'HAPPY_PATH',
      priority: 'HIGH',
      risk: 'SAFE',
      preconditions: [],
      expectedResults: ['ok'],
      steps: [
        {
          id: '1',
          type: 'click',
          description: 'Click unknown',
          selectors: {
            testId: 'not-real',
            id: null,
            role: null,
            accessibleName: null,
            label: null,
            name: null,
            text: null,
            css: '#not-real',
            primary: '#not-real',
          },
        },
      ],
    };
    expect(new TestGenerator().validate(invented, catalog).ok).toBe(false);
  });

  it('skips sidebar chrome and does not treat Reports as an error destination', () => {
    const collapse: DiscoveredElement = {
      ...submit,
      id: 'collapse',
      label: 'Collapse home menu',
      category: 'chrome',
      href: null,
      selectors: { ...submit.selectors, testId: 'collapse', primary: '[data-testid="collapse"]', css: '[data-testid="collapse"]' },
    };
    const reports: DiscoveredElement = {
      ...submit,
      id: 'reports',
      label: 'Analytics & Reports',
      category: 'navigation',
      href: '/reports',
      url: 'http://127.0.0.1/home/dashboard',
      selectors: { ...submit.selectors, testId: 'reports', primary: '[data-testid="reports"]', css: '[data-testid="reports"]' },
    };
    const scenarios = new TestPlanner().plan({
      catalog: [username, password, submit, collapse, reports],
      flows: [{ name: 'Root' }],
    });
    expect(scenarios.some((scenario) => /Collapse home menu/.test(scenario.name))).toBe(false);
    expect(scenarios.some((scenario) => scenario.category === 'ERROR_HANDLING' && /Reports/.test(scenario.name))).toBe(false);
    expect(scenarios.some((scenario) => scenario.name === 'Navigate to Analytics & Reports')).toBe(true);
    const tests = new ScenarioGenerator().generate({
      scenarios,
      catalog: [username, password, submit, collapse, reports],
      baseUrl: 'http://127.0.0.1',
    });
    const nav = tests.find((test) => test.name === 'Navigate to Analytics & Reports');
    expect(nav?.steps[0]?.type).toBe('navigate');
    expect(nav?.steps.some((step) => step.type === 'click')).toBe(true);
  });

  it('builds screen-opening tests from visited states instead of responsive chrome', () => {
    const inventory: DiscoveredElement = {
      ...submit,
      id: 'inventory-nav',
      label: 'Inventory',
      category: 'navigation',
      href: '/products/inventory',
      url: 'http://127.0.0.1/home/dashboard',
      selectors: {
        ...submit.selectors,
        testId: 'inventory-nav',
        primary: '[data-testid="inventory-nav"]',
        css: '[data-testid="inventory-nav"]',
      },
    };
    const scenarios = new TestPlanner().plan({
      catalog: [username, password, submit, inventory],
      flows: [{ name: 'Root' }],
      states: [
        { id: 's1', name: 'Inventory', url: 'http://127.0.0.1/products/inventory', visited: true },
        { id: 's2', name: 'Dashboard', url: 'http://127.0.0.1/home/dashboard', visited: true },
      ],
    });
    expect(scenarios.some((scenario) => scenario.name === 'Open Inventory')).toBe(true);
    expect(scenarios.some((scenario) => scenario.category === 'RESPONSIVE')).toBe(false);
    expect(scenarios.some((scenario) => scenario.name === 'Navigate to Inventory')).toBe(false);
    const tests = new ScenarioGenerator().generate({
      scenarios,
      catalog: [username, password, submit, inventory],
      baseUrl: 'http://127.0.0.1',
    });
    const openInventory = tests.find((test) => test.name === 'Open Inventory');
    expect(openInventory?.steps[0]?.type).toBe('navigate');
    expect(openInventory?.steps[0]?.href).toContain('/products/inventory');
    expect(openInventory?.steps.some((step) => step.type === 'click')).toBe(false);
  });
});

describe('assertions', () => {
  const engine = new AssertionEngine();

  it('evaluates URL, visibility, HTTP, and page errors deterministically', () => {
    const context = {
      url: 'http://127.0.0.1/dashboard',
      title: 'Dashboard',
      text: 'Welcome',
      elementExists: true,
      elementVisible: true,
      count: 1,
      httpFailures: [{ url: 'http://127.0.0.1/reports', status: 500 }],
      consoleErrors: [],
      pageErrors: ['boom'],
    };
    expect(engine.evaluate({ kind: 'url', operator: 'contains', expected: 'dashboard' }, context).passed).toBe(true);
    expect(engine.evaluate({ kind: 'visibility' }, context).passed).toBe(true);
    expect(engine.evaluate({ kind: 'http', operator: 'absent', statusCode: 500 }, context).passed).toBe(false);
    expect(engine.evaluate({ kind: 'page_error', operator: 'absent' }, context).passed).toBe(false);
  });
});

describe('search test generation across pages', () => {
  // Element ids such as "el_23" repeat on every page; the generated test must use the
  // search box the planner chose, not another page's element with the same id.
  const searchBox: DiscoveredElement = {
    ...username,
    id: 'el_23',
    url: 'https://tools.test/pdf',
    label: 'Search tools',
    category: 'search',
    inputType: 'search',
    selectors: { ...username.selectors, testId: null, id: 'header-search', role: 'combobox', accessibleName: 'Search tools', label: 'Search tools', name: null, css: '#header-search', primary: '#header-search' },
  };
  const faqQuestion: DiscoveredElement = {
    ...username,
    id: 'el_23',
    url: 'https://tools.test/pdf/duplicate-pages',
    label: 'Can I duplicate the whole document? search',
    category: 'search',
    inputType: null,
    selectors: { ...username.selectors, testId: null, role: null, accessibleName: 'Can I duplicate the whole document?', label: 'Can I duplicate the whole document?', name: null, css: 'summary', primary: 'label=Can I duplicate the whole document?' },
  };

  it('types into the real search box, never a FAQ <summary> with the same id', () => {
    const catalog = [searchBox, faqQuestion];
    const scenarios = new TestPlanner().plan({ catalog, flows: [] });
    const tests = new ScenarioGenerator().generate({ scenarios, catalog, baseUrl: 'https://tools.test/' });
    const search = tests.find((test) => test.name === 'Search empty results');
    expect(search).toBeDefined();
    const typeStep = search!.steps.find((step) => step.type === 'type');
    expect(typeStep?.selectors?.primary).toBe('#header-search');
    // The search box is not reused as its own "submit" button.
    expect(search!.steps.filter((step) => step.selectors?.primary === '#header-search')).toHaveLength(1);
  });
});
