import { failureAnalysisSchema, type FailureAnalysis, type FindingSeverity } from '@auditor/shared';
import { FAILURE_ANALYSIS_PROMPT_VERSION, FAILURE_ANALYSIS_SYSTEM_PROMPT } from './prompts.js';
import type { ModelRouter } from './router.js';

export interface FailureAnalysisInput {
  testName: string;
  category?: string;
  steps: unknown[];
  expected: string[];
  actual: string;
  errorMessage?: string | null;
  url?: string;
  console?: unknown[];
  network?: unknown[];
  httpFailures?: Array<{ status?: number; url: string }>;
  pageErrors?: string[];
  screenshotAvailable?: boolean;
}

function hasStrongEvidence(input: FailureAnalysisInput): boolean {
  const http500 = (input.httpFailures ?? []).some((item) => item.status === 500);
  const crash = (input.pageErrors ?? []).some((item) => /crash|oom|detached/i.test(item));
  const authBroken = /login|sign in|auth/i.test(`${input.testName} ${input.url ?? ''}`) && http500;
  return (http500 && crash) || authBroken;
}

export function clampFailureSeverity(severity: FindingSeverity, input: FailureAnalysisInput): FindingSeverity {
  if (severity === 'CRITICAL' && !hasStrongEvidence(input)) {
    return 'HIGH';
  }
  return severity;
}

export function heuristicFailureAnalysis(input: FailureAnalysisInput): FailureAnalysis {
  const http500 = (input.httpFailures ?? []).find((item) => item.status && item.status >= 500);
  const unexpected400 = (input.httpFailures ?? []).find((item) => item.status === 400);
  const pageError = input.pageErrors?.[0];
  let title = `Test failed: ${input.testName}`;
  const category: FailureAnalysis['category'] = 'BUG';
  let severity: FindingSeverity = 'MEDIUM';
  let rootCauseHypothesis = 'The executed steps did not produce the expected application state.';
  if (http500) {
    title = `Server error while running "${input.testName}"`;
    severity = hasStrongEvidence(input) ? 'CRITICAL' : 'HIGH';
    rootCauseHypothesis = `The application returned HTTP ${http500.status} for ${http500.url}.`;
  } else if (pageError) {
    title = `Uncaught JavaScript error during "${input.testName}"`;
    severity = 'HIGH';
    rootCauseHypothesis = `A page error was observed: ${pageError}`;
  } else if (unexpected400) {
    title = `Unexpected client error during "${input.testName}"`;
    severity = 'MEDIUM';
    rootCauseHypothesis = `HTTP 400 was returned for ${unexpected400.url}.`;
  } else if (/timeout/i.test(input.actual) || /timeout/i.test(input.errorMessage ?? '')) {
    title = `Timeout during "${input.testName}"`;
    severity = 'HIGH';
    rootCauseHypothesis = 'A step exceeded its timeout, which often indicates a missing element or hung navigation.';
  }

  return failureAnalysisSchema.parse({
    title: title.slice(0, 240),
    summary: input.errorMessage || input.actual,
    expected: input.expected.join('; ') || 'The application should complete the flow without errors.',
    actual: input.actual,
    severity: clampFailureSeverity(severity, input),
    category,
    confidence: http500 || pageError ? 0.86 : 0.7,
    rootCauseHypothesis,
    recommendation: http500
      ? 'Inspect the failing endpoint, fix the 5xx handler, and add regression coverage for this flow.'
      : 'Reproduce the steps, confirm the expected UI state, and fix the application or the selector mapping if the control changed.',
  });
}

export class FailureAnalysisAgent {
  constructor(private readonly router: ModelRouter) {}

  async analyze(input: FailureAnalysisInput): Promise<{
    analysis: FailureAnalysis;
    promptVersion: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    estimatedCostUsd: number;
  }> {
    const fallback = heuristicFailureAnalysis(input);
    if (this.router.current().name === 'heuristic') {
      return {
        analysis: fallback,
        promptVersion: FAILURE_ANALYSIS_PROMPT_VERSION,
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
            { role: 'system', content: FAILURE_ANALYSIS_SYSTEM_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                testName: input.testName,
                category: input.category,
                steps: input.steps,
                expected: input.expected,
                actual: input.actual,
                errorMessage: input.errorMessage,
                url: input.url,
                console: input.console,
                network: input.network,
                screenshotAvailable: input.screenshotAvailable,
              }),
            },
          ],
          model: this.router.modelFor('structured'),
          temperature: 0,
          maxTokens: 800,
        },
        failureAnalysisSchema,
      );
      return {
        analysis: {
          ...result.data,
          severity: clampFailureSeverity(result.data.severity, input),
        },
        promptVersion: FAILURE_ANALYSIS_PROMPT_VERSION,
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        latencyMs: result.latencyMs,
        estimatedCostUsd: result.estimatedCostUsd,
      };
    } catch {
      return {
        analysis: fallback,
        promptVersion: FAILURE_ANALYSIS_PROMPT_VERSION,
        model: this.router.current().name,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 0,
        estimatedCostUsd: 0,
      };
    }
  }
}
