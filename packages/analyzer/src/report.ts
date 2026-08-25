import type { CoverageStats, Finding, FindingCategory, FindingSeverity, RunCost } from '@auditor/shared';

export interface ReportPayload {
  overallScore: number;
  executiveSummary: string;
  counts: Record<FindingSeverity, number>;
  categoryCounts: Partial<Record<FindingCategory, number>>;
  criticalFindings: Array<{ id: string; title: string; severity: FindingSeverity }>;
  highFindings: Array<{ id: string; title: string; severity: FindingSeverity }>;
  mediumFindings: Array<{ id: string; title: string; severity: FindingSeverity }>;
  uxFindings: Array<{ id: string; title: string }>;
  accessibilityFindings: Array<{ id: string; title: string }>;
  testedFlows: string[];
  coverage: CoverageStats;
  recommendations: string[];
  cost: RunCost;
}

export class ReportGenerator {
  build(input: {
    score: number;
    findings: Array<Pick<Finding, 'id' | 'title' | 'severity' | 'category' | 'recommendation'>>;
    coverage: CoverageStats;
    testedFlows: string[];
    cost: RunCost;
    summary?: string;
  }): ReportPayload {
    const counts: Record<FindingSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    const categoryCounts: Partial<Record<FindingCategory, number>> = {};
    for (const finding of input.findings) {
      counts[finding.severity] += 1;
      categoryCounts[finding.category] = (categoryCounts[finding.category] ?? 0) + 1;
    }
    const recommendations = [
      ...new Set(input.findings.map((item) => item.recommendation).filter((item): item is string => Boolean(item))),
    ].slice(0, 8);
    const summary =
      input.summary ??
      `Quality score ${input.score}/100 with ${counts.CRITICAL} critical, ${counts.HIGH} high, and ${counts.MEDIUM} medium findings. ${input.coverage.testedFlows}/${input.coverage.discoveredFlows} discovered flows were tested.`;
    return {
      overallScore: input.score,
      executiveSummary: summary,
      counts,
      categoryCounts,
      criticalFindings: input.findings.filter((item) => item.severity === 'CRITICAL').map(brief),
      highFindings: input.findings.filter((item) => item.severity === 'HIGH').map(brief),
      mediumFindings: input.findings.filter((item) => item.severity === 'MEDIUM').map(brief),
      uxFindings: input.findings.filter((item) => item.category === 'UX').map((item) => ({ id: item.id, title: item.title })),
      accessibilityFindings: input.findings
        .filter((item) => item.category === 'ACCESSIBILITY')
        .map((item) => ({ id: item.id, title: item.title })),
      testedFlows: input.testedFlows,
      coverage: input.coverage,
      recommendations,
      cost: input.cost,
    };
  }
}

function brief(finding: { id: string; title: string; severity: FindingSeverity }): {
  id: string;
  title: string;
  severity: FindingSeverity;
} {
  return { id: finding.id, title: finding.title, severity: finding.severity };
}
