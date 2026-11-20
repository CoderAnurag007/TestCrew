import type { CoverageStats, FindingCategory, FindingSeverity } from '@auditor/shared';

/**
 * Health score, 0-100.
 *
 * Each distinct root cause (findings are de-duplicated before scoring) costs
 * points by severity, scaled by how confident we are in it. The total is
 * divided by the number of screens explored, so a large app with the same
 * defect rate scores the same as a small one. The result goes through an
 * exponential curve so the score never goes negative and the first serious
 * bugs move it the most.
 *
 * Failed tests are not counted separately: a failing test that reveals a bug
 * already produced a finding, and counting both would charge the same defect
 * twice. Coverage is reported next to the score, not mixed into it.
 */
export const SEVERITY_WEIGHTS: Record<FindingSeverity, number> = {
  CRITICAL: 10,
  HIGH: 5,
  MEDIUM: 2,
  LOW: 0.5,
  INFO: 0,
};

/** Screens below this count are treated as this many, so a 1-page app is not crushed by one finding. */
const MIN_SCREENS = 3;
/** Density at which the score falls to about 37 (1/e). */
const DENSITY_SCALE = 4;

export interface ScoreInput {
  findings: Array<{ severity: FindingSeverity; category: FindingCategory; confidence?: number | null; suppressed?: boolean }>;
  screensExplored: number;
}

export interface ScoreBreakdown {
  score: number;
  /** Weighted defects per explored screen. */
  density: number;
  screensExplored: number;
  /** Points lost per category, before the curve. */
  weightByCategory: Partial<Record<FindingCategory, number>>;
  counted: number;
  formula: string;
}

export function scoreBreakdown(input: ScoreInput): ScoreBreakdown {
  const screens = Math.max(MIN_SCREENS, input.screensExplored);
  let total = 0;
  let counted = 0;
  const weightByCategory: Partial<Record<FindingCategory, number>> = {};
  for (const finding of input.findings) {
    if (finding.suppressed) continue;
    const confidence = clamp(finding.confidence ?? 0.7, 0.2, 1);
    const weight = SEVERITY_WEIGHTS[finding.severity] * confidence;
    if (weight <= 0) continue;
    counted += 1;
    total += weight;
    weightByCategory[finding.category] = round(((weightByCategory[finding.category] ?? 0) + weight), 2);
  }
  const density = total / screens;
  const score = round(100 * Math.exp(-density / DENSITY_SCALE), 1);
  return {
    score,
    density: round(density, 3),
    screensExplored: input.screensExplored,
    weightByCategory,
    counted,
    formula: `score = 100 * exp(-(sum of severity x confidence) / max(${MIN_SCREENS}, screens) / ${DENSITY_SCALE})`,
  };
}

export function calculateQualityScore(input: ScoreInput): number {
  return scoreBreakdown(input).score;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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
