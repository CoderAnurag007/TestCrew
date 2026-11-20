import {
  generatedTestSuiteSchema,
  type DiscoveredElement,
  type GeneratedTestCase,
  type SemanticPage,
  type SelectorMeta,
} from '@auditor/shared';
import { TEST_GENERATION_PROMPT_VERSION, TEST_GENERATION_SYSTEM_PROMPT } from './prompts.js';
import type { ModelRouter } from './router.js';

export interface TestGenerationInput {
  flows: Array<{ id: string; name: string; description?: string | null }>;
  states: Array<{ id: string; name: string; url?: string | null; title?: string | null; visited?: boolean }>;
  catalog: DiscoveredElement[];
  semanticPages?: SemanticPage[];
}

export interface TestGenerationAgentResult {
  tests: GeneratedTestCase[];
  promptVersion: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
}

function selectorKey(selectors: SelectorMeta): string {
  return [selectors.primary, selectors.testId, selectors.id, selectors.css].filter(Boolean).join('|');
}

export function isCatalogSelector(selectors: SelectorMeta, catalog: DiscoveredElement[]): boolean {
  const allowed = new Set(catalog.map((item) => selectorKey(item.selectors)));
  const primaryAllowed = new Set(catalog.map((item) => item.selectors.primary));
  return allowed.has(selectorKey(selectors)) || primaryAllowed.has(selectors.primary);
}

export function filterInventedSelectors(tests: GeneratedTestCase[], catalog: DiscoveredElement[]): GeneratedTestCase[] {
  return tests.filter((test) =>
    test.steps.every((step) => {
      if (!step.selectors) {
        return step.type === 'navigate' || step.type === 'wait' || step.type === 'assert';
      }
      return isCatalogSelector(step.selectors, catalog);
    }),
  );
}

export class TestGenerationAgent {
  constructor(private readonly router: ModelRouter) {}

  async generate(input: TestGenerationInput): Promise<TestGenerationAgentResult> {
    if (this.router.current().name === 'heuristic' || input.catalog.length === 0) {
      return {
        tests: [],
        promptVersion: TEST_GENERATION_PROMPT_VERSION,
        model: 'heuristic',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 0,
        estimatedCostUsd: 0,
      };
    }

    const started = Date.now();
    try {
      const result = await this.router.generateStructured(
        {
          messages: [
            { role: 'system', content: TEST_GENERATION_SYSTEM_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                flows: input.flows,
                states: input.states.map((state) => ({
                  id: state.id,
                  name: state.name,
                  url: state.url,
                  title: state.title,
                  visited: state.visited,
                })),
                catalog: input.catalog.map((element) => ({
                  id: element.id,
                  url: element.url,
                  type: element.type,
                  label: element.label,
                  href: element.href,
                  category: element.category,
                  selectors: element.selectors,
                })),
              }),
            },
          ],
          model: this.router.modelFor('structured'),
          temperature: 0,
          maxTokens: 4000,
        },
        generatedTestSuiteSchema,
      );
      return {
        tests: filterInventedSelectors(result.data.tests, input.catalog),
        promptVersion: TEST_GENERATION_PROMPT_VERSION,
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        latencyMs: result.latencyMs || Date.now() - started,
        estimatedCostUsd: result.estimatedCostUsd,
      };
    } catch {
      return {
        tests: [],
        promptVersion: TEST_GENERATION_PROMPT_VERSION,
        model: `${this.router.current().name}:failed`,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - started,
        estimatedCostUsd: 0,
      };
    }
  }
}
