import { describe, expect, it } from 'vitest';
import { LocalAesGcmSecretStore } from '../src/secret-store.js';

describe('LocalAesGcmSecretStore', () => {
  it('round-trips secrets and never equals plaintext', async () => {
    const store = LocalAesGcmSecretStore.fromHexKey(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );
    const ciphertext = await store.encrypt('hunter2-secret');
    expect(ciphertext).not.toContain('hunter2-secret');
    expect(await store.decrypt(ciphertext)).toBe('hunter2-secret');
  });
});
