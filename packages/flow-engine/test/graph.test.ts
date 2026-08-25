import { describe, expect, it } from 'vitest';
import type { SemanticPage } from '@auditor/shared';
import {
  ActionExtractor,
  fingerprintState,
  nameForState,
  shouldStopExploration,
  StateGraph,
} from '../src/index.js';

function page(overrides: Partial<SemanticPage> & Pick<SemanticPage, 'url' | 'title' | 'route'>): SemanticPage {
  return {
    modalOpen: false,
    importantText: ['Dashboard'],
    elements: [],
    ...overrides,
  };
}

function button(
  id: string,
  text: string,
  href: string | null = null,
  extra: Partial<SemanticPage['elements'][number]> = {},
) {
  return {
    id,
    type: 'button',
    role: 'button',
    text,
    label: text,
    placeholder: null,
    name: null,
    href,
    inputType: null,
    visible: true,
    enabled: true,
    boundingBox: { x: 0, y: 0, width: 80, height: 24 },
    selectors: {
      testId: id,
      id: null,
      role: 'button',
      accessibleName: text,
      label: text,
      name: null,
      text,
      css: `[data-testid="${id}"]`,
      primary: `[data-testid="${id}"]`,
    },
    riskLevel: text.toLowerCase().includes('delete') ? ('DESTRUCTIVE' as const) : ('SAFE' as const),
    ...extra,
  };
}

describe('state fingerprinting', () => {
  it('is deterministic and changes when the interactive surface changes', () => {
    const login = page({
      url: 'https://app.example.com/login?utm_source=x',
      title: 'Sign in',
      route: '/login',
      importantText: ['Sign in'],
      elements: [button('login-submit', 'Sign in')],
    });
    const loginAgain = page({
      url: 'https://app.example.com/login?utm_campaign=y',
      title: 'Sign in',
      route: '/login',
      importantText: ['Sign in'],
      elements: [button('login-submit', 'Sign in')],
    });
    const dashboard = page({
      url: 'https://app.example.com/dashboard',
      title: 'Dashboard',
      route: '/dashboard',
      importantText: ['Dashboard'],
      elements: [button('users', 'Users', '/users')],
    });

    expect(fingerprintState(login)).toBe(fingerprintState(loginAgain));
    const expandedNav = page({
      url: 'https://app.example.com/home/dashboard',
      title: 'Dashboard',
      route: '/home/dashboard',
      importantText: ['Dashboard'],
      elements: [button('wms', 'WMS', null, { inNavigation: true, expanded: true })],
    });
    const collapsedNav = page({
      url: 'https://app.example.com/home/dashboard',
      title: 'Dashboard',
      route: '/home/dashboard',
      importantText: ['Dashboard'],
      elements: [button('wms', 'WMS', null, { inNavigation: true, expanded: false })],
    });
    expect(fingerprintState(expandedNav)).toBe(fingerprintState(collapsedNav));
    expect(fingerprintState(login)).not.toBe(fingerprintState(dashboard));
    expect(nameForState(login)).toBe('Sign in');
    expect(
      nameForState(
        page({
          url: 'https://app.example.com/home/dashboard',
          title: 'home/dashboard',
          route: '/home/dashboard',
          importantText: ['Dashboard', 'Orders'],
        }),
      ),
    ).toBe('Orders');
    expect(
      fingerprintState(
        page({
          url: 'https://app.example.com/#/users',
          title: 'Users',
          route: '/users',
          importantText: ['Users'],
        }),
      ),
    ).not.toBe(
      fingerprintState(
        page({
          url: 'https://app.example.com/#/orders',
          title: 'Orders',
          route: '/orders',
          importantText: ['Orders'],
        }),
      ),
    );
  });
});

describe('state graph', () => {
  it('deduplicates states and records transitions', () => {
    const graph = new StateGraph();
    const a = graph.addState({
      fingerprint: 'a',
      url: 'https://app.example.com/a',
      title: 'A',
      depth: 0,
    });
    const aAgain = graph.addState({
      fingerprint: 'a',
      url: 'https://app.example.com/a',
      title: 'A',
      depth: 2,
    });
    expect(a.id).toBe(aAgain.id);
    expect(graph.hasState('a')).toBe(true);

    const b = graph.addState({
      fingerprint: 'b',
      url: 'https://app.example.com/b',
      title: 'B',
      depth: 1,
    });
    graph.addTransition({
      sourceState: a,
      destinationState: b,
      action: {
        type: 'click',
        target: '[data-testid="go"]',
        riskLevel: 'SAFE',
        stableKey: 'click:go',
        success: true,
      },
    });

    expect(graph.getUnvisitedStates().map((state) => state.fingerprint)).toEqual(['b']);
    expect(graph.calculateCoverage().statesDiscovered).toBe(2);
    expect(graph.calculateCoverage().actionsExecuted).toBe(1);
  });
});

describe('action extraction', () => {
  it('extracts interactive actions and skips destructive ones by default', () => {
    const extractor = new ActionExtractor();
    const actions = extractor.extract(
      page({
        url: 'https://app.example.com/users',
        title: 'Users',
        route: '/users',
        elements: [
          button('new-user', 'New user', '/users/new'),
          button('delete-user', 'Delete user'),
        ],
      }),
      { allowDestructive: false },
    );
    expect(actions.map((action) => action.label)).toEqual(['New user']);
    const withDestructive = extractor.extract(
      page({
        url: 'https://app.example.com/users',
        title: 'Users',
        route: '/users',
        elements: [button('delete-user', 'Delete user')],
      }),
      { allowDestructive: true },
    );
    expect(withDestructive[0]?.riskLevel).toBe('DESTRUCTIVE');
  });

  it('does not treat expand/collapse chrome as navigation', () => {
    const extractor = new ActionExtractor();
    const actions = extractor.extract(
      page({
        url: 'https://app.example.com/home/dashboard',
        title: 'Dashboard',
        route: '/home/dashboard',
        elements: [
          button('collapse-home', 'Collapse home menu'),
          button('reports', 'Analytics & Reports', '/reports'),
        ],
      }),
      { allowDestructive: false },
    );
    expect(actions.find((action) => action.label === 'Collapse home menu')?.category).toBe('chrome');
    expect(actions.find((action) => action.label === 'Analytics & Reports')?.category).toBe('navigation');
  });

  it('opens nested sidenav groups before treating them as pages', () => {
    const extractor = new ActionExtractor();
    const actions = extractor.extract(
      page({
        url: 'https://app.example.com/home/dashboard',
        title: 'Dashboard',
        route: '/home/dashboard',
        elements: [
          button('wms', 'WMS', null, { inNavigation: true, expanded: false }),
          button('inbound', 'Inbound', '/wms/inbound', { inNavigation: true }),
        ],
      }),
      { allowDestructive: false },
    );
    expect(actions.find((action) => action.label === 'WMS')?.category).toBe('menu');
    expect(actions.find((action) => action.label === 'Inbound')?.category).toBe('navigation');
    const leafOnly = extractor.extract(
      page({
        url: 'https://app.example.com/home/dashboard',
        title: 'Dashboard',
        route: '/home/dashboard',
        elements: [button('inbound', 'Inbound', null, { inNavigation: true })],
      }),
      { allowDestructive: false },
    );
    expect(leafOnly[0]?.category).toBe('navigation');
  });

  it('skips unlabeled generic inputs and names real controls', () => {
    const extractor = new ActionExtractor();
    const actions = extractor.extract(
      page({
        url: 'https://app.example.com/inventory',
        title: 'Inventory',
        route: '/inventory',
        elements: [
          {
            ...button('generic-input', 'input'),
            type: 'input',
            inputType: 'text',
            label: 'input',
            text: 'input',
          },
          button('search', 'Search products', null, { name: 'q' }),
        ],
      }),
      { allowDestructive: false },
    );
    expect(actions.some((action) => action.label === 'input')).toBe(false);
    expect(actions.some((action) => action.label === 'Search products')).toBe(true);
  });
});

describe('exploration limits', () => {
  it('stops when any configured budget is exhausted', () => {
    const limits = {
      maxPages: 2,
      maxActions: 10,
      maxDepth: 4,
      maxDurationMs: 60_000,
      allowDestructive: false,
    };
    expect(
      shouldStopExploration(
        { pagesVisited: 2, actionsExecuted: 1, depth: 1, startedAt: Date.now() },
        limits,
      ).stop,
    ).toBe(true);
    expect(
      shouldStopExploration(
        { pagesVisited: 1, actionsExecuted: 10, depth: 1, startedAt: Date.now() },
        limits,
      ).reason,
    ).toBe('max actions reached');
    expect(
      shouldStopExploration(
        { pagesVisited: 1, actionsExecuted: 1, depth: 1, startedAt: Date.now() },
        limits,
      ).stop,
    ).toBe(false);
  });
});
