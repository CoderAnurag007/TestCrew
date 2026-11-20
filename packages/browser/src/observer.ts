import type { Page } from 'playwright';
import { ConsoleMonitor, type ConsoleMessageRecord } from './console-monitor.js';
import { AccessibilityExtractor, DOMExtractor } from './extractors.js';
import { NetworkMonitor, type NavigationEvent, type NetworkFailure } from './network-monitor.js';
import { ScreenshotManager } from './screenshot.js';
import { SemanticExtractor } from './semantic-extractor.js';
import { withNavigationRetry } from './stable-page.js';
import type { SemanticPage } from '@auditor/shared';

export interface PageObservation {
  semantic: SemanticPage;
  dom: string;
  accessibilityTree: unknown;
  screenshot: Buffer;
  console: ConsoleMessageRecord[];
  networkFailures: NetworkFailure[];
  navigations: NavigationEvent[];
  pageErrors: ConsoleMessageRecord[];
}

export class PageObserver {
  private readonly consoleMonitor = new ConsoleMonitor();
  private readonly networkMonitor = new NetworkMonitor();
  private readonly screenshots = new ScreenshotManager();
  private readonly semantic = new SemanticExtractor();
  private readonly dom = new DOMExtractor();
  private readonly accessibility = new AccessibilityExtractor();
  private attached = false;
  private consoleOffset = 0;
  private networkOffset = 0;

  attach(page: Page): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.consoleMonitor.attach(page);
    this.networkMonitor.attach(page);
  }

  async observe(page: Page): Promise<PageObservation> {
    this.attach(page);
    return withNavigationRetry(page, async () => {
      const semantic = await this.semantic.extract(page);
      const dom = await this.dom.extract(page);
      const accessibilityTree = await this.accessibility.extract(page);
      const screenshot = await this.screenshots.capture(page);
      // Only what happened since the previous observation belongs to this screen;
      // otherwise one page's errors would be blamed on every page after it.
      const allConsole = this.consoleMonitor.snapshot();
      const allNetwork = this.networkMonitor.snapshot();
      const consoleMessages = allConsole.slice(this.consoleOffset);
      const network = { failures: allNetwork.failures.slice(this.networkOffset), navigations: allNetwork.navigations };
      this.consoleOffset = allConsole.length;
      this.networkOffset = allNetwork.failures.length;
      return {
        semantic,
        dom,
        accessibilityTree,
        screenshot,
        console: consoleMessages,
        networkFailures: network.failures,
        navigations: network.navigations,
        pageErrors: consoleMessages.filter((item) => item.type === 'pageerror'),
      };
    });
  }
}
