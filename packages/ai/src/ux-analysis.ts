import { uxAnalysisSchema, type UxAnalysis, type UxFindingDraft } from '@auditor/shared';
import { UX_ANALYSIS_PROMPT_VERSION, UX_ANALYSIS_SYSTEM_PROMPT } from './prompts.js';
import type { ModelRouter } from './router.js';

export interface UxAnalysisInput {
  pages: Array<{
    url: string;
    title?: string | null;
    text?: string[];
    hasForm?: boolean;
    hasTable?: boolean;
    rowCount?: number;
    errorText?: string[];
  }>;
  failedTests?: string[];
}

export function heuristicUxFindings(input: UxAnalysisInput): UxFindingDraft[] {
  const findings: UxFindingDraft[] = [];
  for (const page of input.pages) {
    for (const errorText of page.errorText ?? []) {
      if (/nope|invalid|error|failed/i.test(errorText) && errorText.trim().split(/\s+/).length <= 3) {
        findings.push({
          title: 'Unclear error message',
          description: `The page at ${page.url} shows a terse error ("${errorText}") that does not explain how to recover.`,
          recommendation: 'Replace terse failures with an actionable message that names the field and the next step.',
          confidence: 0.78,
          evidence: [page.url, errorText],
          url: page.url,
          component: 'error-message',
        });
      }
    }
    if (page.hasTable && (page.rowCount ?? 0) === 0 && !(page.text ?? []).some((item) => /no users|empty|nothing to show/i.test(item))) {
      findings.push({
        title: 'Missing empty state',
        description: `A table on ${page.url} rendered zero rows without an empty-state explanation.`,
        recommendation: 'Show an empty state with guidance when a list or search returns no results.',
        confidence: 0.74,
        evidence: [page.url],
        url: page.url,
        component: 'table',
      });
    }
  }
  return findings;
}

export class UXAnalysisAgent {
  constructor(private readonly router: ModelRouter) {}

  async analyze(input: UxAnalysisInput): Promise<{
    analysis: UxAnalysis;
    promptVersion: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    estimatedCostUsd: number;
  }> {
    const heuristic = { findings: heuristicUxFindings(input) };
    if (this.router.current().name === 'heuristic') {
      return {
        analysis: heuristic,
        promptVersion: UX_ANALYSIS_PROMPT_VERSION,
        model: 'heuristic',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 0,
        estimatedCostUsd: 0,
      };
    }

    try {
      const result = await this.router.generateStructured(
        {
          messages: [
            { role: 'system', content: UX_ANALYSIS_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(input) },
          ],
          model: this.router.modelFor('structured'),
          temperature: 0,
          maxTokens: 1200,
        },
        uxAnalysisSchema,
      );
      const merged = [...heuristic.findings];
      for (const finding of result.data.findings) {
        if (finding.evidence.length === 0 || finding.confidence < 0.4) {
          continue;
        }
        merged.push(finding);
      }
      return {
        analysis: { findings: merged },
        promptVersion: UX_ANALYSIS_PROMPT_VERSION,
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        latencyMs: result.latencyMs,
        estimatedCostUsd: result.estimatedCostUsd,
      };
    } catch {
      return {
        analysis: heuristic,
        promptVersion: UX_ANALYSIS_PROMPT_VERSION,
        model: `${this.router.current().name}:failed`,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 0,
        estimatedCostUsd: 0,
      };
    }
  }
}
