import type { FindingCategory } from '@auditor/shared';
import type { DetectionSignal } from './severity.js';

export class FindingClassifier {
  category(signal: DetectionSignal): FindingCategory {
    if (signal.kind === 'uncaught_js' || signal.kind === 'page_crash' || signal.kind === 'http_500') {
      return 'BUG';
    }
    if (signal.kind === 'timeout' || signal.kind === 'navigation_failure') {
      return 'BUG';
    }
    return 'BUG';
  }
}

export class ErrorDetector {
  detect(input: {
    httpFailures?: Array<{ url: string; status?: number; error?: string }>;
    pageErrors?: string[];
    consoleErrors?: string[];
    assertionMessage?: string;
    timeout?: boolean;
    url?: string;
  }): DetectionSignal[] {
    const signals: DetectionSignal[] = [];
    const authPath = /login|signin|auth/i.test(input.url ?? '');
    for (const failure of input.httpFailures ?? []) {
      if ((failure.status ?? 0) >= 500) {
        signals.push({
          kind: 'http_500',
          url: failure.url,
          message: `HTTP ${failure.status} for ${failure.url}`,
          authPath,
        });
      } else if (failure.status === 400) {
        signals.push({
          kind: 'http_400',
          url: failure.url,
          message: `Unexpected HTTP 400 for ${failure.url}`,
          authPath,
        });
      }
    }
    for (const error of input.pageErrors ?? []) {
      signals.push({
        kind: /crash|detached/i.test(error) ? 'page_crash' : 'uncaught_js',
        url: input.url,
        message: error,
        authPath,
      });
    }
    if (input.timeout) {
      signals.push({ kind: 'timeout', url: input.url, message: 'Test timed out', authPath });
    }
    if (input.assertionMessage) {
      const kind = /not found|missing|visible/i.test(input.assertionMessage)
        ? 'missing_element'
        : /navigat/i.test(input.assertionMessage)
          ? 'navigation_failure'
          : 'failed_assertion';
      signals.push({ kind, url: input.url, message: input.assertionMessage, authPath });
    }
    return signals;
  }
}

export class BugDetector {
  constructor(
    private readonly errors = new ErrorDetector(),
  ) {}

  detect(input: Parameters<ErrorDetector['detect']>[0]): DetectionSignal[] {
    return this.errors.detect(input);
  }
}
