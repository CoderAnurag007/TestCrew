import { describe, expect, it } from 'vitest';
import type { CandidateAction, SemanticPage } from '@auditor/shared';
import { createModelRouter } from '../src/router.js';
import { parseJsonContent } from '../src/gemini.js';
import { ExplorerAgent } from '../src/explorer.js';
import { filterInventedSelectors } from '../src/test-generation.js';
import { clampFailureSeverity } from '../src/failure-analysis.js';

const page: SemanticPage = {
  url: 'https://app.example.com/dashboard',
  title: 'Dashboard',
  route: '/dashboard',
  modalOpen: false,
  importantText: ['Dashboard'],
  elements: [],
};

function action(id: string, label: string, category: string): CandidateAction {
  return {
    id,
    type: 'click',
    target: `[data-testid="${id}"]`,
    input: null,
    label,
    category,
    riskLevel: 'SAFE',
    elementId: id,
    href: `/${id}`,
    selectors: {
      testId: id,
      id: null,
      role: 'link',
      accessibleName: label,
      label,
      name: null,
      text: label,
      css: `[data-testid="${id}"]`,
      primary: `[data-testid="${id}"]`,
    },
    stableKey: `click:${id}`,
  };
}

describe('ExplorerAgent', () => {
  it('only selects from provided actions and prefers navigation', async () => {
    const agent = new ExplorerAgent(createModelRouter({ model: 'heuristic' }));
    const decision = await agent.choose({
      page,
      actions: [action('settings', 'Settings', 'settings'), action('users', 'Users', 'navigation')],
    });
    expect(decision.chosenActionId).toBe('users');
    expect(['users', 'settings']).toContain(decision.chosenActionId);
  });

  it('returns null when every provided action is blocked', async () => {
    const agent = new ExplorerAgent(createModelRouter({ model: 'heuristic' }));
    const users = action('users', 'Users', 'navigation');
    const decision = await agent.choose({
      page,
      actions: [users],
      blockedKeys: new Set([users.stableKey]),
    });
    expect(decision.chosenActionId).toBeNull();
  });

  it('prefers newly revealed submenu items', async () => {
    const agent = new ExplorerAgent(createModelRouter({ model: 'heuristic' }));
    const child = action('inbound', 'Inbound', 'navigation');
    const parent = { ...action('wms', 'WMS', 'menu'), href: null };
    const decision = await agent.choose({
      page,
      actions: [parent, child],
      preferKeys: new Set([child.stableKey]),
    });
    expect(decision.chosenActionId).toBe('inbound');
  });
});

describe('model router', () => {
  it('selects Gemini when a Gemini key is present', () => {
    const router = createModelRouter({
      model: 'gpt-4.1',
      geminiApiKey: 'test-gemini-key',
      geminiModel: 'gemini-2.0-flash',
      openaiApiKey: 'test-openai-key',
      provider: 'auto',
    });
    expect(router.current().name).toBe('gemini');
    expect(router.modelFor('explore')).toBe('gemini-2.0-flash');
  });

  it('parses Gemini JSON that is wrapped in markdown fences', () => {
    expect(parseJsonContent('```json\n{"chosenActionId":"el_1"}\n```')).toEqual({ chosenActionId: 'el_1' });
  });
});

describe('test generation selector filter', () => {
  it('drops tests that invent selectors', () => {
    const catalog = [
      {
        id: 'users',
        url: 'https://app.example.com/dashboard',
        type: 'link',
        label: 'Users',
        category: 'navigation',
        riskLevel: 'SAFE' as const,
        selectors: action('users', 'Users', 'navigation').selectors,
      },
    ];
    const kept = filterInventedSelectors(
      [
        {
          name: 'Valid',
          description: 'Uses catalog selector',
          category: 'NAVIGATION',
          priority: 'MEDIUM',
          risk: 'SAFE',
          preconditions: [],
          expectedResults: ['ok'],
          steps: [{ id: '1', type: 'click', description: 'Users', selectors: catalog[0].selectors }],
        },
        {
          name: 'Invalid',
          description: 'Invented',
          category: 'NAVIGATION',
          priority: 'MEDIUM',
          risk: 'SAFE',
          preconditions: [],
          expectedResults: ['ok'],
          steps: [
            {
              id: '1',
              type: 'click',
              description: 'Unknown',
              selectors: { ...catalog[0].selectors, primary: '#invented', testId: 'invented', css: '#invented' },
            },
          ],
        },
      ],
      catalog,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.name).toBe('Valid');
  });
});

describe('failure severity clamp', () => {
  it('downgrades unsupported critical labels', () => {
    expect(
      clampFailureSeverity('CRITICAL', {
        testName: 'Search',
        steps: [],
        expected: ['ok'],
        actual: 'missing text',
      }),
    ).toBe('HIGH');
  });
});
