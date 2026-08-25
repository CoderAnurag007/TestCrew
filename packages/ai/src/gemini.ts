import type { z } from 'zod';
import { estimateCostUsd } from './cost.js';
import type { AIProvider, StructuredGenerationRequest, StructuredGenerationResult } from './provider.js';
import type { AiCompletion, AiCompletionRequest, ImageAnalysisRequest } from './types.js';

export function parseJsonContent(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  return JSON.parse(trimmed);
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      baseUrl?: string;
      visionModel?: string;
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
    const completion = await this.generate(request, true);
    const data = schema.parse(parseJsonContent(completion.content));
    return {
      data,
      content: completion.content,
      model: completion.model,
      promptTokens: completion.promptTokens ?? 0,
      completionTokens: completion.completionTokens ?? 0,
      latencyMs: completion.latencyMs ?? 0,
      estimatedCostUsd: completion.estimatedCostUsd ?? 0,
    };
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
          ],
        },
      ],
      json: false,
      temperature: 0,
      maxTokens: 800,
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
    },
  ): Promise<AiCompletion> {
    const started = Date.now();
    const root = this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const response = await fetch(`${root}/models/${encodeURIComponent(model)}:generateContent`, {
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
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini request failed (${response.status}): ${body}`);
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
