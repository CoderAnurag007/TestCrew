import type { MembershipRole } from '@auditor/shared';
import { hasMinRole } from '@auditor/shared';
import { HttpError } from '../lib/http-error.js';

export function assertAuthenticated(userId: string | undefined): asserts userId is string {
  if (!userId) {
    throw new HttpError(401, 'Authentication required');
  }
}

export function assertMinRole(
  role: MembershipRole | null | undefined,
  minimum: MembershipRole,
  notFoundMessage = 'Not found',
): MembershipRole {
  if (!role) {
    throw new HttpError(404, notFoundMessage);
  }
  if (!hasMinRole(role, minimum)) {
    throw new HttpError(403, 'Insufficient permissions');
  }
  return role;
}
