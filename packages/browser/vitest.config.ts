import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    env: {
      PLAYWRIGHT_BROWSERS_PATH: resolve(import.meta.dirname, '../../.playwright'),
    },
  },
});
