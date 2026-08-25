export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionRequest {
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
  model?: string;
}

export type ModelTask = 'explore' | 'structured' | 'vision' | 'summary';
