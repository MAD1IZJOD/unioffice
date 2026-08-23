import type {
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "./model-provider.js";

interface OllamaGenerateResponse {
  model: string;

  response: string;

  thinking?: string;

  done: boolean;

  prompt_eval_count?: number;

  eval_count?: number;

  total_duration?: number;

  load_duration?: number;
}

export interface OllamaModelProviderOptions {
  baseUrl?: string;

  defaultModel?: string;
}

export class OllamaModelProvider
  implements ModelProvider
{
  private readonly baseUrl: string;

  private readonly defaultModel: string;

  constructor(
    options: OllamaModelProviderOptions = {},
  ) {
    this.baseUrl =
      options.baseUrl ??
      "http://127.0.0.1:11434";

    this.defaultModel =
      options.defaultModel ??
      "qwen3:8b";
  }

  async generate(
    request: ModelRequest,
  ): Promise<ModelResponse> {
    const response =
      await fetch(
        `${this.baseUrl}/api/generate`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            model:
              request.model ||
              this.defaultModel,

            prompt:
              this.buildPrompt(
                request.messages,
              ),

            stream: false,
            think:
            request.think ?? false,

            options: {
              ...(request.temperature !==
              undefined
                ? {
                    temperature:
                      request.temperature,
                  }
                : {}),

              ...(request.maxTokens !==
              undefined
                ? {
                    num_predict:
                      request.maxTokens,
                  }
                : {}),
            },
          }),
        },
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      throw new Error(
        `Ollama request failed (${response.status}): ${errorText}`,
      );
    }

    const data =
      (await response.json()) as
        OllamaGenerateResponse;

    return {
      content: data.response,

      model: data.model,

      usage: {
        inputTokens:
          data.prompt_eval_count,

        outputTokens:
          data.eval_count,

        totalTokens:
          (
            data.prompt_eval_count ??
            0
          ) +
          (
            data.eval_count ??
            0
          ),
      },

      metadata: {
        totalDuration:
          data.total_duration,

        loadDuration:
          data.load_duration,

        thinking:
          data.thinking,
      },
    };
  }

  private buildPrompt(
    messages: ModelMessage[],
  ): string {
    return messages
      .map(
        (message) =>
          `${this.roleLabel(
            message.role,
          )}:\n${message.content}`,
      )
      .join("\n\n");
  }

  private roleLabel(
    role: ModelMessage["role"],
  ): string {
    switch (role) {
      case "system":
        return "SYSTEM";

      case "user":
        return "USER";

      case "assistant":
        return "ASSISTANT";
    }
  }
}