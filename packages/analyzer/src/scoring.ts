import {
  DEFAULT_QUALITY_SCORE_WEIGHTS,
  type CoverageStats,
  type FindingCategory,
  type FindingSeverity,
  type QualityScoreWeights,
} from '@auditor/shared';

export interface ScoreInput {
  findings: Array<{ severity: FindingSeverity; category: FindingCategory }>;
  testsPassed: number;
  testsFailed: number;
  coverage: CoverageStats;
  weights?: QualityScoreWeights;
}

export function calculateQualityScore(input: ScoreInput): number {
  const weights = { ...DEFAULT_QUALITY_SCORE_WEIGHTS, ...input.weights };
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  let ux = 0;
  let a11y = 0;
  let visual = 0;
  for (const finding of input.findings) {
    counts[finding.severity] += 1;
    if (finding.category === 'UX') {
      ux += 1;
    }
    if (finding.category === 'ACCESSIBILITY') {
      a11y += 1;
    }
    if (finding.category === 'VISUAL') {
      visual += 1;
    }
  }

  let score = 100;
  score -= counts.CRITICAL * weights.critical;
  score -= counts.HIGH * weights.high;
  score -= counts.MEDIUM * weights.medium;
  score -= counts.LOW * weights.low;
  score -= counts.INFO * weights.info;
  score -= input.testsFailed * weights.failedTest;
  score -= ux * weights.uxIssue;
  score -= a11y * weights.accessibilityIssue;
  score -= visual * weights.visualIssue;

  const discovered = Math.max(1, input.coverage.discoveredFlows);
  const coverageRatio = input.coverage.testedFlows / discovered;
  const totalTests = input.testsPassed + input.testsFailed;
  const successRatio = totalTests === 0 ? 0 : input.testsPassed / totalTests;
  score += coverageRatio * weights.coverageBoost;
  score += successRatio * weights.successBoost;

  return Number(Math.min(100, Math.max(0, score)).toFixed(1));
}

export function coverageFrom(input: {
  discoveredFlows: number;
  testedFlowNames: string[];
  successfulFlowNames: string[];
  failedFlowNames: string[];
}): CoverageStats {
  const discoveredFlows = input.discoveredFlows;
  const testedFlows = new Set(input.testedFlowNames).size;
  const successfulFlows = new Set(input.successfulFlowNames).size;
  const failedFlows = new Set(input.failedFlowNames).size;
  return {
    discoveredFlows,
    testedFlows,
    successfulFlows,
    failedFlows,
    untestedFlows: Math.max(0, discoveredFlows - testedFlows),
  };
}
