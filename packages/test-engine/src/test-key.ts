import { createHash } from 'node:crypto';
import type { GeneratedTestCase } from '@auditor/shared';

/**
 * Stable identity for a generated test across runs, used for flake history and
 * quarantine. Built from what the test does, not from database ids, so the same
 * scenario on the same screen maps to the same key every run.
 */
export function testKeyFor(test: Pick<GeneratedTestCase, 'name' | 'category' | 'flowName' | 'source' | 'intentId' | 'steps'>): string {
  const shape = test.steps
    .map((step) => [step.type, step.selectors?.primary ?? '', step.assertion?.kind ?? '', pathOnly(step.href)].join(':'))
    .join('>');
  const identity = [test.source ?? 'generated', test.intentId ?? '', test.category, normalize(test.name), normalize(test.flowName ?? ''), shape].join('|');
  return createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[0-9a-f]{6,}/g, '#').replace(/\s+/g, ' ').trim();
}

function pathOnly(href?: string | null): string {
  if (!href) return '';
  try {
    return new URL(href).pathname;
  } catch {
    return href;
  }
}
