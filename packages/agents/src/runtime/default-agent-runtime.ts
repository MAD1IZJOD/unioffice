import type {
  AgentDefinition,
} from "../definitions/agent-definition.js";

import type {
  AgentExecutionContext,
  AgentExecutionResult,
  AgentRuntime,
} from "./agent-runtime.js";

import type {
  ModelProvider,
} from "./model-provider.js";

export interface DefaultAgentRuntimeOptions {
  model?: string;

  temperature?: number;

  maxTokens?: number;
}

export class DefaultAgentRuntime
  implements AgentRuntime
{
  private readonly model: string;

  private readonly temperature?: number;

  private readonly maxTokens: number;

  constructor(
    private readonly modelProvider: ModelProvider,
    options: DefaultAgentRuntimeOptions = {},
  ) {
    this.model =
      options.model ??
      "qwen3:8b";

    this.temperature =
      options.temperature;

    this.maxTokens =
      options.maxTokens ??
      500;
  }

  async execute(
    definition: AgentDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const startedAt =
      new Date();

    try {
      const response =
        await this.modelProvider.generate({
          model: this.model,

          messages: [
            {
              role: "system",

              content:
                definition.systemInstructions,
            },

            {
              role: "user",

              content:
                this.buildUserPrompt(
                  context,
                ),
            },
          ],

          temperature:
            this.temperature,

          maxTokens:
            this.maxTokens,

          metadata: {
            agentId:
              context.agentId,

            taskId:
              context.taskId,

            workId:
              context.workId,
          },
        });

      return {
        status: "completed",

        output:
          response.content,

        toolCalls: [],

        metadata: {
          model:
            response.model,

          usage:
            response.usage,

          startedAt,

          completedAt:
            new Date(),

          ...response.metadata,
        },
      };
    } catch (error) {
      return {
        status: "failed",

        error: {
          code:
            "AGENT_EXECUTION_FAILED",

          message:
            error instanceof Error
              ? error.message
              : String(error),
        },

        toolCalls: [],

        metadata: {
          startedAt,

          completedAt:
            new Date(),
        },
      };
    }
  }

  private buildUserPrompt(
    context: AgentExecutionContext,
  ): string {
    return [
      "Task input:",

      this.stringify(
        context.input,
      ),

      "Execution context:",

      this.stringify(
        context.context,
      ),
    ].join("\n\n");
  }

  private stringify(
    value: unknown,
  ): string {
    if (
      typeof value ===
      "string"
    ) {
      return value;
    }

    return JSON.stringify(
      value,
      null,
      2,
    );
  }
}