export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionRequest {
  /** Give up after this long per attempt (default 60 s). */
  timeoutMs?: number;
  /** Extra attempts after rate limits or 5xx answers (default 2). */
  retries?: number;
  messages: AiMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiCompletion {
  content: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  estimatedCostUsd?: number;
}

export interface AiClient {
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
}

export interface ImageAnalysisRequest {
  prompt: string;
  imageBase64: string;
  mimeType?: string;
  /** More screenshots sent after the first one, in order. */
  extraImages?: Array<{ imageBase64: string; mimeType?: string }>;
  /** Ask for a JSON answer. */
  json?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  model?: string;
}

export type ModelTask = 'explore' | 'structured' | 'vision' | 'summary';
