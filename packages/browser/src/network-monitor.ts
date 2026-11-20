import type { Page, Request, Response } from 'playwright';

export interface NetworkFailure {
  url: string;
  method: string;
  status?: number;
  error?: string;
  timestamp: string;
}

export interface NavigationEvent {
  url: string;
  timestamp: string;
}

export class NetworkMonitor {
  private readonly failures: NetworkFailure[] = [];
  private readonly navigations: NavigationEvent[] = [];
  private attached = false;

  attach(page: Page): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    page.on('requestfailed', (request: Request) => {
      this.failures.push({
        url: request.url(),
        method: request.method(),
        error: request.failure()?.errorText,
        timestamp: new Date().toISOString(),
      });
    });
    page.on('response', (response: Response) => {
      if (response.status() >= 400 && !response.headers()['x-snaghunt-blocked']) {
        this.failures.push({
          url: response.url(),
          method: response.request().method(),
          status: response.status(),
          timestamp: new Date().toISOString(),
        });
      }
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.navigations.push({
          url: frame.url(),
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  snapshot(): { failures: NetworkFailure[]; navigations: NavigationEvent[] } {
    return {
      failures: [...this.failures],
      navigations: [...this.navigations],
    };
  }
}
