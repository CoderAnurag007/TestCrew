import { z } from 'zod';
import {
  generatedTestCaseSchema,
  type DiscoveredElement,
  type GeneratedTestCase,
  type Intent,
  type SelectorMeta,
  type SemanticPage,
} from '@auditor/shared';
import { INTENT_COMPILER_PROMPT_VERSION, INTENT_COMPILER_SYSTEM_PROMPT } from './prompts.js';
import type { ModelRouter } from './router.js';

/**
 * Turns plain-English expectations ("adding an item increases the cart count by
 * one") into executable tests. The model may only use selectors from the
 * discovered catalog; anything it invents is rejected and the intent is
 * reported as not compiled, with the reason, instead of being guessed.
 */
export interface CompiledIntent {
  intentId: string;
  text: string;
  status: 'compiled' | 'not_compiled' | 'rejected';
  reason?: string;
  test?: GeneratedTestCase;
}

export interface IntentCompilerResult {
  intents: CompiledIntent[];
  promptVersion: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
}

const compiledSchema = z.object({
  results: z.array(
    z.object({
      intentId: z.string(),
      compiled: z.boolean(),
      reason: z.string().optional(),
      test: z.unknown().optional(),
    }),
  ),
});

export class IntentCompiler {
  constructor(private readonly router: ModelRouter) {}

  async compile(input: {
    intents: Intent[];
    catalog: DiscoveredElement[];
    pages: SemanticPage[];
    baseUrl: string;
  }): Promise<IntentCompilerResult> {
    const active = input.intents.filter((intent) => intent.enabled !== false);
    const base: Omit<IntentCompilerResult, 'intents'> = {
      promptVersion: INTENT_COMPILER_PROMPT_VERSION,
      model: this.router.current().name,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 0,
      estimatedCostUsd: 0,
    };
    if (active.length === 0) {
      return { ...base, intents: [] };
    }
    if (this.router.current().name === 'heuristic') {
      return {
        ...base,
        intents: active.map((intent) => ({
          intentId: intent.id,
          text: intent.text,
          status: 'not_compiled',
          reason: 'No AI provider is configured, so plain-English intents cannot be turned into tests.',
        })),
      };
    }

    const started = Date.now();
    const catalog = input.catalog.slice(0, 400);
    try {
      const result = await this.router.generateStructured(
        {
          messages: [
            { role: 'system', content: INTENT_COMPILER_SYSTEM_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                baseUrl: input.baseUrl,
                intents: active.map((intent) => ({ id: intent.id, text: intent.text })),
                pages: input.pages.slice(0, 40).map((page) => ({
                  url: page.url,
                  title: page.title,
                  headings: page.importantText.slice(0, 6),
                  listItems: (page.listItems ?? []).slice(0, 8),
                })),
                catalog: catalog.map((element) => ({
                  elementId: element.id,
                  url: element.url,
                  type: element.type,
                  label: element.label,
                  href: element.href,
                  inputType: element.inputType,
                  selectors: element.selectors,
                })),
              }),
            },
          ],
          model: this.router.modelFor('structured'),
          temperature: 0,
          maxTokens: 6000,
        },
        compiledSchema,
      );
      const byId = new Map(result.data.results.map((item) => [item.intentId, item]));
      const intents = active.map((intent): CompiledIntent => {
        const item = byId.get(intent.id);
        if (!item) {
          return { intentId: intent.id, text: intent.text, status: 'not_compiled', reason: 'The model returned no result for this intent.' };
        }
        if (!item.compiled || !item.test) {
          return {
            intentId: intent.id,
            text: intent.text,
            status: 'not_compiled',
            reason: item.reason ?? 'The discovered screens do not contain the controls this intent needs.',
          };
        }
        const parsed = generatedTestCaseSchema.safeParse({
          ...(item.test as Record<string, unknown>),
          source: 'intent',
          intentId: intent.id,
        });
        if (!parsed.success) {
          return { intentId: intent.id, text: intent.text, status: 'rejected', reason: `Invalid test shape: ${parsed.error.issues[0]?.message ?? 'unknown'}` };
        }
        const problem = validateAgainstCatalog(parsed.data, catalog, input.baseUrl);
        if (problem) {
          return { intentId: intent.id, text: intent.text, status: 'rejected', reason: problem };
        }
        return { intentId: intent.id, text: intent.text, status: 'compiled', test: normalize(parsed.data, catalog, intent) };
      });
      return {
        ...base,
        intents,
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        latencyMs: result.latencyMs || Date.now() - started,
        estimatedCostUsd: result.estimatedCostUsd,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI request failed';
      return {
        ...base,
        latencyMs: Date.now() - started,
        intents: active.map((intent) => ({
          intentId: intent.id,
          text: intent.text,
          status: 'not_compiled',
          reason: `Intent compilation failed: ${message.slice(0, 200)}`,
        })),
      };
    }
  }
}

/** Returns a reason when the test uses anything that was not discovered. */
export function validateAgainstCatalog(test: GeneratedTestCase, catalog: DiscoveredElement[], baseUrl: string): string | null {
  const known = new Set(catalog.map((item) => item.selectors.primary));
  const origin = safeOrigin(baseUrl);
  for (const step of test.steps) {
    for (const selectors of [step.selectors, step.assertion?.selectors]) {
      if (selectors && !known.has(selectors.primary)) {
        return `Step "${step.description}" uses a selector that was not discovered: ${selectors.primary}`;
      }
    }
    if (['click', 'type', 'select', 'upload'].includes(step.type) && !step.selectors) {
      return `Step "${step.description}" has no discovered selector`;
    }
    if (step.type === 'assert' && !step.assertion) {
      return `Assert step "${step.description}" has no assertion`;
    }
    if (step.type === 'assert' && step.assertion && ['element_text', 'value', 'attribute', 'visibility', 'existence', 'count'].includes(step.assertion.kind) && !step.assertion.selectors && !step.selectors) {
      return `Assertion "${step.description}" needs a discovered element`;
    }
    if (step.type === 'navigate') {
      const href = step.href ?? step.value;
      if (!href || safeOrigin(resolveUrl(href, baseUrl)) !== origin) {
        return `Step "${step.description}" navigates outside the application`;
      }
    }
  }
  if (!test.steps.some((step) => step.type === 'assert')) {
    return 'The test has no assertion, so it cannot check the intent';
  }
  return null;
}

/** Copy full selector metadata from the catalog so locators match what was discovered exactly. */
function normalize(test: GeneratedTestCase, catalog: DiscoveredElement[], intent: Intent): GeneratedTestCase {
  const byPrimary = new Map<string, SelectorMeta>(catalog.map((item) => [item.selectors.primary, item.selectors]));
  return {
    ...test,
    source: 'intent',
    intentId: intent.id,
    flowName: test.flowName ?? 'Intents',
    steps: test.steps.map((step) => ({
      ...step,
      ...(step.selectors ? { selectors: byPrimary.get(step.selectors.primary) ?? step.selectors } : {}),
      ...(step.assertion?.selectors
        ? { assertion: { ...step.assertion, selectors: byPrimary.get(step.assertion.selectors.primary) ?? step.assertion.selectors } }
        : {}),
    })),
  };
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return '';
  }
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
