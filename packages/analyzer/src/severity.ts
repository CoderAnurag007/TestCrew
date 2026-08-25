import type { FindingSeverity } from '@auditor/shared';

export interface DetectionSignal {
  kind:
    | 'http_500'
    | 'http_400'
    | 'uncaught_js'
    | 'page_crash'
    | 'timeout'
    | 'failed_assertion'
    | 'missing_element'
    | 'navigation_failure';
  url?: string;
  message: string;
  authPath?: boolean;
}

export class SeverityClassifier {
  classify(signals: DetectionSignal[]): FindingSeverity {
    const kinds = new Set(signals.map((item) => item.kind));
    const authFailure = signals.some((item) => item.authPath && (item.kind === 'http_500' || item.kind === 'page_crash'));
    const strong = kinds.has('page_crash') && (kinds.has('http_500') || kinds.has('uncaught_js'));
    if ((strong || (authFailure && kinds.has('uncaught_js'))) && signals.length >= 2) {
      return 'CRITICAL';
    }
    if (kinds.has('http_500') || kinds.has('page_crash') || kinds.has('uncaught_js') || kinds.has('timeout')) {
      return 'HIGH';
    }
    if (kinds.has('failed_assertion') || kinds.has('missing_element') || kinds.has('navigation_failure')) {
      return 'MEDIUM';
    }
    if (kinds.has('http_400')) {
      return 'MEDIUM';
    }
    return 'LOW';
  }
}
