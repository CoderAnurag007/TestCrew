import { isThirdPartyTrackerError } from './safety.js';
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
      const text = message.text();
      if (/ERR_BLOCKED_BY_CLIENT/i.test(text)) {
        // Requests the safety guard blocked on purpose are not application errors.
        return;
      }
      this.messages.push({
        type: message.type(),
        text: message.text().slice(0, 2000),
        timestamp: new Date().toISOString(),
      });
    });
    page.on('pageerror', (error) => {
      if (isThirdPartyTrackerError(error.message)) return;
      this.messages.push({
        // Uncaught exceptions are kept apart from console.error noise; only these count as page errors.
        type: 'pageerror',
        text: error.message.slice(0, 2000),
        timestamp: new Date().toISOString(),
      });
    });
  }

  snapshot(): ConsoleMessageRecord[] {
    return [...this.messages];
  }

  private markIndex = 0;

  /** Remembers where the latest page transition started, so checks can ask "since then". */
  mark(): void {
    this.markIndex = this.messages.length;
  }

  /** Messages recorded since the last mark(). */
  sinceMark(): ConsoleMessageRecord[] {
    return this.messages.slice(this.markIndex);
  }
}
