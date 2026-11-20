import { describe, expect, it } from 'vitest';
import { globToRegExp, SafetyGuard } from '../src/safety.js';

const publicResolver = async () => ['93.184.216.34'];

function request(method: string, url: string, postData: string | null = null) {
  return { method: () => method, url: () => url, postData: () => postData };
}

describe('transactions and sandbox payments', () => {
  const staging = (extra: { allowTransactions?: boolean; allowSandboxPayments?: boolean; blockedPathPatterns?: string[] } = {}) =>
    new SafetyGuard({ mode: 'FULL', allowPrivate: false, targetOrigin: 'https://staging.shop.test', resolver: publicResolver, ...extra });
  const post = (url: string, body: string | null = null, auth = '') => ({
    method: () => 'POST',
    url: () => url,
    postData: () => body,
    resourceType: () => 'fetch',
    headers: (): Record<string, string> => (auth ? { authorization: auth } : {}),
  });

  it('keeps checkout and order paths blocked unless transactions are allowed', async () => {
    expect(await staging().decide(post('https://staging.shop.test/checkout/complete'))).toMatch(/blocked pattern/);
    expect(await staging({ allowTransactions: true }).decide(post('https://staging.shop.test/checkout/complete'))).toBeNull();
    expect(await staging({ allowTransactions: true }).decide(post('https://staging.shop.test/account/delete-account'))).toMatch(/blocked pattern/);
    expect(await staging({ allowTransactions: true, blockedPathPatterns: ['/admin/*'] }).decide(post('https://staging.shop.test/admin/x'))).toMatch(
      /blocked pattern/,
    );
  });

  it('lets payment providers through only with sandbox keys', async () => {
    const guard = staging({ allowTransactions: true, allowSandboxPayments: true });
    expect(await guard.decide(post('https://api.stripe.com/v1/payment_methods', 'key=pk_test_abc123&card[number]=4242'))).toBeNull();
    expect(await guard.decide(post('https://api.stripe.com/v1/payment_methods', 'key=pk_live_abc123'))).toMatch(/live payment key/);
    expect(await guard.decide(post('https://api.stripe.com/v1/payment_methods', 'card=1'))).toMatch(/no recognisable sandbox key/);
    expect(await staging({ allowTransactions: true }).decide(post('https://api.stripe.com/v1/payment_methods', 'key=pk_test_abc'))).toMatch(
      /not enabled/,
    );
  });

  it('never sends a request that carries a live key, in any mode', async () => {
    expect(await staging({ allowTransactions: true }).decide(post('https://staging.shop.test/pay', 'publishableKey=pk_live_123'))).toMatch(
      /live payment key/,
    );
    expect(await staging().decide(post('https://staging.shop.test/api/x', null, 'Bearer sk_live_999'))).toMatch(/live payment key/);
  });
});

describe('SafetyGuard', () => {
  const readOnly = () =>
    new SafetyGuard({ mode: 'READ_ONLY', allowPrivate: false, targetOrigin: 'https://shop.example.com', resolver: publicResolver });
  const full = (patterns: string[] = []) =>
    new SafetyGuard({
      mode: 'FULL',
      allowPrivate: false,
      targetOrigin: 'https://shop.example.com',
      blockedPathPatterns: patterns,
      resolver: publicResolver,
    });

  it('lets reads through in read-only mode and blocks writes', async () => {
    const guard = readOnly();
    expect(await guard.decide(request('GET', 'https://shop.example.com/products'))).toBeNull();
    expect(await guard.decide(request('POST', 'https://shop.example.com/cart/add'))).toMatch(/Read-only/);
    expect(await guard.decide(request('DELETE', 'https://shop.example.com/api/items/1'))).toMatch(/Read-only/);
  });

  it('blocks writes no matter what the button said, including third-party hosts', async () => {
    const guard = readOnly();
    expect(await guard.decide(request('PUT', 'https://api.other.com/x'))).toMatch(/Read-only/);
  });

  it('allows same-origin writes only during the login step in read-only mode', async () => {
    const guard = readOnly();
    guard.setPhase('auth');
    expect(await guard.decide(request('POST', 'https://shop.example.com/login'))).toBeNull();
    expect(await guard.decide(request('POST', 'https://tracker.example.net/collect'))).toMatch(/Read-only/);
    guard.setPhase('audit');
    expect(await guard.decide(request('POST', 'https://shop.example.com/login'))).toMatch(/Read-only/);
  });

  it('allows read-only GraphQL queries but not mutations', async () => {
    const guard = readOnly();
    const query = JSON.stringify({ query: 'query Products { products { id } }' });
    const shorthand = JSON.stringify({ query: '{ products { id } }' });
    const mutation = JSON.stringify({ query: 'mutation AddToCart { addToCart(id: 1) { id } }' });
    expect(await guard.decide(request('POST', 'https://shop.example.com/graphql', query))).toBeNull();
    expect(await guard.decide(request('POST', 'https://shop.example.com/graphql', shorthand))).toBeNull();
    expect(await guard.decide(request('POST', 'https://shop.example.com/graphql', mutation))).toMatch(/Read-only/);
  });

  it('always blocks payment providers and checkout paths, even in full mode', async () => {
    const guard = full();
    expect(await guard.decide(request('POST', 'https://api.stripe.com/v1/payment_intents'))).toMatch(/payment provider/);
    expect(await guard.decide(request('POST', 'https://api.razorpay.com/v1/orders'))).toMatch(/payment provider/);
    expect(await guard.decide(request('POST', 'https://shop.example.com/checkout/complete'))).toMatch(/blocked pattern/);
    expect(await guard.decide(request('POST', 'https://shop.example.com/api/place-order'))).toMatch(/blocked pattern/);
    expect(await guard.decide(request('POST', 'https://shop.example.com/cart/add'))).toBeNull();
    expect(await guard.decide(request('GET', 'https://checkout.stripe.com/pay'))).toBeNull();
  });

  it('enforces project-defined blocked paths', async () => {
    const guard = full(['/admin/*', '/api/newsletter']);
    expect(await guard.decide(request('POST', 'https://shop.example.com/admin/users/1'))).toMatch(/blocked pattern/);
    expect(await guard.decide(request('POST', 'https://shop.example.com/api/newsletter'))).toMatch(/blocked pattern/);
    expect(await guard.decide(request('POST', 'https://shop.example.com/api/reviews'))).toBeNull();
  });

  it('keeps SSRF protection for every request', async () => {
    const guard = new SafetyGuard({
      mode: 'FULL',
      allowPrivate: false,
      targetOrigin: 'https://shop.example.com',
      resolver: async () => ['10.0.0.5'],
    });
    expect(await guard.decide(request('GET', 'https://internal.example.com/'))).toMatch(/private|reserved/i);
    expect(await guard.decide(request('GET', 'http://169.254.169.254/latest/meta-data'))).toMatch(/metadata|reserved/i);
  });
});

describe('globToRegExp', () => {
  it('matches * as any run of characters, case-insensitively', () => {
    expect(globToRegExp('*checkout*').test('/en/checkout/step-1')).toBe(true);
    expect(globToRegExp('/admin/*').test('/admin/users')).toBe(true);
    expect(globToRegExp('/admin/*').test('/public/admin')).toBe(false);
    expect(globToRegExp('/API/Orders').test('/api/orders')).toBe(true);
  });
});

describe('analytics beacons in read-only mode', () => {
  const guard = () =>
    new SafetyGuard({ mode: 'READ_ONLY', allowPrivate: false, targetOrigin: 'https://shop.example.com', resolver: publicResolver });
  const post = (url: string, resourceType = 'fetch') => ({
    method: () => 'POST',
    url: () => url,
    postData: () => null,
    resourceType: () => resourceType,
  });

  it('lets measurement beacons through because they change no app data', async () => {
    expect(await guard().decide(post('https://shop.example.com/cdn-cgi/rum?'))).toBeNull();
    expect(await guard().decide(post('https://www.google-analytics.com/g/collect?v=2'))).toBeNull();
    expect(await guard().decide(post('https://shop.example.com/anything', 'ping'))).toBeNull();
  });

  it('still blocks app endpoints that only look similar', async () => {
    expect(await guard().decide(post('https://shop.example.com/api/events'))).toMatch(/Read-only/);
    expect(await guard().decide(post('https://shop.example.com/api/track-order'))).toMatch(/Read-only/);
    expect(await guard().decide(post('https://shop.example.com/cart/add'))).toMatch(/Read-only/);
  });
});

describe('third-party tracker errors', () => {
  it('ignores analytics failures but keeps real app errors', async () => {
    const { isThirdPartyTrackerError } = await import('../src/safety.js');
    expect(isThirdPartyTrackerError('Fetch API cannot load https://e.clarity.ms/collect due to access control checks.')).toBe(true);
    expect(isThirdPartyTrackerError('/q.clarity.ms/collect due to access control checks')).toBe(true);
    expect(isThirdPartyTrackerError('Unknown operation: run')).toBe(false);
    expect(isThirdPartyTrackerError('TypeError: undefined is not an object (evaluating "a.b")')).toBe(false);
  });
});
