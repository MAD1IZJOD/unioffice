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

const MAX_OBJECTIVE_CHARS = 3_000;
const MAX_TASK_CHARS = 4_000;
const MAX_DEPENDENCY_CHARS = 6_000;
const MAX_OPERATIONAL_CONTEXT_CHARS = 4_000;
const MAX_VALUE_DEPTH = 5;
const MAX_OBJECT_KEYS = 32;
const MAX_ARRAY_ITEMS = 24;
const MAX_STRING_CHARS = 1_200;

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

      this.limitText(context.work.objective, MAX_OBJECTIVE_CHARS),

      "Task:",

      this.stringify({
        title: context.task.title,
        description: context.task.description,
      }, MAX_TASK_CHARS),

      "Completed dependency results:",

      this.stringify(
        context.task.dependencies,
        MAX_DEPENDENCY_CHARS,
      ),

      "Operational context:",

      this.stringify({
        organizationId: context.work.organizationId,
        workspaceId: context.work.workspaceId,
        priority: context.work.priority,
        workMetadata: context.work.metadata,
        taskMetadata: context.context,
      }, MAX_OPERATIONAL_CONTEXT_CHARS),

      "Return the concrete result for this task. Clearly distinguish facts, assumptions, and recommendations.",
    ].join("\n\n");
  }

  private stringify(
    value: unknown,
    maxChars: number,
  ): string {
    try {
      const serialized = JSON.stringify(
        this.sanitizeForPrompt(value),
        null,
        2,
      );

      if (!serialized) {
        return "null";
      }

      if (serialized.length <= maxChars) {
        return serialized;
      }

      return JSON.stringify({
        truncated: true,
        preview: `${serialized.slice(0, maxChars)}…`,
      });
    } catch {
      return JSON.stringify({
        unavailable: "Execution context could not be serialized safely.",
      });
    }
  }

  private sanitizeForPrompt(
    value: unknown,
    seen = new WeakSet<object>(),
    depth = 0,
  ): unknown {
    if (typeof value === "string") {
      return this.limitText(value, MAX_STRING_CHARS);
    }

    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (typeof value === "undefined") {
      return "[undefined]";
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value === "function" || typeof value === "symbol") {
      return `[unsupported ${typeof value}]`;
    }

    if (depth >= MAX_VALUE_DEPTH) {
      return "[maximum nesting depth reached]";
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value !== "object") {
      return String(value);
    }

    if (seen.has(value)) {
      return "[circular reference omitted]";
    }

    seen.add(value);

    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => this.sanitizeForPrompt(item, seen, depth + 1));

      if (value.length > MAX_ARRAY_ITEMS) {
        items.push(
          `[${value.length - MAX_ARRAY_ITEMS} additional items omitted]`,
        );
      }

      seen.delete(value);
      return items;
    }

    const entries = Object.entries(value)
      .slice(0, MAX_OBJECT_KEYS)
      .map(([key, entry]) => [
        this.limitText(key, 160),
        this.sanitizeForPrompt(entry, seen, depth + 1),
      ]);
    const result = Object.fromEntries(entries) as Record<string, unknown>;

    if (Object.keys(value).length > MAX_OBJECT_KEYS) {
      result.additionalProperties =
        `[${Object.keys(value).length - MAX_OBJECT_KEYS} properties omitted]`;
    }

    seen.delete(value);
    return result;
  }

  private limitText(value: string, maxChars: number): string {
    return value.length <= maxChars
      ? value
      : `${value.slice(0, maxChars)}… [truncated]`;
  }
}
