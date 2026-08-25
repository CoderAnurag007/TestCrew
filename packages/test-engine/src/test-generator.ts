import { filterInventedSelectors, type TestGenerationAgent } from '@auditor/ai';
import {
  generatedTestCaseSchema,
  type DiscoveredElement,
  type GeneratedTestCase,
  type SemanticPage,
} from '@auditor/shared';
import { RiskAnalyzer } from './risk-analyzer.js';
import { ScenarioGenerator } from './scenario-generator.js';
import { TestPlanner } from './test-planner.js';

export class TestGenerator {
  constructor(
    private readonly planner = new TestPlanner(),
    private readonly scenarios = new ScenarioGenerator(),
    private readonly risk = new RiskAnalyzer(),
    private readonly agent?: TestGenerationAgent,
  ) {}

  async generate(input: {
    catalog: DiscoveredElement[];
    flows: Array<{ id: string; name: string; description?: string | null }>;
    states: Array<{ id: string; name: string; url?: string | null; title?: string | null; visited?: boolean }>;
    semanticPages?: SemanticPage[];
    baseUrl: string;
    allowDestructive?: boolean;
  }): Promise<{
    tests: GeneratedTestCase[];
    promptVersion?: string;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
    estimatedCostUsd?: number;
  }> {
    const plan = this.planner.plan({
      catalog: input.catalog,
      flows: input.flows,
      states: input.states,
      allowDestructive: input.allowDestructive,
    });
    const deterministic = this.scenarios.generate({
      scenarios: plan,
      catalog: input.catalog,
      baseUrl: input.baseUrl,
    });

    let extras: GeneratedTestCase[] = [];
    let usage: {
      promptVersion?: string;
      model?: string;
      promptTokens?: number;
      completionTokens?: number;
      latencyMs?: number;
      estimatedCostUsd?: number;
    } = {};
    if (this.agent) {
      const generated = await this.agent.generate({
        catalog: input.catalog,
        flows: input.flows,
        states: input.states,
        semanticPages: input.semanticPages,
      });
      extras = filterInventedSelectors(generated.tests, input.catalog).map((test) => generatedTestCaseSchema.parse(test));
      usage = generated;
    }

    const merged = [...deterministic, ...extras]
      .filter((test) => !this.risk.shouldSkip(test, input.allowDestructive ?? false))
      .filter((test) => this.validate(test, input.catalog).ok);

    const unique = uniqueTests([smokeTest(input.baseUrl), ...merged]).slice(0, 20);
    return {
      tests: unique,
      promptVersion: usage.promptVersion,
      model: usage.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      latencyMs: usage.latencyMs,
      estimatedCostUsd: usage.estimatedCostUsd,
    };
  }

  validate(test: GeneratedTestCase, catalog: DiscoveredElement[]): { ok: boolean; reason?: string } {
    try {
      generatedTestCaseSchema.parse(test);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'Invalid test case' };
    }
    if (test.steps.length === 0) {
      return { ok: false, reason: 'Test has no steps' };
    }
    for (const step of test.steps) {
      if (step.selectors && !catalog.some((item) => item.selectors.primary === step.selectors?.primary)) {
        return { ok: false, reason: `Invented selector ${step.selectors.primary}` };
      }
      if ((step.type === 'click' || step.type === 'type' || step.type === 'select' || step.type === 'upload') && !step.selectors) {
        return { ok: false, reason: `Step ${step.type} is missing a discovered selector` };
      }
    }
    return { ok: true };
  }
}

function smokeTest(baseUrl: string): GeneratedTestCase {
  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {
    host = baseUrl;
  }
  return generatedTestCaseSchema.parse({
    name: 'Open the application origin',
    description: 'The discovered application origin should load without inventing UI selectors.',
    category: 'HAPPY_PATH',
    priority: 'HIGH',
    risk: 'SAFE',
    preconditions: ['Application URL is reachable'],
    requiresAuth: false,
    flowName: 'Root',
    steps: [
      {
        id: 'smoke-nav',
        type: 'navigate',
        description: 'Open the application origin',
        href: baseUrl,
        value: baseUrl,
      },
      {
        id: 'smoke-assert',
        type: 'assert',
        description: 'The browser should remain on the application origin',
        assertion: { kind: 'url', operator: 'contains', expected: host },
      },
    ],
    expectedResults: ['The application origin loads'],
  });
}

function uniqueTests(tests: GeneratedTestCase[]): GeneratedTestCase[] {
  const seen = new Set<string>();
  const out: GeneratedTestCase[] = [];
  for (const test of tests) {
    const key = `${test.category}:${test.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(test);
  }
  return out;
}
