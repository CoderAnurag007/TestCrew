import type { Page } from 'playwright';

export class ScreenshotManager {
  async capture(page: Page): Promise<Buffer> {
    return page.screenshot({ fullPage: false, type: 'png' });
  }
}
