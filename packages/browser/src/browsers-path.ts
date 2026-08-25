import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO_PLAYWRIGHT_BROWSERS = resolve(import.meta.dirname, '../../../.playwright');

const EXECUTABLE_NAMES = [
  'chrome-headless-shell.exe',
  'chrome-headless-shell',
  'chrome.exe',
  'chromium',
  'chrome',
];

export function ensurePlaywrightBrowsersPath(): string {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const path = configured && existsSync(configured) ? configured : REPO_PLAYWRIGHT_BROWSERS;
  process.env.PLAYWRIGHT_BROWSERS_PATH = path;
  return path;
}

ensurePlaywrightBrowsersPath();

export function resolveChromiumExecutable(): string {
  const root = ensurePlaywrightBrowsersPath();
  const matches: string[] = [];
  const queue = existsSync(root) ? [root] : [];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (!dir) {
      break;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (EXECUTABLE_NAMES.includes(entry.name)) {
        matches.push(full);
      }
    }
  }
  for (const name of EXECUTABLE_NAMES) {
    const hit = matches.find((file) => file.endsWith(name));
    if (hit) {
      return hit;
    }
  }
  throw new Error(
    `Playwright Chromium was not found in ${root}. Run: PLAYWRIGHT_BROWSERS_PATH=.playwright pnpm --filter @auditor/browser exec playwright install chromium`,
  );
}
