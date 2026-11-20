import { resolve } from 'node:path';

// Containers set PLAYWRIGHT_BROWSERS_PATH (e.g. /ms-playwright); locally the repo's .playwright folder is used.
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve(import.meta.dirname, '../../../.playwright');
