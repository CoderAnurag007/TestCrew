import { isSkipLink } from './catalog.js';
import type { DiscoveredElement, GeneratedTestCase, TestStep } from '@auditor/shared';
import { generatedTestCaseSchema, valueFor } from '@auditor/shared';
import type { PlannedScenario } from './test-planner.js';

let stepCounter = 0;

function step(partial: Omit<TestStep, 'id'>): TestStep {
  stepCounter += 1;
  return { id: `step-${stepCounter}`, ...partial };
}

function loginUrl(catalog: DiscoveredElement[]): string {
  return catalog.find((item) => /login|signin/i.test(item.url))?.url ?? catalog[0]?.url ?? '/login';
}

export class ScenarioGenerator {
  generate(input: {
    scenarios: PlannedScenario[];
    catalog: DiscoveredElement[];
    baseUrl: string;
  }): GeneratedTestCase[] {
    stepCounter = 0;
    const byId = new Map(input.catalog.map((item) => [item.id, item]));
    const tests: GeneratedTestCase[] = [];
    for (const scenario of input.scenarios) {
      const elements =
        scenario.elements ?? scenario.elementIds.map((id) => byId.get(id)).filter((item): item is DiscoveredElement => Boolean(item));
      if (elements.length === 0) {
        if (scenario.targetUrl) {
          const generated = this.fromVisitedScreen(scenario, input.baseUrl);
          if (generated) {
            tests.push(generatedTestCaseSchema.parse(generated));
          }
        }
        continue;
      }
      const generated = this.fromScenario(scenario, elements, input.baseUrl, input.catalog);
      if (generated) {
        tests.push(generatedTestCaseSchema.parse(generated));
      }
    }
    return tests;
  }

  private fromVisitedScreen(scenario: PlannedScenario, baseUrl: string): GeneratedTestCase | null {
    if (!scenario.targetUrl) {
      return null;
    }
    let href = scenario.targetUrl;
    try {
      href = new URL(scenario.targetUrl, baseUrl).toString();
    } catch {
      return null;
    }
    let expected = href;
    try {
      const parsed = new URL(href);
      expected = `${parsed.pathname}${parsed.hash}`.replace(/\/+$/, '') || parsed.pathname;
    } catch {
      /* keep href */
    }
    const screen = scenario.flowName ?? scenario.name.replace(/^Open\s+/i, '');
    return {
      name: scenario.name,
      description: `Open the visited ${screen} screen and confirm it loads.`,
      category: 'NAVIGATION',
      priority: 'HIGH',
      risk: 'SAFE',
      preconditions: ['Authenticated browser session'],
      requiresAuth: true,
      flowName: scenario.flowName,
      steps: [
        step({
          type: 'navigate',
          description: `Open ${screen}`,
          href,
          value: href,
        }),
        step({
          type: 'assert',
          description: `The browser should remain on ${screen}`,
          assertion: { kind: 'url', operator: 'contains', expected },
        }),
        step({
          type: 'assert',
          description: 'The page should not throw an application error',
          assertion: { kind: 'page_error', operator: 'absent' },
        }),
      ],
      expectedResults: [`${screen} loads without an application error`],
    };
  }

  private fromScenario(
    scenario: PlannedScenario,
    elements: DiscoveredElement[],
    baseUrl: string,
    catalog: DiscoveredElement[],
  ): GeneratedTestCase | null {
    if (scenario.category === 'HAPPY_PATH' && scenario.flowName === 'Authentication') {
      const [username, password, submit] = elements;
      if (!username || !password || !submit) {
        return null;
      }
      const origin = new URL(loginUrl(catalog), baseUrl).toString();
      return {
        name: scenario.name,
        description: 'Valid credentials should authenticate and leave the login page.',
        category: 'HAPPY_PATH',
        priority: 'HIGH',
        risk: 'SAFE',
        preconditions: ['Application is reachable', 'Stored USERNAME_PASSWORD credential exists'],
        requiresAuth: false,
        flowName: scenario.flowName,
        steps: [
          step({ type: 'navigate', description: 'Open the login page', href: origin, value: origin }),
          step({
            type: 'type',
            description: 'Enter discovered username field',
            selectors: username.selectors,
            value: '{{credential.username}}',
            discoveredElementId: username.id,
          }),
          step({
            type: 'type',
            description: 'Enter discovered password field',
            selectors: password.selectors,
            value: '{{credential.password}}',
            discoveredElementId: password.id,
          }),
          step({
            type: 'click',
            description: 'Submit the discovered login control',
            selectors: submit.selectors,
            discoveredElementId: submit.id,
          }),
          step({
            type: 'assert',
            description: 'Login URL should no longer be shown',
            assertion: { kind: 'url', operator: 'matches', expected: '^(?!.*login).*$' },
          }),
        ],
        expectedResults: ['User is authenticated', 'Login page is no longer shown'],
      };
    }

    if (scenario.category === 'NEGATIVE' && scenario.flowName === 'Authentication') {
      const [username, password, submit] = elements;
      if (!username || !password || !submit) {
        return null;
      }
      const origin = new URL(loginUrl(catalog), baseUrl).toString();
      return {
        name: scenario.name,
        description: 'Invalid credentials should remain on login and show an error.',
        category: 'NEGATIVE',
        priority: 'HIGH',
        risk: 'SAFE',
        preconditions: ['Start unauthenticated'],
        requiresAuth: false,
        flowName: scenario.flowName,
        steps: [
          step({ type: 'navigate', description: 'Open the login page', href: origin, value: origin }),
          step({
            type: 'type',
            description: 'Enter username',
            selectors: username.selectors,
            value: '{{credential.username}}',
            discoveredElementId: username.id,
          }),
          step({
            type: 'type',
            description: 'Enter an incorrect password',
            selectors: password.selectors,
            value: 'wrong-password',
            discoveredElementId: password.id,
          }),
          step({
            type: 'click',
            description: 'Submit login',
            selectors: submit.selectors,
            discoveredElementId: submit.id,
          }),
          step({
            type: 'assert',
            description: 'An error should be visible or login should remain',
            assertion: { kind: 'url', operator: 'contains', expected: 'login' },
          }),
        ],
        expectedResults: ['Authentication is rejected', 'User remains on the login page'],
      };
    }

    if (scenario.category === 'NAVIGATION' || scenario.category === 'ERROR_HANDLING' || scenario.category === 'RESPONSIVE') {
      const target = elements[0];
      if (!target?.href && !target?.selectors) {
        return null;
      }
      if (target.href && /^\s*(tel|mailto|sms|javascript|fax|skype|whatsapp):/i.test(target.href)) {
        // Phone, mail and app links open another program; there is no page to check.
        return null;
      }
      if (isSkipLink(target.label, target.href)) {
        return null;
      }
      const origin = startUrl(elements, baseUrl);
      const steps: TestStep[] = [
        step({
          type: 'navigate',
          description: 'Open the page where this control was discovered',
          href: origin,
          value: origin,
        }),
      ];
      // Menu items live inside a menu that is closed when the page loads; clicking them
      // by role times out. Follow their link instead, which is what the item does.
      const menuLink = target.selectors?.role === 'menuitem' && target.href && !/^\s*#/.test(target.href);
      if (menuLink) {
        const destination = new URL(target.href!, origin).toString();
        steps.push(
          step({
            type: 'navigate',
            description: `Follow the menu item ${target.label}`,
            href: destination,
            value: destination,
          }),
        );
      } else if (target.selectors) {
        steps.push(
          step({
            type: 'click',
            description: `Activate discovered control ${target.label}`,
            selectors: target.selectors,
            href: target.href,
            discoveredElementId: target.id,
          }),
        );
      }
      const path = target.href ? safePath(target.href) : '';
      if (path && path !== '#' && path !== '/') {
        steps.push(
          step({
            type: 'assert',
            description: `URL should include ${path}`,
            assertion: { kind: 'url', operator: 'contains', expected: path },
          }),
        );
      }
      steps.push(
        step({
          type: 'assert',
          description: 'The destination should not throw an uncaught error',
          assertion: { kind: 'page_error', operator: 'absent' },
        }),
      );
      if (scenario.category === 'ERROR_HANDLING') {
        steps.push(
          step({
            type: 'assert',
            description: 'The destination should not return HTTP 500',
            assertion: { kind: 'http', operator: 'absent', statusCode: 500 },
          }),
        );
      }
      return {
        name: scenario.name,
        description: scenario.reason,
        category: scenario.category,
        priority: scenario.category === 'ERROR_HANDLING' ? 'HIGH' : 'MEDIUM',
        risk: target.riskLevel,
        preconditions: scenario.requiresAuth ? ['Authenticated browser session'] : [],
        requiresAuth: scenario.requiresAuth,
        viewport: scenario.viewport,
        flowName: scenario.flowName,
        steps,
        expectedResults: target.href
          ? [`Application navigates using ${target.label}`]
          : [`Control ${target.label} is usable`],
      };
    }

    if (scenario.category === 'VALIDATION' || (scenario.category === 'HAPPY_PATH' && scenario.flowName === 'CRUD')) {
      const submit = elements.find((item) => /save|create|submit/i.test(item.label)) ?? elements.at(-1);
      const fields = elements.filter((item) => item.type === 'input' || item.type === 'fill' || item.inputType);
      if (!submit) {
        return null;
      }
      const origin = startUrl(elements, baseUrl);
      const steps: TestStep[] = [
        step({
          type: 'navigate',
          description: 'Open the page where this form was discovered',
          href: origin,
          value: origin,
        }),
      ];
      if (scenario.category === 'HAPPY_PATH') {
        for (const field of fields) {
          const value = valueFor({
            inputType: field.inputType,
            name: field.selectors.name,
            label: field.label,
            autocomplete: field.constraints?.autocomplete,
            min: field.constraints?.min,
            max: field.constraints?.max,
            minLength: field.constraints?.minLength,
            maxLength: field.constraints?.maxLength,
            pattern: field.constraints?.pattern,
          });
          if (value === null) {
            // Payment or identity field: never typed into.
            continue;
          }
          steps.push(
            step({
              type: 'type',
              description: `Fill discovered field ${field.label}`,
              selectors: field.selectors,
              value,
              discoveredElementId: field.id,
            }),
          );
        }
      }
      steps.push(
        step({
          type: 'click',
          description: `Submit discovered form control ${submit.label}`,
          selectors: submit.selectors,
          discoveredElementId: submit.id,
        }),
      );
      steps.push(
        step({
          type: 'assert',
          description: 'Form submission should not return HTTP 500',
          assertion: { kind: 'http', operator: 'absent', statusCode: 500 },
        }),
      );
      return {
        name: scenario.name,
        description: scenario.reason,
        category: scenario.category,
        priority: 'HIGH',
        risk: 'SAFE',
        preconditions: ['Authenticated browser session'],
        requiresAuth: true,
        flowName: scenario.flowName,
        mutates: true,
        steps,
        expectedResults:
          scenario.category === 'VALIDATION'
            ? ['Empty or invalid input is rejected without a server crash']
            : ['Discovered form can be submitted'],
      };
    }

    if (scenario.category === 'EMPTY_STATE') {
      const search = elements[0];
      // A separate search button, never the search box itself or another text field.
      const submit = catalog.find(
        (item) =>
          item !== search &&
          item.selectors.primary !== search?.selectors.primary &&
          (item.selectors.testId === 'search-submit' ||
            (/search/i.test(item.label) &&
              (item.type === 'button' || item.type === 'submit' || (item.selectors.role ?? '') === 'button' || (item.inputType ?? '') === 'submit'))),
      );
      if (!search) {
        return null;
      }
      return {
        name: scenario.name,
        description: 'Searching for a value with no matches should keep the app usable.',
        category: 'EMPTY_STATE',
        priority: 'LOW',
        risk: 'SAFE',
        preconditions: ['Authenticated browser session'],
        requiresAuth: true,
        flowName: scenario.flowName,
        steps: [
          step({
            type: 'navigate',
            description: 'Open the page where search was discovered',
            href: startUrl(elements, baseUrl),
            value: startUrl(elements, baseUrl),
          }),
          step({
            type: 'type',
            description: 'Type a query that should match nothing',
            selectors: search.selectors,
            value: 'zzz-no-match',
            discoveredElementId: search.id,
          }),
          submit
            ? step({
                type: 'click',
                description: 'Submit search',
                selectors: submit.selectors,
                discoveredElementId: submit.id,
              })
            : step({ type: 'wait', description: 'Allow search to update', timeoutMs: 300 }),
          step({
            type: 'assert',
            description: 'Search should not crash the page',
            assertion: { kind: 'page_error', operator: 'absent' },
          }),
        ],
        expectedResults: ['Search completes without a page error'],
      };
    }

    return null;
  }
}

function startUrl(elements: DiscoveredElement[], baseUrl: string): string {
  const discovered = elements.find((item) => item.url)?.url;
  if (!discovered) {
    return baseUrl;
  }
  try {
    return new URL(discovered, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

function safePath(href: string): string {
  try {
    return href.startsWith('http') ? new URL(href).pathname : href;
  } catch {
    return href;
  }
}
