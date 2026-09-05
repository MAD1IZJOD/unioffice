import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolValidationError,
} from "../tool.js";

import type {
  ToolRegistry,
} from "../registry/tool-registry.js";

export type ToolExecutionErrorCode =
  | "TOOL_NOT_FOUND"
  | "TOOL_NOT_AUTHORIZED"
  | "TOOL_INPUT_INVALID"
  | "TOOL_EXECUTION_FAILED";

export interface ToolExecutionResult {
  toolId: string;

  status:
    | "completed"
    | "failed";

  output?: unknown;

  error?: {
    code: ToolExecutionErrorCode;
    message: string;
    details?: ToolValidationError[];
  };

  startedAt: Date;

  completedAt: Date;
}

/**
 * Runs the full agent -> tool loop step: registry lookup, authorization
 * against the calling agent's granted tool ids, structural input validation,
 * and only then execution. Each stage can fail independently so callers can
 * tell "the agent tried to use a tool it doesn't have" apart from
 * "the tool itself failed".
 */
export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
  ) {}

  async execute<
    TInput = unknown,
    TOutput = unknown,
  >(
    toolId: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startedAt = new Date();

    const tool = this.registry.get(toolId) as
      | ToolDefinition<TInput, TOutput>
      | null;

    if (!tool) {
      return this.failed(
        toolId,
        startedAt,
        "TOOL_NOT_FOUND",
        `Tool not found: ${toolId}`,
      );
    }

    if (!context.authorizedToolIds.includes(toolId)) {
      return this.failed(
        toolId,
        startedAt,
        "TOOL_NOT_AUTHORIZED",
        `Agent is not authorized to use tool: ${toolId}`,
      );
    }

    const validation = tool.validate(input);

    if (!validation.valid) {
      return this.failed(
        toolId,
        startedAt,
        "TOOL_INPUT_INVALID",
        `Input for tool ${toolId} failed validation.`,
        validation.errors,
      );
    }

    try {
      const output = await tool.execute(
        validation.value,
        context,
      );

      return {
        toolId,
        status: "completed",
        output,
        startedAt,
        completedAt: new Date(),
      };
    } catch (error) {
      return this.failed(
        toolId,
        startedAt,
        "TOOL_EXECUTION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private failed(
    toolId: string,
    startedAt: Date,
    code: ToolExecutionErrorCode,
    message: string,
    details?: ToolValidationError[],
  ): ToolExecutionResult {
    return {
      toolId,
      status: "failed",
      error: { code, message, details },
      startedAt,
      completedAt: new Date(),
    };
  }
}
