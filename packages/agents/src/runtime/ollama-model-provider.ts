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

  /** Bounds an unavailable or stalled local model request. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class OllamaModelProvider
  implements ModelProvider
{
  private readonly baseUrl: string;

  private readonly defaultModel: string;

  private readonly timeoutMs: number;

  constructor(
    options: OllamaModelProviderOptions = {},
  ) {
    const baseUrl =
      options.baseUrl ??
      "http://127.0.0.1:11434";

    try {
      this.baseUrl = new URL(baseUrl)
        .toString()
        .replace(/\/$/, "");
    } catch {
      throw new Error(
        "Ollama baseUrl must be a valid URL.",
      );
    }

    this.defaultModel =
      options.defaultModel ??
      "qwen3:8b";

    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Ollama timeoutMs must be a positive finite number.");
    }
  }

  async generate(
    request: ModelRequest,
  ): Promise<ModelResponse> {
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      response = await fetch(
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
          signal: controller.signal,
        },
      );
    } catch (error) {
      clearTimeout(timeout);

      if (controller.signal.aborted) {
        throw new Error(`Ollama generation timed out after ${this.timeoutMs}ms.`);
      }

      throw new Error(
        `Unable to reach Ollama at ${this.baseUrl}: ${this.errorMessage(error)}`,
      );
    }

    try {
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

      this.validateResponse(data);

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
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Ollama generation timed out after ${this.timeoutMs}ms.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
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

  private validateResponse(
    response: OllamaGenerateResponse,
  ): void {
    if (
      typeof response.model !== "string" ||
      !response.model
    ) {
      throw new Error(
        "Ollama returned a response without a model name.",
      );
    }

    if (typeof response.response !== "string") {
      throw new Error(
        "Ollama returned a response without generated content.",
      );
    }

    if (response.done !== true) {
      throw new Error(
        "Ollama did not finish the generation.",
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : String(error);
  }
}
