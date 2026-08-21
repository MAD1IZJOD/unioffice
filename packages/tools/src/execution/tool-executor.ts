import type {
  ToolDefinition,
  ToolExecutionContext,
} from "../tool.js";

import { ToolRegistry } from "../registry/tool-registry.js";

export interface ToolExecutionResult {
  toolId: string;

  status:
    | "completed"
    | "failed";

  output?: unknown;

  error?: {
    code: string;
    message: string;
  };

  startedAt: Date;

  completedAt: Date;
}

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
  ) {}

  async execute<TInput, TOutput>(
    toolId: string,
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startedAt = new Date();

    try {
      const tool = this.registry.get(
        toolId,
      ) as ToolDefinition<TInput, TOutput>;

      const output = await tool.execute(
        input,
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
      return {
        toolId,
        status: "failed",
        error: {
          code: "TOOL_EXECUTION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : String(error),
        },
        startedAt,
        completedAt: new Date(),
      };
    }
  }
}