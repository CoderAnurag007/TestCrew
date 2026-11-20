import type { z } from 'zod';
import { estimateCostUsd } from './cost.js';
import { GeminiProvider } from './gemini.js';
import { OpenAiProvider, type AIProvider, type StructuredGenerationRequest, type StructuredGenerationResult } from './provider.js';
import type { AiClient, AiCompletion, AiCompletionRequest, ImageAnalysisRequest, ModelTask } from './types.js';

export class HeuristicProvider implements AIProvider {
  readonly name = 'heuristic';

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    return {
      content: request.messages.at(-1)?.content ?? '{}',
      model: 'heuristic',
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 0,
      estimatedCostUsd: 0,
    };
  }

  async generateText(request: AiCompletionRequest): Promise<AiCompletion> {
    return this.complete(request);
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest,
    schema: z.ZodType<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const content = request.messages.at(-1)?.content ?? '{}';
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }
    const data = schema.parse(parsed);
    return {
      data,
      content,
      model: 'heuristic',
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 0,
      estimatedCostUsd: 0,
    };
  }

  async analyzeImage(request: ImageAnalysisRequest): Promise<AiCompletion> {
    return {
      content: JSON.stringify({
        observations: [],
        note: 'Heuristic provider does not analyze images',
        prompt: request.prompt.slice(0, 200),
      }),
      model: 'heuristic',
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 0,
      estimatedCostUsd: 0,
    };
  }
}

export class ModelRouter implements AiClient {
  constructor(
    private readonly provider: AIProvider,
    private readonly models: { default: string; vision?: string; summary?: string } = { default: 'heuristic' },
  ) {}

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    return this.provider.complete(request);
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest,
    schema: z.ZodType<T>,
  ): Promise<StructuredGenerationResult<T>> {
    return this.provider.generateStructured(request, schema);
  }

  async generateText(request: AiCompletionRequest): Promise<AiCompletion> {
    return this.provider.generateText(request);
  }

  async analyzeImage(request: ImageAnalysisRequest): Promise<AiCompletion> {
    return this.provider.analyzeImage({
      ...request,
      model: request.model ?? this.modelFor('vision'),
    });
  }

  current(): AIProvider {
    return this.provider;
  }

  modelFor(task: ModelTask): string {
    if (task === 'vision') {
      return this.models.vision ?? this.models.default;
    }
    if (task === 'summary') {
      return this.models.summary ?? this.models.default;
    }
    return this.models.default;
  }
}

export function createModelRouter(options: {
  apiKey?: string;
  model: string;
  baseUrl?: string;
  visionModel?: string;
  summaryModel?: string;
  provider?: 'auto' | 'openai' | 'gemini' | 'heuristic';
  openaiApiKey?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
}): ModelRouter {
  const provider = options.provider ?? 'auto';
  const openaiKey = options.openaiApiKey ?? options.apiKey;
  const geminiKey = options.geminiApiKey;
  const openaiModel = options.openaiModel ?? options.model;
  const geminiModel = options.geminiModel ?? 'gemini-2.0-flash';

  const wantGemini = provider === 'gemini' || (provider === 'auto' && Boolean(geminiKey));
  const wantOpenAi = provider === 'openai' || (provider === 'auto' && !geminiKey && Boolean(openaiKey));

  if (wantGemini && geminiKey) {
    return new ModelRouter(new GeminiProvider({ apiKey: geminiKey, model: geminiModel, visionModel: options.visionModel, fallbackModels: process.env.GEMINI_FALLBACK_MODELS ? process.env.GEMINI_FALLBACK_MODELS.split(',').map((item) => item.trim()).filter(Boolean) : undefined }), {
      default: geminiModel,
      vision: options.visionModel ?? geminiModel,
      summary: options.summaryModel ?? geminiModel,
    });
  }
  if (wantOpenAi && openaiKey) {
    return new ModelRouter(
      new OpenAiProvider({
        apiKey: openaiKey,
        model: openaiModel,
        baseUrl: options.baseUrl,
        visionModel: options.visionModel,
      }),
      { default: openaiModel, vision: options.visionModel, summary: options.summaryModel },
    );
  }
  return new ModelRouter(new HeuristicProvider(), { default: 'heuristic' });
}

export function createAiClient(options: { apiKey: string; model: string; baseUrl?: string }): AiClient {
  return new OpenAiProvider(options);
}

export { OpenAiProvider, estimateCostUsd };
export type { AIProvider };
