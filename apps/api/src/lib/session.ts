import { randomUUID } from 'node:crypto';
import type { SessionStore } from './runtime.js';
import { sessionKey, type SessionRecord } from './constants.js';

export async function createSession(
  redis: SessionStore,
  userId: string,
  ttlSeconds: number,
): Promise<string> {
  const sessionId = randomUUID();
  const record: SessionRecord = {
    userId,
    createdAt: new Date().toISOString(),
  };
  await redis.set(sessionKey(sessionId), JSON.stringify(record), 'EX', ttlSeconds);
  return sessionId;
}

export async function readSession(
  redis: SessionStore,
  sessionId: string,
): Promise<SessionRecord | null> {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as SessionRecord;
}

export async function destroySession(redis: SessionStore, sessionId: string): Promise<void> {
  await redis.del(sessionKey(sessionId));
}
