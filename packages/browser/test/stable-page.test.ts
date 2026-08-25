import { describe, expect, it } from 'vitest';
import { isNavigationDestroyedError } from '../src/stable-page.js';

describe('navigation destroyed errors', () => {
  it('retries Playwright execution-context losses from in-page redirects', () => {
    expect(
      isNavigationDestroyedError(
        new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation'),
      ),
    ).toBe(true);
    expect(isNavigationDestroyedError(new Error('Timeout 20000ms exceeded'))).toBe(false);
  });
});
