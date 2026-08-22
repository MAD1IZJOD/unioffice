export type ModelRole =
  | "system"
  | "user"
  | "assistant";

export interface ModelMessage {
  role: ModelRole;

  content: string;
}

export interface ModelRequest {
  model: string;

  messages: ModelMessage[];

  temperature?: number;

  maxTokens?: number;

  metadata?: Record<string, unknown>;
}

export interface ModelResponse {
  content: string;

  model: string;

  usage?: {
    inputTokens?: number;

    outputTokens?: number;

    totalTokens?: number;
  };

  metadata: Record<string, unknown>;
}

export interface ModelProvider {
  generate(
    request: ModelRequest,
  ): Promise<ModelResponse>;
}