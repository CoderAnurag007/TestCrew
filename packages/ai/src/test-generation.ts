import { describeAiError } from './errors.js';
import { z } from 'zod';
import {
  assertionKindSchema,
  assertionOperatorSchema,
  generatedTestCaseSchema,
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
  /** Why the AI call failed, when it did. */
  error?: string;
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

const MAX_CATALOG = 160;

/** The shape the AI returns: steps name elements by ref instead of copying selectors. */
const aiAssertionSchema = z
  .object({
    kind: assertionKindSchema,
    operator: assertionOperatorSchema.optional(),
    expected: z.union([z.string(), z.number(), z.boolean()]).optional(),
    element: z.string().optional(),
    statusCode: z.number().int().optional(),
  })
  .passthrough();
const aiStepSchema = z
  .object({
    id: z.string().optional(),
    type: z.string(),
    description: z.string().optional(),
    element: z.string().optional(),
    href: z.string().nullable().optional(),
    value: z.union([z.string(), z.number()]).optional(),
    assertion: aiAssertionSchema.optional(),
  })
  .passthrough();
const aiTestSuiteSchema = z.object({
  tests: z.array(z.object({ steps: z.array(aiStepSchema) }).passthrough()),
});

function elementAt(ref: string | undefined, catalog: DiscoveredElement[]): DiscoveredElement | undefined {
  const match = /^e(\d+)$/.exec(ref?.trim() ?? '');
  return match ? catalog[Number(match[1])] : undefined;
}

/** Turns the AI's ref-based tests into real ones; drops any test that still doesn't fit. */
export function hydrateTests(tests: Array<z.infer<typeof aiTestSuiteSchema>['tests'][number]>, catalog: DiscoveredElement[]): GeneratedTestCase[] {
  const out: GeneratedTestCase[] = [];
  for (const raw of tests) {
    let broken = false;
    const steps = raw.steps.map((step, index) => {
      const element = elementAt(step.element, catalog);
      if (step.element && !element) broken = true;
      const assertElement = elementAt(step.assertion?.element, catalog);
      if (step.assertion?.element && !assertElement) broken = true;
      const { element: _ref, ...assertionRest } = step.assertion ?? ({} as Record<string, unknown>);
      return {
        id: step.id || `s${index + 1}`,
        type: step.type,
        description: step.description || `${step.type} step`,
        ...(element ? { selectors: element.selectors, discoveredElementId: element.id } : {}),
        ...(step.href ? { href: step.href } : step.type === 'navigate' && element?.href ? { href: element.href } : {}),
        ...(step.value != null ? { value: String(step.value) } : {}),
        ...(step.assertion ? { assertion: { ...assertionRest, ...(assertElement ? { selectors: assertElement.selectors } : {}) } } : {}),
      };
    });
    if (broken) continue;
    const parsed = generatedTestCaseSchema.safeParse({ ...raw, steps, source: 'ai' });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
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
    // Element ids repeat across pages, so the AI refers to elements by their
    // position ("e12") and the exact selectors are filled in from the catalog.
    const catalog = input.catalog.slice(0, MAX_CATALOG);
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
                catalog: catalog.map((element, index) => ({
                  ref: `e${index}`,
                  url: element.url,
                  type: element.type,
                  label: element.label,
                  href: element.href,
                  category: element.category,
                  inputType: element.inputType,
                })),
              }),
            },
          ],
          model: this.router.modelFor('structured'),
          temperature: 0,
          maxTokens: 4000,
        },
        aiTestSuiteSchema,
      );
      return {
        tests: filterInventedSelectors(hydrateTests(result.data.tests, catalog), input.catalog),
        promptVersion: TEST_GENERATION_PROMPT_VERSION,
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        latencyMs: result.latencyMs || Date.now() - started,
        estimatedCostUsd: result.estimatedCostUsd,
      };
    } catch (error) {
      return {
        tests: [],
        promptVersion: TEST_GENERATION_PROMPT_VERSION,
        model: `${this.router.current().name}:failed`,
        error: describeAiError(error),
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - started,
        estimatedCostUsd: 0,
      };
    }
  }
}
