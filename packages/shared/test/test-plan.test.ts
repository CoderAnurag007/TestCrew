import { describe, expect, it } from 'vitest';
import { isSandboxTestCard, parseTestPlan, testPlanSchema } from '../src/test-plan.js';

describe('test plan', () => {
  it('fills in safe defaults: no orders, never pay', () => {
    const plan = parseTestPlan({});
    expect(plan.category).toBe('auto');
    expect(plan.transactions.enabled).toBe(false);
    expect(plan.transactions.stopBefore).toBe('payment');
    expect(plan.payment.mode).toBe('never');
    expect(plan.interactionMap.enabled).toBe(true);
  });

  it('only accepts published sandbox cards for sandbox payments', () => {
    const plan = (provider: string, cardNumber: string) => ({ payment: { mode: 'sandbox', provider, cardNumber } });
    expect(testPlanSchema.safeParse(plan('stripe', '4242 4242 4242 4242')).success).toBe(true);
    expect(testPlanSchema.safeParse(plan('stripe', '4111111111111112')).success).toBe(false);
    expect(testPlanSchema.safeParse(plan('adyen', '4242424242424242')).success).toBe(false);
    expect(testPlanSchema.safeParse(plan('stripe', '')).success).toBe(false);
    expect(isSandboxTestCard('braintree', '4111-1111-1111-1111')).toBe(true);
  });

  it('does not check the card while payment is switched off', () => {
    expect(testPlanSchema.safeParse({ payment: { mode: 'never', cardNumber: '' } }).success).toBe(true);
  });

  it('falls back to defaults instead of throwing on a bad stored plan', () => {
    expect(parseTestPlan({ category: 'nonsense' }).category).toBe('auto');
    expect(parseTestPlan(null).transactions.enabled).toBe(false);
  });
});
