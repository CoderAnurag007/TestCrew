import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SecretStore {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

export class LocalAesGcmSecretStore implements SecretStore {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error('Encryption key must be 32 bytes');
    }
  }

  static fromHexKey(hex: string): LocalAesGcmSecretStore {
    return new LocalAesGcmSecretStore(Buffer.from(hex, 'hex'));
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
  }

  async decrypt(ciphertext: string): Promise<string> {
    const [version, ivB64, tagB64, dataB64] = ciphertext.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('Invalid ciphertext format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }
}
