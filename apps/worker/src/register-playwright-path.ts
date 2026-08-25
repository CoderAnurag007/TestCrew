import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(import.meta.dirname, '../../../.playwright');
