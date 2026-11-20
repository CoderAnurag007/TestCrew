import { describe, expect, it } from 'vitest';
import { cheapestPlanWith, effectivePlan, limitsFor, monthStart, PLANS } from '../src/plans.js';

const now = new Date('2026-11-20T12:00:00Z');

describe('plans', () => {
  it('gives Pro limits during the trial and Free limits after it', () => {
    const trialEndsAt = new Date('2026-11-30T00:00:00Z');
    expect(effectivePlan({ plan: 'FREE', trialEndsAt }, now)).toBe('PRO');
    expect(effectivePlan({ plan: 'FREE', trialEndsAt }, new Date('2026-12-01T00:00:00Z'))).toBe('FREE');
    expect(effectivePlan({ plan: 'STARTER', trialEndsAt }, now)).toBe('STARTER');
  });

  it('adds paid extra sites only on plans that sell them', () => {
    expect(limitsFor({ plan: 'AGENCY', trialEndsAt: null, extraSites: 5 }, now).sites).toBe(30);
    expect(limitsFor({ plan: 'PRO', trialEndsAt: null, extraSites: 5 }, now).sites).toBe(5);
  });

  it('names the cheapest plan that unlocks a feature', () => {
    expect(cheapestPlanWith((limits) => limits.devices.includes('iphone'))?.id).toBe('PRO');
    expect(cheapestPlanWith((limits) => limits.branding)?.id).toBe('AGENCY');
    expect(cheapestPlanWith((limits) => limits.tickets)?.id).toBe('STARTER');
  });

  it('keeps prices and limits in order from Free to Agency', () => {
    expect(PLANS.FREE.priceUsd).toBe(0);
    expect(PLANS.STARTER.priceUsd).toBeLessThan(PLANS.PRO.priceUsd);
    expect(PLANS.PRO.priceUsd).toBeLessThan(PLANS.AGENCY.priceUsd);
    expect(PLANS.FREE.limits.aiBudgetUsd).toBeLessThan(PLANS.AGENCY.limits.aiBudgetUsd);
  });

  it('starts the usage month on the 1st in UTC', () => {
    expect(monthStart(now).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});
