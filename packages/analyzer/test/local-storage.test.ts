import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalFileStorage } from '../src/local-storage.js';

describe('LocalFileStorage', () => {
  it('stores and retrieves artifacts without accepting path traversal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'auditor-artifacts-'));
    try {
      const storage = new LocalFileStorage(dir);
      await storage.put({
        key: 'runs/run_1/screenshots/a.png',
        body: Buffer.from('png'),
        contentType: 'image/png',
      });
      expect((await storage.get('runs/run_1/screenshots/a.png')).toString()).toBe('png');
      await expect(
        storage.put({
          key: '../secret.txt',
          body: Buffer.from('nope'),
          contentType: 'text/plain',
        }),
      ).rejects.toThrow(/Invalid storage key/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
