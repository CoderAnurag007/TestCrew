import type { Page } from 'playwright';

export interface ConsoleMessageRecord {
  type: string;
  text: string;
  timestamp: string;
}

export class ConsoleMonitor {
  private readonly messages: ConsoleMessageRecord[] = [];
  private attached = false;

  attach(page: Page): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    page.on('console', (message) => {
      this.messages.push({
        type: message.type(),
        text: message.text().slice(0, 2000),
        timestamp: new Date().toISOString(),
      });
    });
    page.on('pageerror', (error) => {
      this.messages.push({
        type: 'error',
        text: error.message.slice(0, 2000),
        timestamp: new Date().toISOString(),
      });
    });
  }

  snapshot(): ConsoleMessageRecord[] {
    return [...this.messages];
  }
}
