import type { AssertionKind, AssertionSpec } from '@auditor/shared';

export interface AssertionContext {
  url: string;
  title: string;
  text: string;
  elementExists: boolean;
  elementVisible: boolean;
  attribute?: string | null;
  value?: string | null;
  count: number;
  httpFailures: Array<{ url: string; status?: number; error?: string }>;
  consoleErrors: string[];
  pageErrors: string[];
}

export interface AssertionResult {
  kind: AssertionKind;
  passed: boolean;
  expected?: string | number | boolean;
  actual: string;
  message: string;
}

export class AssertionEngine {
  evaluate(spec: AssertionSpec, context: AssertionContext): AssertionResult {
    const operator = spec.operator ?? defaultOperator(spec.kind);
    const expected = spec.expected;
    switch (spec.kind) {
      case 'url':
        return compare('url', context.url, expected, operator);
      case 'text':
        return compare('text', context.text, expected, operator);
      case 'visibility':
        return boolResult('visibility', context.elementVisible, operator !== 'absent', 'Element visibility');
      case 'existence':
        return boolResult('existence', context.elementExists, operator !== 'absent', 'Element existence');
      case 'attribute':
        return compare('attribute', context.attribute ?? '', expected, operator);
      case 'value':
        return compare('value', context.value ?? '', expected, operator);
      case 'count': {
        const actual = context.count;
        const passed = numericCompare(actual, Number(expected ?? 1), operator);
        return {
          kind: 'count',
          passed,
          expected,
          actual: String(actual),
          message: passed ? 'Count matched' : `Expected count ${operator} ${expected}, received ${actual}`,
        };
      }
      case 'http': {
        const status = spec.statusCode ?? Number(expected ?? 500);
        const hits = context.httpFailures.filter((item) => item.status === status);
        const passed = operator === 'absent' ? hits.length === 0 : hits.length > 0;
        return {
          kind: 'http',
          passed,
          expected: status,
          actual: hits.map((item) => `${item.status ?? 'err'} ${item.url}`).join(', ') || 'none',
          message: passed
            ? `HTTP ${status} assertion passed`
            : `Unexpected HTTP ${status} responses: ${hits.map((item) => item.url).join(', ')}`,
        };
      }
      case 'console_error': {
        const passed = operator === 'absent' ? context.consoleErrors.length === 0 : context.consoleErrors.length > 0;
        return {
          kind: 'console_error',
          passed,
          actual: context.consoleErrors.join(' | ') || 'none',
          message: passed ? 'Console error assertion passed' : `Console errors: ${context.consoleErrors.join(' | ')}`,
        };
      }
      case 'page_error': {
        const passed = operator === 'absent' ? context.pageErrors.length === 0 : context.pageErrors.length > 0;
        return {
          kind: 'page_error',
          passed,
          actual: context.pageErrors.join(' | ') || 'none',
          message: passed ? 'Page error assertion passed' : `Page errors: ${context.pageErrors.join(' | ')}`,
        };
      }
      default:
        return { kind: spec.kind, passed: false, actual: '', message: `Unsupported assertion ${spec.kind}` };
    }
  }
}

function defaultOperator(kind: AssertionKind): NonNullable<AssertionSpec['operator']> {
  if (kind === 'http' || kind === 'console_error' || kind === 'page_error') {
    return 'absent';
  }
  if (kind === 'visibility' || kind === 'existence') {
    return 'exists';
  }
  return 'contains';
}

function compare(
  kind: AssertionKind,
  actual: string,
  expected: string | number | boolean | undefined,
  operator: NonNullable<AssertionSpec['operator']>,
): AssertionResult {
  const target = String(expected ?? '');
  let passed = false;
  if (operator === 'equals') {
    passed = actual === target;
  } else if (operator === 'contains') {
    passed = actual.includes(target);
  } else if (operator === 'matches') {
    passed = new RegExp(target).test(actual);
  } else if (operator === 'exists') {
    passed = actual.length > 0;
  } else if (operator === 'absent') {
    passed = !actual.includes(target);
  }
  return {
    kind,
    passed,
    expected,
    actual,
    message: passed ? `${kind} assertion passed` : `Expected ${kind} ${operator} ${target}, received ${actual}`,
  };
}

function numericCompare(actual: number, expected: number, operator: NonNullable<AssertionSpec['operator']>): boolean {
  if (operator === 'gte') {
    return actual >= expected;
  }
  if (operator === 'lte') {
    return actual <= expected;
  }
  if (operator === 'equals') {
    return actual === expected;
  }
  return actual === expected;
}

function boolResult(kind: AssertionKind, actual: boolean, expected: boolean, label: string): AssertionResult {
  return {
    kind,
    passed: actual === expected,
    expected,
    actual: String(actual),
    message: actual === expected ? `${label} matched` : `${label} expected ${expected}, received ${actual}`,
  };
}
