import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import type { ObjectStorage, PutObjectInput } from './types.js';

export class LocalFileStorage implements ObjectStorage {
  constructor(private readonly rootDir: string) {}

  private resolveKey(key: string): string {
    if (!key || key.includes('\0') || isAbsolute(key) || /^[a-zA-Z]:/.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    const root = resolve(this.rootDir);
    const full = resolve(root, key);
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  async put(input: PutObjectInput): Promise<{ key: string }> {
    const path = this.resolveKey(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
    return { key: input.key };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }
}
