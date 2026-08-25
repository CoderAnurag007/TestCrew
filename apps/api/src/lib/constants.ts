export const SESSION_COOKIE = 'auditor_session';
export const SESSION_PREFIX = 'session:';

export { AUDIT_QUEUE_NAME, START_AUDIT_JOB } from '@auditor/shared';

export interface SessionRecord {
  userId: string;
  createdAt: string;
}

export function sessionKey(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`;
}
