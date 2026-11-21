import type { z } from 'zod';
import { estimateCostUsd } from './cost.js';
import type { AIProvider, StructuredGenerationRequest, StructuredGenerationResult } from './provider.js';
import type { AiCompletion, AiCompletionRequest, ImageAnalysisRequest } from './types.js';
import { fetchWithRetry } from './retry.js';

export function parseJsonContent(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  return JSON.parse(trimmed);
}

/** Tried in order when the main model is busy; Google's models get overloaded independently. */
export const DEFAULT_FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const BUSY_COOLDOWN_MS = 10 * 60_000;
/** Models that were overloaded recently, shared by every provider in this process. */
const busyUntil = new Map<string, number>();

function tryParse<T>(content: string, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; problem: string } {
  let json: unknown;
  try {
    json = parseJsonContent(content);
  } catch {
    return { ok: false, problem: 'it is not valid JSON' };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    problem: result.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; '),
  };
}

function structuredResult<T>(data: T, last: AiCompletion, earlier: AiCompletion[]): StructuredGenerationResult<T> {
  const all = [...earlier, last];
  const sum = (pick: (item: AiCompletion) => number | undefined) => all.reduce((total, item) => total + (pick(item) ?? 0), 0);
  return {
    data,
    content: last.content,
    model: last.model,
    promptTokens: sum((item) => item.promptTokens),
    completionTokens: sum((item) => item.completionTokens),
    latencyMs: sum((item) => item.latencyMs),
    estimatedCostUsd: Number(sum((item) => item.estimatedCostUsd).toFixed(6)),
  };
}

class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GeminiHttpError';
  }
}

/** Overloaded, rate-limited or too slow: worth trying the fallback model. */
function isBusyError(error: unknown): boolean {
  if (error instanceof GeminiHttpError) return error.status === 429 || error.status >= 500;
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      baseUrl?: string;
      visionModel?: string;
      /**
       * Used when the main model is overloaded (429/5xx) or too slow. Google's
       * Flash models regularly return "high demand" while Lite answers in seconds;
       * without this, every busy moment silently turned an audit into a rules-only one.
       */
      fallbackModels?: string[];
    },
  ) {}

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    return this.generate(request, true);
  }

  async generateText(request: AiCompletionRequest): Promise<AiCompletion> {
    return this.generate(request, false);
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest,
    schema: z.ZodType<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const first = await this.generate(request, true);
    const parsed = tryParse(first.content, schema);
    if (parsed.ok) return structuredResult(parsed.data, first, []);
    // Smaller models sometimes return almost-right JSON. Show them exactly what was
    // wrong and ask once for a corrected answer before giving up.
    const repaired = await this.generate(
      {
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: first.content.slice(0, 12_000) },
          {
            role: 'user',
            content: `That JSON does not match the required format: ${parsed.problem}. Reply with only the corrected JSON, using exactly the field names and types the instructions ask for.`,
          },
        ],
      },
      true,
    );
    const second = tryParse(repaired.content, schema);
    if (!second.ok) throw new Error(`The AI answer did not match the expected format, even after a correction: ${second.problem}`);
    return structuredResult(second.data, repaired, [first]);
  }

  async analyzeImage(request: ImageAnalysisRequest): Promise<AiCompletion> {
    const model = request.model ?? this.options.visionModel ?? this.options.model;
    return this.request(model, {
      system: undefined,
      contents: [
        {
          role: 'user',
          parts: [
            { text: request.prompt },
            {
              inlineData: {
                mimeType: request.mimeType ?? 'image/png',
                data: request.imageBase64,
              },
            },
            ...(request.extraImages ?? []).map((image) => ({
              inlineData: { mimeType: image.mimeType ?? 'image/png', data: image.imageBase64 },
            })),
          ],
        },
      ],
      json: request.json ?? false,
      temperature: 0,
      maxTokens: request.maxTokens ?? 800,
      timeoutMs: request.timeoutMs,
    });
  }

  private async generate(request: AiCompletionRequest, json: boolean): Promise<AiCompletion> {
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const contents = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));
    return this.request(request.model ?? this.options.model, {
      system: system || undefined,
      contents,
      json,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      timeoutMs: request.timeoutMs,
      retries: request.retries,
    });
  }

  private async request(
    model: string,
    input: {
      system?: string;
      contents: Array<{ role: string; parts: unknown[] }>;
      json: boolean;
      temperature?: number;
      maxTokens?: number;
      timeoutMs?: number;
      retries?: number;
    },
  ): Promise<AiCompletion> {
    const fallbacks = (this.options.fallbackModels ?? DEFAULT_FALLBACK_MODELS).filter((item) => item && item !== model);
    // A model that was busy a moment ago is skipped for a while, so an audit
    // doesn't wait for the same timeout on every call.
    const ready = [model, ...fallbacks].filter((item) => (busyUntil.get(item) ?? 0) <= Date.now());
    const order = ready.length ? ready : [model, ...fallbacks];
    let lastError: unknown;
    for (const [index, candidate] of order.entries()) {
      const last = index === order.length - 1;
      try {
        return await this.requestOnce(candidate, {
          ...input,
          // Keep each try short so there is time for the next model.
          timeoutMs: Math.min(input.timeoutMs ?? 45_000, 45_000),
          retries: input.retries ?? (last ? 2 : 1),
        });
      } catch (error) {
        lastError = error;
        if (!isBusyError(error)) throw error;
        busyUntil.set(candidate, Date.now() + BUSY_COOLDOWN_MS);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Every Gemini model was busy');
  }

  private async requestOnce(
    model: string,
    input: {
      system?: string;
      contents: Array<{ role: string; parts: unknown[] }>;
      json: boolean;
      temperature?: number;
      maxTokens?: number;
      timeoutMs?: number;
      retries?: number;
    },
  ): Promise<AiCompletion> {
    const started = Date.now();
    const root = this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const response = await fetchWithRetry(`${root}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.options.apiKey,
      },
      body: JSON.stringify({
        contents: input.contents,
        ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
        generationConfig: {
          temperature: input.temperature ?? 0.2,
          maxOutputTokens: input.maxTokens ?? 1024,
          ...(input.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    }, { timeoutMs: input.timeoutMs, retries: input.retries });
    if (!response.ok) {
      const body = await response.text();
      throw new GeminiHttpError(response.status, `Gemini request failed (${response.status}): ${body.slice(0, 500)}`);
    }
    const payload = (await response.json()) as {
      model?: string;
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    if (!content.trim()) {
      throw new Error('Gemini response did not include text content');
    }
    const promptTokens = payload.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      content,
      model: payload.model ?? model,
      promptTokens,
      completionTokens,
      estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
      latencyMs: Date.now() - started,
    };
  }
}
