import type { z } from 'zod';
import { estimateCostUsd } from './cost.js';
import type { AiCompletion, AiCompletionRequest, ImageAnalysisRequest } from './types.js';
import { fetchWithRetry } from './retry.js';

export interface StructuredGenerationRequest {
  timeoutMs?: number;
  retries?: number;
  messages: AiCompletionRequest['messages'];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StructuredGenerationResult<T> {
  data: T;
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
}

export interface AIProvider {
  readonly name: string;
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
  generateStructured<T>(request: StructuredGenerationRequest, schema: z.ZodType<T>): Promise<StructuredGenerationResult<T>>;
  generateText(request: AiCompletionRequest): Promise<AiCompletion>;
  analyzeImage(request: ImageAnalysisRequest): Promise<AiCompletion>;
}

function usageOf(payload: {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model: string;
}): { promptTokens: number; completionTokens: number; estimatedCostUsd: number } {
  const promptTokens = payload.usage?.prompt_tokens ?? 0;
  const completionTokens = payload.usage?.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    estimatedCostUsd: estimateCostUsd(payload.model, promptTokens, completionTokens),
  };
}

export class OpenAiProvider implements AIProvider {
  readonly name = 'openai';

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      baseUrl?: string;
      visionModel?: string;
    },
  ) {}

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    return this.chat(request, true);
  }

  async generateText(request: AiCompletionRequest): Promise<AiCompletion> {
    return this.chat(request, false);
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest,
    schema: z.ZodType<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const completion = await this.chat(request, true);
    let parsed: unknown;
    try {
      parsed = JSON.parse(completion.content);
    } catch {
      throw new Error('AI structured response was not valid JSON');
    }
    return {
      data: schema.parse(parsed),
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
    const started = Date.now();
    const response = await fetchWithRetry(`${this.options.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 800,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: request.prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${request.mimeType ?? 'image/png'};base64,${request.imageBase64}`,
                },
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI vision request failed (${response.status}): ${body}`);
    }
    const payload = (await response.json()) as {
      model: string;
      choices: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI vision response did not include message content');
    }
    const usage = usageOf(payload);
    return {
      content,
      model: payload.model,
      ...usage,
      latencyMs: Date.now() - started,
    };
  }

  private async chat(request: AiCompletionRequest, json: boolean): Promise<AiCompletion> {
    const model = request.model ?? this.options.model;
    const started = Date.now();
    const response = await fetchWithRetry(`${this.options.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: request.messages,
      }),
    }, { timeoutMs: request.timeoutMs, retries: request.retries });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as {
      model: string;
      choices: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = payload.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI response did not include message content');
    }

    const usage = usageOf(payload);
    return {
      content,
      model: payload.model,
      ...usage,
      latencyMs: Date.now() - started,
    };
  }
}
