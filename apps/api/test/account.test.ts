import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { outbox } from '../src/lib/mailer.js';
import { cookieHeader, createOrg, getApp, injectJson, registerUser } from './helpers.js';

function email() {
  return `account-${randomUUID()}@example.com`;
}

/** The token from the last link mailed to this address. */
function lastLink(to: string, path: string): string {
  const mail = [...outbox].reverse().find((item) => item.to === to && item.text.includes(path));
  expect(mail, `a mail to ${to} with ${path}`).toBeTruthy();
  return new URL(/https?:\/\/\S+/.exec(mail!.text)![0]).searchParams.get('token')!;
}

async function login(address: string, password: string) {
  const response = await injectJson('POST', '/auth/login', { payload: { email: address, password } });
  return { status: response.statusCode, cookie: cookieHeader(response), body: response.json() };
}

async function me(cookie: string) {
  return injectJson('GET', '/auth/me', { cookie });
}

describe('email verification', () => {
  it('mails a link on sign-up that confirms the address once', async () => {
    (await getApp()).env.SMTP_URL = undefined;
    const address = email();
    const user = await registerUser(address);
    expect(user.body.emailVerified).toBe(false);
    const token = lastLink(address, '/verify-email');

    expect((await injectJson('POST', '/auth/verify-email', { payload: { token } })).statusCode).toBe(200);
    expect((await me(user.cookie)).json().emailVerified).toBe(true);
    expect((await injectJson('POST', '/auth/verify-email', { payload: { token } })).statusCode).toBe(400);
  });

  it('sends a fresh link on request and the old one stops working', async () => {
    (await getApp()).env.SMTP_URL = undefined;
    const address = email();
    const user = await registerUser(address);
    const first = lastLink(address, '/verify-email');
    expect((await injectJson('POST', '/auth/resend-verification', { cookie: user.cookie })).json()).toMatchObject({ ok: true });
    const second = lastLink(address, '/verify-email');
    expect(second).not.toBe(first);
    expect((await injectJson('POST', '/auth/verify-email', { payload: { token: first } })).statusCode).toBe(400);
    expect((await injectJson('POST', '/auth/verify-email', { payload: { token: second } })).statusCode).toBe(200);
  });
});

describe('password reset', () => {
  it('answers the same for unknown emails and mails nothing', async () => {
    const before = outbox.length;
    const response = await injectJson('POST', '/auth/forgot-password', { payload: { email: email() } });
    expect(response.statusCode).toBe(202);
    expect(outbox.length).toBe(before);
  });

  it('resets the password with the mailed link, signs out old sessions and confirms the email', async () => {
    (await getApp()).env.SMTP_URL = undefined;
    const address = email();
    const user = await registerUser(address, 'old-password-123');
    expect((await injectJson('POST', '/auth/forgot-password', { payload: { email: address.toUpperCase() } })).statusCode).toBe(202);
    const token = lastLink(address, '/reset-password');

    const reset = await injectJson('POST', '/auth/reset-password', { payload: { token, password: 'new-password-456' } });
    expect(reset.statusCode).toBe(204);
    expect((await me(user.cookie)).statusCode).toBe(401);
    expect((await login(address, 'old-password-123')).status).toBe(401);
    const fresh = await login(address, 'new-password-456');
    expect(fresh.status).toBe(200);
    expect(fresh.body.emailVerified).toBe(true);

    const again = await injectJson('POST', '/auth/reset-password', { payload: { token, password: 'another-pass-789' } });
    expect(again.statusCode).toBe(400);
  });

  it('rejects a short new password', async () => {
    const response = await injectJson('POST', '/auth/reset-password', { payload: { token: 'x'.repeat(43), password: 'short' } });
    expect(response.statusCode).toBe(400);
  });
});

describe('change password', () => {
  it('needs the current password and signs out other browsers', async () => {
    const address = email();
    const user = await registerUser(address, 'first-password-1');
    const other = await login(address, 'first-password-1');

    const wrong = await injectJson('POST', '/auth/change-password', {
      cookie: user.cookie,
      payload: { currentPassword: 'nope-nope-nope', newPassword: 'second-password-2' },
    });
    expect(wrong.statusCode).toBe(400);

    const changed = await injectJson('POST', '/auth/change-password', {
      cookie: user.cookie,
      payload: { currentPassword: 'first-password-1', newPassword: 'second-password-2' },
    });
    expect(changed.statusCode).toBe(204);
    expect((await me(cookieHeader(changed))).statusCode).toBe(200);
    expect((await me(other.cookie)).statusCode).toBe(401);
  });
});

describe('delete account', () => {
  it('asks for the email and password, then removes the user and their own workspace', async () => {
    const address = email();
    const user = await registerUser(address);
    const org = await createOrg(user.cookie, 'Solo');

    const wrongEmail = await injectJson('DELETE', '/auth/account', {
      cookie: user.cookie,
      payload: { password: 'password1234', confirmEmail: 'someone@else.com' },
    });
    expect(wrongEmail.statusCode).toBe(400);
    const wrongPassword = await injectJson('DELETE', '/auth/account', {
      cookie: user.cookie,
      payload: { password: 'not-it-at-all', confirmEmail: address },
    });
    expect(wrongPassword.statusCode).toBe(400);

    const deleted = await injectJson('DELETE', '/auth/account', {
      cookie: user.cookie,
      payload: { password: 'password1234', confirmEmail: address.toUpperCase() },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ workspacesDeleted: 1, workspacesKept: 0 });
    const app = await getApp();
    expect(await app.prisma.user.findUnique({ where: { email: address } })).toBeNull();
    expect(await app.prisma.organization.findUnique({ where: { id: org.body.id } })).toBeNull();
    expect((await login(address, 'password1234')).status).toBe(401);
  });

  it('keeps a shared workspace, makes the other member owner and hands over their audits', async () => {
    const app = await getApp();
    const owner = await registerUser(email());
    const org = await createOrg(owner.cookie, 'Shared');
    const colleague = await registerUser(email());
    await app.prisma.membership.create({ data: { organizationId: org.body.id, userId: colleague.body.id, role: 'MEMBER' } });
    const project = await app.prisma.project.create({ data: { organizationId: org.body.id, name: 'Site', baseUrl: 'https://example.com' } });
    const run = await app.prisma.run.create({
      data: { organizationId: org.body.id, projectId: project.id, createdById: owner.body.id, status: 'COMPLETED' },
    });

    const deleted = await injectJson('DELETE', '/auth/account', {
      cookie: owner.cookie,
      payload: { password: 'password1234', confirmEmail: owner.body.email },
    });
    expect(deleted.json()).toEqual({ workspacesDeleted: 0, workspacesKept: 1 });
    const membership = await app.prisma.membership.findFirstOrThrow({ where: { organizationId: org.body.id } });
    expect(membership).toMatchObject({ userId: colleague.body.id, role: 'OWNER' });
    expect((await app.prisma.run.findUniqueOrThrow({ where: { id: run.id } })).createdById).toBe(colleague.body.id);
  });
});

describe('stored files', () => {
  it('deletes the screenshots of a deleted workspace', async () => {
    const app = await getApp();
    const address = email();
    const user = await registerUser(address);
    const org = await createOrg(user.cookie, 'Files');
    const project = await app.prisma.project.create({ data: { organizationId: org.body.id, name: 'Site', baseUrl: 'https://example.com' } });
    const run = await app.prisma.run.create({
      data: { organizationId: org.body.id, projectId: project.id, createdById: user.body.id, status: 'COMPLETED' },
    });
    const key = `runs/${run.id}/shot.png`;
    await app.storage.put({ key, body: Buffer.from('png'), contentType: 'image/png' });
    expect((await app.storage.get(key)).toString()).toBe('png');

    await injectJson('DELETE', '/auth/account', { cookie: user.cookie, payload: { password: 'password1234', confirmEmail: address } });
    await expect(app.storage.get(key)).rejects.toThrow();
  });
});
