import { describe, expect, it } from 'vitest';
import { classifyField, valueFor } from '../src/test-data.js';
import { verifyDomainOwnership } from '../src/verification.js';

describe('field-aware test data', () => {
  it('recognises common field kinds from type, name, label and autocomplete', () => {
    expect(classifyField({ inputType: 'email' })).toBe('email');
    expect(classifyField({ name: 'phone_number' })).toBe('phone');
    expect(classifyField({ label: 'PIN code' })).toBe('postal');
    expect(classifyField({ autocomplete: 'given-name' })).toBe('firstName');
    expect(classifyField({ label: 'Quantity', inputType: 'number' })).toBe('quantity');
    expect(classifyField({ tag: 'textarea', label: 'Your message' })).toBe('message');
  });

  it('never fills payment or identity fields', () => {
    expect(valueFor({ label: 'Card number' })).toBeNull();
    expect(valueFor({ autocomplete: 'cc-csc' })).toBeNull();
    expect(valueFor({ name: 'cvv' })).toBeNull();
    expect(valueFor({ label: 'Aadhaar number' })).toBeNull();
    expect(valueFor({ inputType: 'password' })).toBeNull();
  });

  it('respects min, max and length constraints', () => {
    expect(valueFor({ inputType: 'number', min: '5', max: '9' })).toBe('5');
    expect(valueFor({ inputType: 'number', max: '1' })).toBe('1');
    expect(valueFor({ label: 'Name', maxLength: 5 })?.length).toBeLessThanOrEqual(5);
    const date = valueFor({ inputType: 'date', min: '2099-01-01' });
    expect(date).toBe('2099-01-01');
  });

  it('fits digit-only patterns', () => {
    expect(valueFor({ label: 'Code', pattern: '\\d{6}' })).toBe('123456');
  });

  it('mixes the token into free text so created records can be found again', () => {
    expect(valueFor({ label: 'Full name' }, { token: 'abc123' })).toContain('abc123');
    expect(valueFor({ inputType: 'email' }, { token: 'abc123' })).toBe('testcrew+abc123@example.com');
  });

  it('applies overrides by name or label', () => {
    expect(valueFor({ name: 'coupon' }, { overrides: { coupon: 'SAVE10' } })).toBe('SAVE10');
  });
});

describe('domain ownership verification', () => {
  it('passes with the DNS TXT record', async () => {
    const result = await verifyDomainOwnership({
      baseUrl: 'https://shop.example.com',
      token: 'tok123',
      resolveTxt: async (name) => (name === '_testcrew.shop.example.com' ? [['testcrew-verify=tok123']] : []),
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
    });
    expect(result).toMatchObject({ verified: true, method: 'dns' });
  });

  it('fails clearly when neither proof is present', async () => {
    const result = await verifyDomainOwnership({
      baseUrl: 'https://shop.example.com',
      token: 'tok123',
      resolveTxt: async () => [['something-else']],
      resolveHost: async () => ['93.184.216.34'],
      fetchImpl: (async () => new Response('nope', { status: 404 })) as typeof fetch,
    });
    expect(result.verified).toBe(false);
    expect(result.detail).toMatch(/404/);
  });
});
