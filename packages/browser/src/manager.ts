import { resolveChromiumExecutable } from './browsers-path.js';
import { BrowserNotInstalledError, currentDeviceProfile, deviceContextOptions } from './device.js';
import {
  chromium,
  webkit,
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
    // AUDITOR_HEADFUL=1 opens a visible browser window on the worker machine so a
    // developer can watch every click; AUDITOR_SLOWMO adds a delay per action.
    const headful = process.env.AUDITOR_HEADFUL === '1' || process.env.AUDITOR_HEADFUL === 'true';
    const engine = currentDeviceProfile().engine;
    const shared = { headless: !headful, slowMo: headful ? Number(process.env.AUDITOR_SLOWMO ?? 150) : undefined };
    if (engine === 'webkit') {
      try {
        this.browser = await webkit.launch({ ...shared, ...options });
      } catch (error) {
        if (/Executable doesn't exist|browserType\.launch: .*not found|playwright install/i.test(String(error))) {
          throw new BrowserNotInstalledError('webkit');
        }
        throw error;
      }
      return this.browser;
    }
    this.browser = await chromium.launch({
      ...shared,
      args: ['--disable-dev-shm-usage'],
      ...options,
      executablePath: options.executablePath ?? resolveChromiumExecutable(),
    });
    return this.browser;
  }

  async createContext(options: BrowserContextOptions = {}): Promise<BrowserContext> {
    const browser = await this.launch();
    return browser.newContext(
      deviceContextOptions({
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
        ...options,
      }),
    );
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
