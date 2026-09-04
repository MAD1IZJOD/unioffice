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

  think?: boolean;
}

export class DefaultAgentRuntime
  implements AgentRuntime
{
  private readonly model: string;

  private readonly temperature?: number;

  private readonly maxTokens: number;

  private readonly think: boolean;

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
      this.think =
        options.think ??
        false;
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

            think:
                 this.think,

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
      "You are executing one task in a coordinated company workflow.",

      "Work objective:",

      context.work.objective,

      "Task:",

      this.stringify({
        title: context.task.title,
        description: context.task.description,
      }),

      "Completed dependency results:",

      this.stringify(context.task.dependencies),

      "Operational context:",

      this.stringify({
        organizationId: context.work.organizationId,
        workspaceId: context.work.workspaceId,
        priority: context.work.priority,
        workMetadata: context.work.metadata,
        taskMetadata: context.context,
      }),

      "Return the concrete result for this task. Clearly distinguish facts, assumptions, and recommendations.",
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
