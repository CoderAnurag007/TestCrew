import { describe, expect, it } from 'vitest';
import { parseTestPlan, type SemanticPage } from '@auditor/shared';
import { describeChange } from '../src/interaction-map.js';
import { detectCategory } from '../src/journeys/detect.js';
import { moneyEqual, parseMoney } from '../src/journeys/toolkit.js';
import { resolveRunPermissions } from '../src/safety-mode.js';

describe('run permissions', () => {
  const plan = parseTestPlan({
    transactions: { enabled: true, maxPerRun: 1, stopBefore: 'none' },
    payment: { mode: 'sandbox', provider: 'stripe', cardNumber: '4242424242424242' },
  });

  it('allows orders and sandbox payment only on staging in full mode', () => {
    const ok = resolveRunPermissions({ kind: 'STAGING', mode: 'FULL', plan });
    expect(ok.transactionsAllowed).toBe(true);
    expect(ok.paymentAllowed).toBe(true);

    const prod = resolveRunPermissions({ kind: 'PRODUCTION', mode: 'FULL', plan });
    expect(prod.transactionsAllowed).toBe(false);
    expect(prod.transactionsReason).toMatch(/Production/);
    expect(prod.paymentAllowed).toBe(false);

    expect(resolveRunPermissions({ kind: 'STAGING', mode: 'READ_ONLY', plan }).transactionsAllowed).toBe(false);
  });

  it('stops before payment when the plan says so or the card is not a sandbox card', () => {
    const stop = resolveRunPermissions({
      kind: 'STAGING',
      mode: 'FULL',
      plan: { ...plan, transactions: { ...plan.transactions, stopBefore: 'payment' } },
    });
    expect(stop.transactionsAllowed).toBe(true);
    expect(stop.paymentAllowed).toBe(false);

    const badCard = resolveRunPermissions({
      kind: 'STAGING',
      mode: 'FULL',
      plan: { ...plan, payment: { ...plan.payment, cardNumber: '5105105105105100' } },
    });
    expect(badCard.paymentAllowed).toBe(false);

    expect(resolveRunPermissions({ kind: 'STAGING', mode: 'FULL', plan: parseTestPlan({}) }).transactionsAllowed).toBe(false);
  });
});

describe('money', () => {
  it('parses common currency formats', () => {
    expect(parseMoney('$1,234.56')).toBe(1234.56);
    expect(parseMoney('₹1,23,456.00')).toBe(123456);
    expect(parseMoney('1.234,56 €')).toBe(1234.56);
    expect(parseMoney('Total: $17.50')).toBe(17.5);
    expect(parseMoney('-$5.00')).toBe(-5);
    expect(parseMoney('free')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('Total:\u00a0$1,050.00')).toBe(1050);
  });

  it('compares to the cent', () => {
    expect(moneyEqual(25, 25.004)).toBe(true);
    expect(moneyEqual(25, 12.5)).toBe(false);
    expect(moneyEqual(null, 0)).toBe(false);
  });
});

describe('interaction changes', () => {
  it('describes counter changes and ignores identical text or ticking clocks', () => {
    expect(describeChange('Cart (0) Home', 'Cart (1) Home')).toMatch(/→/);
    expect(describeChange('same text', 'same text')).toBeNull();
    expect(describeChange('Time 10:01', 'Time 10:02')).toBeNull();
    expect(describeChange('Menu', 'Menu Shirts Shoes Bags')).toMatch(/Shows new content/);
    expect(describeChange('Menu Shirts Shoes', 'Menu')).toMatch(/Hides content/);
  });
});

describe('category detection', () => {
  const page = (text: string, elements: Array<{ text: string; href?: string }> = []): SemanticPage =>
    ({
      url: 'https://x.test/',
      title: 'Home',
      route: '/',
      importantText: [text],
      contentSignature: text,
      listItems: [],
      elements: elements.map((el) => ({ text: el.text, label: el.text, href: el.href ?? null, inputType: null })),
    }) as unknown as SemanticPage;

  it('spots a shop', () => {
    const shop = page('Mug $12.00 Bottle $8.00 Bag $30.00 Hat $5.00 Cap $6.00', [{ text: 'Add to cart' }, { text: 'Cart', href: '/cart' }]);
    expect(detectCategory([shop]).category).toBe('ecommerce');
  });

  it('spots a booking site and falls back to generic', () => {
    expect(detectCategory([page('Book now and check availability for 2 guests', [{ text: 'Book now' }])]).category).toBe('booking');
    expect(detectCategory([page('Welcome')]).category).toBe('generic');
  });
});
