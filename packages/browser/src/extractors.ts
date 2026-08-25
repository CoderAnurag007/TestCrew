import type { Page } from 'playwright';

export class DOMExtractor {
  async extract(page: Page): Promise<string> {
    return page.content();
  }
}

export class AccessibilityExtractor {
  async extract(page: Page): Promise<unknown> {
    return page.locator('body').ariaSnapshot();
  }
}
