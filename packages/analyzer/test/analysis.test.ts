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
  it('is deterministic and ignores LLM-chosen values', () => {
    const first = calculateQualityScore({
      findings: [
        { severity: 'HIGH', category: 'BUG' },
        { severity: 'MEDIUM', category: 'ACCESSIBILITY' },
      ],
      testsPassed: 4,
      testsFailed: 1,
      coverage: { discoveredFlows: 4, testedFlows: 3, successfulFlows: 2, failedFlows: 1, untestedFlows: 1 },
    });
    const second = calculateQualityScore({
      findings: [
        { severity: 'HIGH', category: 'BUG' },
        { severity: 'MEDIUM', category: 'ACCESSIBILITY' },
      ],
      testsPassed: 4,
      testsFailed: 1,
      coverage: { discoveredFlows: 4, testedFlows: 3, successfulFlows: 2, failedFlows: 1, untestedFlows: 1 },
    });
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(100);
  });
});
