import { createHash, randomBytes } from 'node:crypto';

/** Project API tokens look like `tc_<43 url-safe chars>`; only a SHA-256 hash is stored. */
export const TOKEN_PREFIX = 'tc_';

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashApiToken(token), prefix: token.slice(0, 10) };
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
