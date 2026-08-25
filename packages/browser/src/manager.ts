import { resolveChromiumExecutable } from './browsers-path.js';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type LaunchOptions,
  type Page,
} from 'playwright';

export class BrowserManager {
  private browser: Browser | null = null;

  async launch(options: LaunchOptions = {}): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }
    this.browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage'],
      ...options,
      executablePath: options.executablePath ?? resolveChromiumExecutable(),
    });
    return this.browser;
  }

  async createContext(options: BrowserContextOptions = {}): Promise<BrowserContext> {
    const browser = await this.launch();
    return browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      ...options,
    });
  }

  async createPage(context: BrowserContext): Promise<Page> {
    return context.newPage();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
