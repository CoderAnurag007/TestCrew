import { describe, expect, it } from 'vitest';
import { DuplicateDetector, findingSignature, normalizeTitle } from '../src/duplicates.js';
import { SeverityClassifier } from '../src/severity.js';
import { calculateQualityScore } from '../src/scoring.js';

describe('severity classification', () => {
  const classifier = new SeverityClassifier();

  it('does not mark a lone HTTP 500 as critical', () => {
    expect(classifier.classify([{ kind: 'http_500', message: '500 /reports' }])).toBe('HIGH');
  });

  it('requires corroborating strong evidence for critical', () => {
    expect(
      classifier.classify([
        { kind: 'http_500', message: '500 /login', authPath: true },
        { kind: 'page_crash', message: 'crash', authPath: true },
      ]),
    ).toBe('CRITICAL');
  });
});

describe('duplicate detection', () => {
  it('merges findings with the same signature or similar titles on the same URL', () => {
    const detector = new DuplicateDetector();
    const left = {
      title: 'Server error while running Navigate to Reports',
      url: 'http://127.0.0.1/reports',
      category: 'BUG',
      error: 'HTTP 500',
    };
    const right = {
      title: 'Server error while running navigate to reports',
      url: 'http://127.0.0.1/reports',
      category: 'BUG',
      error: 'HTTP 500',
    };
    expect(normalizeTitle(left.title)).toBe(normalizeTitle(right.title));
    expect(findingSignature(left)).toBe(findingSignature(right));
    expect(detector.isDuplicate(left, right)).toBe(true);
    expect(detector.merge([left, right])).toHaveLength(1);
  });
});

describe('quality score', () => {
  const coverage = { discoveredFlows: 4, testedFlows: 3, successfulFlows: 2, failedFlows: 1, untestedFlows: 1 };
  void coverage;

  it('is deterministic and ignores LLM-chosen values', () => {
    const input = {
      findings: [
        { severity: 'HIGH' as const, category: 'BUG' as const, confidence: 0.8 },
        { severity: 'MEDIUM' as const, category: 'ACCESSIBILITY' as const, confidence: 0.7 },
      ],
      screensExplored: 6,
    };
    const first = calculateQualityScore(input);
    expect(calculateQualityScore(input)).toBe(first);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(100);
  });

  it('is normalized by app size: the same defect rate gives the same score', () => {
    const small = calculateQualityScore({ findings: [{ severity: 'HIGH', category: 'BUG', confidence: 1 }], screensExplored: 5 });
    const large = calculateQualityScore({
      findings: Array.from({ length: 10 }, () => ({ severity: 'HIGH' as const, category: 'BUG' as const, confidence: 1 })),
      screensExplored: 50,
    });
    expect(large).toBe(small);
  });

  it('is 100 with no findings and never negative', () => {
    expect(calculateQualityScore({ findings: [], screensExplored: 10 })).toBe(100);
    const many = Array.from({ length: 200 }, () => ({ severity: 'CRITICAL' as const, category: 'BUG' as const, confidence: 1 }));
    expect(calculateQualityScore({ findings: many, screensExplored: 1 })).toBeGreaterThanOrEqual(0);
  });

  it('ignores suppressed findings and weights by confidence', () => {
    const base = calculateQualityScore({ findings: [{ severity: 'HIGH', category: 'BUG', confidence: 0.9 }], screensExplored: 4 });
    const withSuppressed = calculateQualityScore({
      findings: [
        { severity: 'HIGH', category: 'BUG', confidence: 0.9 },
        { severity: 'CRITICAL', category: 'BUG', confidence: 0.9, suppressed: true },
      ],
      screensExplored: 4,
    });
    expect(withSuppressed).toBe(base);
    const unsure = calculateQualityScore({ findings: [{ severity: 'HIGH', category: 'BUG', confidence: 0.3 }], screensExplored: 4 });
    expect(unsure).toBeGreaterThan(base);
  });
});

describe('run diff', () => {
  it('labels new, recurring, regressed and fixed findings', async () => {
    const { diffRuns } = await import('../src/diff.js');
    const f = (signature: string) => ({ signature, title: signature, severity: 'HIGH' as const, category: 'BUG' });
    const diff = diffRuns({
      current: [f('a'), f('b'), f('c')],
      previous: [f('a'), f('d')],
      previousRunId: 'run-1',
      olderSignatures: ['c', 'd'],
    });
    expect(diff.changes.get('a')).toBe('RECURRING');
    expect(diff.changes.get('b')).toBe('NEW');
    expect(diff.changes.get('c')).toBe('REGRESSED');
    expect(diff.fixed.map((item) => item.signature)).toEqual(['d']);
  });
});
