import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 240000,
    hookTimeout: 240000,
    env: {
      PLAYWRIGHT_BROWSERS_PATH: resolve(import.meta.dirname, '../../.playwright'),
    },
  },
});
