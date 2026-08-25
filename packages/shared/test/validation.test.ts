import { describe, expect, it } from 'vitest';
import {
  createProjectBodySchema,
  hasMinRole,
  isLiveRunStatus,
  isTerminalRunStatus,
  loginBodySchema,
  registerBodySchema,
  runStatusSchema,
  START_AUDIT_JOB,
  AUDIT_QUEUE_NAME,
  EXPLORATION_QUEUE_NAME,
} from '../src/index.js';
import {
  assertHostnameAllowed,
  assertSafeNavigationTarget,
  isPrivateOrReservedIp,
  UnsafeTargetError,
} from '../src/ssrf.js';

describe('hasMinRole', () => {
  it('allows equal and higher roles', () => {
    expect(hasMinRole('MEMBER', 'MEMBER')).toBe(true);
    expect(hasMinRole('ADMIN', 'MEMBER')).toBe(true);
    expect(hasMinRole('OWNER', 'ADMIN')).toBe(true);
  });

  it('rejects lower roles', () => {
    expect(hasMinRole('VIEWER', 'MEMBER')).toBe(false);
    expect(hasMinRole('MEMBER', 'ADMIN')).toBe(false);
    expect(hasMinRole('ADMIN', 'OWNER')).toBe(false);
  });
});

describe('registerBodySchema', () => {
  it('accepts a valid registration payload', () => {
    const parsed = registerBodySchema.parse({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      password: 'super-secret-password',
    });
    expect(parsed.email).toBe('ada@example.com');
  });

  it('rejects short passwords and invalid emails', () => {
    expect(() =>
      registerBodySchema.parse({
        email: 'not-an-email',
        name: 'Ada',
        password: 'short',
      }),
    ).toThrow();
  });
});

describe('loginBodySchema', () => {
  it('requires email and password', () => {
    expect(() => loginBodySchema.parse({ email: 'ada@example.com' })).toThrow();
    expect(
      loginBodySchema.parse({ email: 'ada@example.com', password: 'x' }).email,
    ).toBe('ada@example.com');
  });
});

describe('createProjectBodySchema', () => {
  it('defaults environmentName to Production', () => {
    const parsed = createProjectBodySchema.parse({
      organizationId: 'org_1',
      name: 'Checkout',
      baseUrl: 'https://app.example.com',
    });
    expect(parsed.environmentName).toBe('Production');
  });

  it('rejects non-URL baseUrl', () => {
    expect(() =>
      createProjectBodySchema.parse({
        organizationId: 'org_1',
        name: 'Checkout',
        baseUrl: 'not-a-url',
      }),
    ).toThrow();
  });
});

describe('runStatusSchema', () => {
  it('accepts control-plane and exploration statuses', () => {
    expect(runStatusSchema.parse('QUEUED')).toBe('QUEUED');
    expect(runStatusSchema.parse('INITIALIZING')).toBe('INITIALIZING');
    expect(runStatusSchema.parse('AUTHENTICATING')).toBe('AUTHENTICATING');
    expect(runStatusSchema.parse('FINALIZING')).toBe('FINALIZING');
    expect(isTerminalRunStatus('CANCELLED')).toBe(true);
    expect(isTerminalRunStatus('QUEUED')).toBe(false);
    expect(isLiveRunStatus('EXPLORING')).toBe(true);
    expect(isLiveRunStatus('COMPLETED')).toBe(false);
  });
});

describe('queue names', () => {
  it('uses isolated audit and exploration queues', () => {
    expect(AUDIT_QUEUE_NAME).toBe('audit');
    expect(EXPLORATION_QUEUE_NAME).toBe('exploration');
    expect(START_AUDIT_JOB).toBe('START_AUDIT');
  });
});

describe('SSRF protection', () => {
  it('classifies loopback, private, and metadata addresses', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.8')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.4.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.20')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
  });

  it('blocks localhost and metadata hostnames unless private targets are allowed', () => {
    expect(() => assertHostnameAllowed('localhost')).toThrow(UnsafeTargetError);
    expect(() => assertHostnameAllowed('127.0.0.1')).toThrow(UnsafeTargetError);
    expect(() => assertHostnameAllowed('169.254.169.254', true)).toThrow(UnsafeTargetError);
    expect(() => assertHostnameAllowed('localhost', true)).not.toThrow();
    expect(() => assertHostnameAllowed('app.example.com')).not.toThrow();
  });

  it('rejects DNS results that resolve to private addresses', async () => {
    await expect(
      assertSafeNavigationTarget('https://internal.example.com', {
        resolver: async () => ['10.0.0.4'],
      }),
    ).rejects.toBeInstanceOf(UnsafeTargetError);

    await expect(
      assertSafeNavigationTarget('https://app.example.com', {
        resolver: async () => ['8.8.8.8'],
      }),
    ).resolves.toBeTruthy();

    await expect(
      assertSafeNavigationTarget('http://127.0.0.1:4173/login', {
        allowPrivate: true,
        resolver: async () => ['127.0.0.1'],
      }),
    ).resolves.toBeTruthy();
  });
});
