import { describe, expect, it } from 'vitest';
import { hydrateTests } from '../src/test-generation.js';

const sel = (name: string) => ({ testId: null, id: name, role: 'button', accessibleName: name, label: null, name, text: name, css: `#${name}`, primary: `#${name}` });
const catalog = [
  { id: 'el_1', url: 'https://s.test/', type: 'input', label: 'Search', category: 'search', riskLevel: 'SAFE', selectors: sel('search') },
  // Same id on another page: refs keep them apart.
  { id: 'el_1', url: 'https://s.test/cart', type: 'button', label: 'Checkout', category: 'cart', riskLevel: 'CAUTION', selectors: sel('checkout') },
] as never;

const base = { name: 'T', description: 'd', category: 'HAPPY_PATH', priority: 'HIGH', risk: 'SAFE', preconditions: [], expectedResults: ['ok'] };

describe('AI test hydration', () => {
  it('fills selectors from the catalog by ref', () => {
    const [test] = hydrateTests(
      [{ ...base, steps: [{ type: 'type', element: 'e0', value: 'shoe' }, { type: 'assert', assertion: { kind: 'visibility', operator: 'exists', element: 'e1' } }] }] as never,
      catalog,
    );
    expect(test!.steps[0]).toMatchObject({ id: 's1', selectors: { primary: '#search' }, value: 'shoe' });
    expect(test!.steps[1]!.assertion).toMatchObject({ kind: 'visibility', selectors: { primary: '#checkout' } });
    expect(test!.source).toBe('ai');
  });

  it('drops tests that name elements that do not exist or have an invalid step', () => {
    const tests = hydrateTests(
      [
        { ...base, steps: [{ type: 'click', element: 'e9' }] },
        { ...base, steps: [{ type: 'teleport' }] },
        { ...base, steps: [{ type: 'navigate', href: 'https://s.test/' }] },
      ] as never,
      catalog,
    );
    expect(tests).toHaveLength(1);
    expect(tests[0]!.steps[0]!.type).toBe('navigate');
  });
});
