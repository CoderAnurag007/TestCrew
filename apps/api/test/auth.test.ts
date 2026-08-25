import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cookieHeader, injectJson, registerUser } from './helpers.js';

describe('authentication API', () => {
  it('registers, returns the current user, and never exposes a password hash', async () => {
    const email = `ada-${randomUUID()}@example.com`;
    const registered = await registerUser(email);
    expect(registered.status).toBe(201);
    expect(registered.body.email).toBe(email);
    expect(registered.body.memberships).toEqual([]);
    expect(registered.body.passwordHash).toBeUndefined();
    expect(registered.cookie).toContain('auditor_session=');

    const me = await injectJson('GET', '/auth/me', { cookie: registered.cookie });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(email);
    expect(me.json().passwordHash).toBeUndefined();
  });

  it('rejects invalid credentials and logs in with the same cookie session after success', async () => {
    const email = `grace-${randomUUID()}@example.com`;
    await registerUser(email);

    const failed = await injectJson('POST', '/auth/login', {
      payload: { email, password: 'wrong-password-value' },
    });
    expect(failed.statusCode).toBe(401);

    const login = await injectJson('POST', '/auth/login', {
      payload: { email, password: 'password1234' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().email).toBe(email);

    const logout = await injectJson('POST', '/auth/logout', {
      cookie: cookieHeader(login),
    });
    expect(logout.statusCode).toBe(204);
  });

  it('rejects unauthenticated access to /auth/me', async () => {
    const me = await injectJson('GET', '/auth/me');
    expect(me.statusCode).toBe(401);
  });
});
