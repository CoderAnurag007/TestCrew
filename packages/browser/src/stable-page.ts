import type { Page } from 'playwright';

export function isNavigationDestroyedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Target closed|frame was detached|most likely because of a navigation/i.test(
    message,
  );
}

export async function waitForPageSettle(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForLoadState('load', { timeout: Math.min(timeoutMs, 10_000) }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
}

export async function waitForSpaSettle(page: Page, timeoutMs = 8_000): Promise<void> {
  await waitForPageSettle(page, timeoutMs);
  const deadline = Date.now() + 2_500;
  let previous = '';
  while (Date.now() < deadline) {
    const signature = String(
      await page
        .evaluate(`(() => {
        const main = document.querySelector('main, [role="main"], router-outlet, .mat-sidenav-content, .mat-drawer-content') || document.body;
        const heading = document.querySelector('h1, h2, [data-testid="page-title"], [aria-current="page"]');
        return location.href + '|' + ((heading && heading.textContent) || '').trim() + '|' + ((main && main.textContent) || '').replace(/\\s+/g, ' ').slice(0, 180);
      })()`)
        .catch(() => ''),
    );
    if (signature && signature === previous) {
      break;
    }
    previous = signature;
    await page.waitForTimeout(280);
  }
}

export async function withNavigationRetry<T>(
  page: Page,
  operation: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await waitForPageSettle(page);
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isNavigationDestroyedError(error) || attempt === attempts) {
        throw error;
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }
  throw lastError;
}
