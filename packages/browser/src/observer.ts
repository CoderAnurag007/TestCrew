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
      const consoleMessages = this.consoleMonitor.snapshot();
      const network = this.networkMonitor.snapshot();
      return {
        semantic,
        dom,
        accessibilityTree,
        screenshot,
        console: consoleMessages,
        networkFailures: network.failures,
        navigations: network.navigations,
        pageErrors: consoleMessages.filter((item) => item.type === 'error'),
      };
    });
  }
}
