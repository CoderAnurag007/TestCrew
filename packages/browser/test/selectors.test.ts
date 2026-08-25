import { describe, expect, it } from 'vitest';
import { classifyActionRisk } from '../src/risk.js';
import { buildSelectorMeta } from '../src/selectors.js';

describe('selector metadata', () => {
  it('prioritizes data-testid, then id, then accessible name', () => {
    const testId = buildSelectorMeta({
      testId: 'login-submit',
      id: 'btn-1',
      text: 'Sign in',
      tag: 'button',
    });
    expect(testId.primary).toContain('data-testid');

    const byId = buildSelectorMeta({
      id: 'username',
      text: 'User',
      tag: 'input',
    });
    expect(byId.primary).toBe('#username');

    const byRole = buildSelectorMeta({
      role: 'button',
      accessibleName: 'Save',
      tag: 'button',
    });
    expect(byRole.primary).toContain('role=button');
    expect(byRole.css).toBeTruthy();
    expect(byRole.css).not.toMatch(/xpath/i);
  });
});

describe('action risk classification', () => {
  it('marks delete and payment actions as destructive', () => {
    expect(classifyActionRisk({ text: 'Delete user' })).toBe('DESTRUCTIVE');
    expect(classifyActionRisk({ text: 'Place order' })).toBe('DESTRUCTIVE');
    expect(classifyActionRisk({ text: 'Log out' })).toBe('CAUTION');
    expect(classifyActionRisk({ text: 'Open settings' })).toBe('SAFE');
  });
});
