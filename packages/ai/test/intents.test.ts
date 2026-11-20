import { describe, expect, it } from 'vitest';
import type { CandidateAction, DiscoveredElement, SemanticPage } from '@auditor/shared';
import { RecordingExplorer, decisionKey } from '../src/decision-recorder.js';
import { IntentCompiler } from '../src/intent-compiler.js';
import { createModelRouter, ModelRouter } from '../src/router.js';

const selectors = (testId: string) => ({
  testId,
  id: null,
  role: null,
  accessibleName: null,
  label: null,
  name: null,
  text: null,
  css: null,
  primary: `[data-testid="${testId}"]`,
});

const catalog: DiscoveredElement[] = [
  { id: 'a', url: 'http://app.test/shop', type: 'button', label: 'Add to cart', category: 'checkout', riskLevel: 'SAFE', selectors: selectors('add') },
  { id: 'b', url: 'http://app.test/shop', type: 'span', label: 'Cart count', category: 'other', riskLevel: 'SAFE', selectors: selectors('cart-count') },
];

function fakeRouter(payload: unknown): ModelRouter {
  return new ModelRouter(
    {
      name: 'fake',
      complete: async () => ({ content: '', model: 'fake' }),
      generateText: async () => ({ content: '', model: 'fake' }),
      analyzeImage: async () => ({ content: '', model: 'fake' }),
      generateStructured: async (_request, schema) => ({
        data: schema.parse(payload),
        content: JSON.stringify(payload),
        model: 'fake-model',
        promptTokens: 10,
        completionTokens: 20,
        latencyMs: 5,
        estimatedCostUsd: 0.001,
      }),
    },
    { default: 'fake-model' },
  );
}

const goodTest = {
  name: 'Cart increases by one',
  description: 'Adding an item increases the cart count by one',
  category: 'HAPPY_PATH',
  priority: 'HIGH',
  risk: 'SAFE',
  preconditions: [],
  requiresAuth: true,
  steps: [
    { id: '1', type: 'navigate', description: 'Open shop', href: 'http://app.test/shop' },
    { id: '2', type: 'capture', description: 'Remember count', captureAs: 'cart', captureMode: 'text', selectors: selectors('cart-count') },
    { id: '3', type: 'click', description: 'Add', selectors: selectors('add') },
    {
      id: '4',
      type: 'assert',
      description: 'Count is one higher',
      assertion: { kind: 'element_text', operator: 'equals', expected: '{{cart+1}}', selectors: selectors('cart-count') },
    },
  ],
  expectedResults: ['Cart count increases by 1'],
};

describe('IntentCompiler', () => {
  const intents = [
    { id: 'cart', text: 'Adding an item increases the cart count by 1', enabled: true },
    { id: 'off', text: 'Disabled intent is ignored', enabled: false },
  ];

  it('reports intents as not compiled when no AI provider is configured', async () => {
    const result = await new IntentCompiler(createModelRouter({ model: 'heuristic' })).compile({ intents, catalog, pages: [], baseUrl: 'http://app.test' });
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ intentId: 'cart', status: 'not_compiled' });
  });

  it('accepts a test that only uses discovered controls', async () => {
    const router = fakeRouter({ results: [{ intentId: 'cart', compiled: true, test: goodTest }] });
    const result = await new IntentCompiler(router).compile({ intents, catalog, pages: [], baseUrl: 'http://app.test' });
    expect(result.intents[0]?.status).toBe('compiled');
    expect(result.intents[0]?.test).toMatchObject({ source: 'intent', intentId: 'cart' });
    expect(result.estimatedCostUsd).toBe(0.001);
  });

  it('rejects invented selectors and off-site navigation', async () => {
    const invented = {
      ...goodTest,
      steps: goodTest.steps.map((step) => (step.id === '3' ? { ...step, selectors: selectors('made-up') } : step)),
    };
    const offsite = {
      ...goodTest,
      steps: goodTest.steps.map((step) => (step.id === '1' ? { ...step, href: 'https://evil.example/' } : step)),
    };
    const router = fakeRouter({
      results: [
        { intentId: 'cart', compiled: true, test: invented },
      ],
    });
    const first = await new IntentCompiler(router).compile({ intents, catalog, pages: [], baseUrl: 'http://app.test' });
    expect(first.intents[0]).toMatchObject({ status: 'rejected' });
    expect(first.intents[0]?.reason).toMatch(/not discovered/);
    const second = await new IntentCompiler(fakeRouter({ results: [{ intentId: 'cart', compiled: true, test: offsite }] })).compile({
      intents,
      catalog,
      pages: [],
      baseUrl: 'http://app.test',
    });
    expect(second.intents[0]?.reason).toMatch(/outside the application/);
  });

  it('keeps the model reason when it cannot compile an intent', async () => {
    const router = fakeRouter({ results: [{ intentId: 'cart', compiled: false, reason: 'No cart on any screen' }] });
    const result = await new IntentCompiler(router).compile({ intents, catalog, pages: [], baseUrl: 'http://app.test' });
    expect(result.intents[0]).toMatchObject({ status: 'not_compiled', reason: 'No cart on any screen' });
  });
});

describe('RecordingExplorer', () => {
  const page: SemanticPage = { url: 'http://app.test/', title: 'Home', route: '/', modalOpen: false, importantText: [], elements: [] };
  const action = (id: string): CandidateAction => ({
    id,
    type: 'click',
    target: id,
    input: null,
    label: id,
    category: 'navigation',
    riskLevel: 'SAFE',
    elementId: id,
    href: null,
    selectors: selectors(id),
    stableKey: `click:${id}`,
  });

  it('records decisions and replays them without calling the model', async () => {
    let calls = 0;
    const inner = {
      choose: async () => {
        calls += 1;
        return { chosenActionId: 'b', reason: 'model said b', priority: 1, riskLevel: 'SAFE' as const };
      },
    };
    const first = new RecordingExplorer(inner);
    await first.choose({ page, actions: [action('a'), action('b')] });
    expect(calls).toBe(1);
    expect(first.recorded[0]?.chosenStableKey).toBe('click:b');

    const replay = new RecordingExplorer(inner, first.recorded);
    const decision = await replay.choose({ page, actions: [action('b'), action('a')] });
    expect(decision.chosenActionId).toBe('b');
    expect(calls).toBe(1);
    expect(replay.replayHits).toBe(1);

    await replay.choose({ page, actions: [action('c')] });
    expect(calls).toBe(2);
    expect(replay.replayMisses).toBe(1);
  });

  it('keys decisions by screen and the set of actions, not their order', () => {
    expect(decisionKey(page, [action('a'), action('b')])).toBe(decisionKey(page, [action('b'), action('a')]));
    expect(decisionKey(page, [action('a')])).not.toBe(decisionKey(page, [action('b')]));
  });
});
