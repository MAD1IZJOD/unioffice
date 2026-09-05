import type {
  AgentDefinition,
} from "../definitions/agent-definition.js";

import type {
  AgentExecutionContext,
  AgentExecutionResult,
  AgentRuntime,
  AgentToolCall,
} from "./agent-runtime.js";

import type {
  ModelMessage,
  ModelProvider,
} from "./model-provider.js";

import {
  ToolExecutor,
  type ToolDefinition,
  type ToolRegistry,
} from "@unioffice/tools";

export interface DefaultAgentRuntimeOptions {
  model?: string;

  temperature?: number;

  maxTokens?: number;

  think?: boolean;

  /** Tools available to agents that are granted access via toolIds. */
  toolRegistry?: ToolRegistry;

  /** Bounds the reason -> tool call -> result loop per task execution. */
  maxToolCalls?: number;
}

const DEFAULT_MAX_TOOL_CALLS = 3;

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

  private readonly toolRegistry?: ToolRegistry;

  private readonly toolExecutor?: ToolExecutor;

  private readonly maxToolCalls: number;

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

    this.toolRegistry = options.toolRegistry;
    this.toolExecutor = options.toolRegistry
      ? new ToolExecutor(options.toolRegistry)
      : undefined;
    this.maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  }

  async execute(
    definition: AgentDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const startedAt = new Date();
    const availableTools = this.toolRegistry
      ? this.toolRegistry.getMany(definition.toolIds)
      : [];

    const messages: ModelMessage[] = [
      {
        role: "system",
        content: availableTools.length > 0
          ? `${definition.systemInstructions}\n\n${this.buildToolProtocol(availableTools)}`
          : definition.systemInstructions,
      },
      {
        role: "user",
        content: this.buildUserPrompt(context),
      },
    ];

    const toolCalls: AgentToolCall[] = [];

    try {
      let iteration = 0;

      for (;;) {
        const finalTurn = iteration >= this.maxToolCalls;

        if (finalTurn) {
          messages.push({
            role: "user",
            content:
              "You have used the maximum number of tool calls for this task. " +
              "Give your final answer now as plain text, without calling another tool.",
          });
        }

        const response = await this.modelProvider.generate({
          model: this.model,
          messages,
          temperature: this.temperature,
          maxTokens: this.maxTokens,
          think: this.think,
          metadata: {
            agentId: context.agentId,
            taskId: context.taskId,
            workId: context.workId,
          },
        });

        const toolCallRequest = finalTurn
          ? null
          : parseToolCallRequest(response.content, availableTools);

        if (!toolCallRequest) {
          return {
            status: "completed",
            output: response.content,
            toolCalls,
            metadata: {
              model: response.model,
              usage: response.usage,
              startedAt,
              completedAt: new Date(),
              ...response.metadata,
            },
          };
        }

        messages.push({ role: "assistant", content: response.content });

        const toolContext = {
          organizationId: context.work.organizationId,
          agentId: context.agentId,
          workId: context.workId,
          taskId: context.taskId,
          authorizedToolIds: definition.toolIds,
          metadata: {},
        };

        const result = await this.toolExecutor!.execute(
          toolCallRequest.id,
          toolCallRequest.input,
          toolContext,
        );

        toolCalls.push({
          toolId: result.toolId,
          input: toolCallRequest.input,
          output: result.output,
          error: result.error
            ? { code: result.error.code, message: result.error.message }
            : undefined,
          status: result.status,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
        });

        messages.push({
          role: "user",
          content: [
            `Tool result for "${result.toolId}":`,
            JSON.stringify(
              result.status === "completed"
                ? { status: result.status, output: result.output }
                : { status: result.status, error: result.error },
            ),
            "Continue reasoning, call another tool if needed, or give your final answer as plain text.",
          ].join("\n"),
        });

        iteration += 1;
      }
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

        toolCalls,

        metadata: {
          startedAt,

          completedAt:
            new Date(),
        },
      };
    }
  }

  private buildToolProtocol(
    tools: ToolDefinition[],
  ): string {
    const catalog = tools
      .map((tool) => [
        `- id: ${tool.id}`,
        `  name: ${tool.name}`,
        `  description: ${tool.description}`,
        `  input schema: ${JSON.stringify(tool.inputSchema)}`,
      ].join("\n"))
      .join("\n");

    return [
      "You have access to tools. To call one, respond with ONLY a single JSON object of this exact shape and nothing else:",
      '{"tool_call": {"id": "<tool id>", "input": { ... }}}',
      "After you receive a tool result, you may call another tool the same way, or give your final answer as plain text (not JSON) when you are done.",
      "Never fabricate a tool result yourself — always wait for the tool result message before continuing.",
      "Only use tool ids from the list below.",
      "",
      "Available tools:",
      catalog,
    ].join("\n");
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

interface ToolCallRequest {
  id: string;

  input: unknown;
}

/**
 * Looks for a `{"tool_call": {"id": ..., "input": ...}}` envelope in the
 * model's response. Anything else — plain prose, malformed JSON, an unknown
 * tool id — is treated as a final answer rather than a tool call, so a model
 * that ignores the protocol degrades to ordinary text output instead of
 * silently "pretending" to call a tool.
 */
function parseToolCallRequest(
  content: string,
  availableTools: ToolDefinition[],
): ToolCallRequest | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const toolCall = (parsed as Record<string, unknown>).tool_call;

  if (typeof toolCall !== "object" || toolCall === null) {
    return null;
  }

  const id = (toolCall as Record<string, unknown>).id;

  if (typeof id !== "string" || !availableTools.some((tool) => tool.id === id)) {
    return null;
  }

  const input = (toolCall as Record<string, unknown>).input;

  return { id, input: input ?? {} };
}
