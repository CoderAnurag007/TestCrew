import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/lib/http-error.js';
import { assertAuthenticated, assertMinRole } from '../src/lib/authorization.js';

describe('assertAuthenticated', () => {
  it('throws 401 when the user is missing', () => {
    expect(() => assertAuthenticated(undefined)).toThrow(HttpError);
    try {
      assertAuthenticated(undefined);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(401);
    }
  });

  it('allows a user id', () => {
    expect(() => assertAuthenticated('user_1')).not.toThrow();
  });
});

describe('assertMinRole', () => {
  it('returns 404 when membership is missing to avoid tenant leakage', () => {
    try {
      assertMinRole(null, 'VIEWER');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(404);
    }
  });

  it('returns 403 when the role is too low', () => {
    try {
      assertMinRole('VIEWER', 'ADMIN');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(403);
    }
  });

  it('allows OWNER for ADMIN-gated actions', () => {
    expect(assertMinRole('OWNER', 'ADMIN')).toBe('OWNER');
  });
});
