import type {
  ToolDefinition,
} from "../tool.js";

export interface ToolRegistry {
  register<
    TInput = unknown,
    TOutput = unknown,
  >(
    tool: ToolDefinition<
      TInput,
      TOutput
    >,
  ): void;

  get(
    toolId: string,
  ): ToolDefinition | null;

  getMany(
    toolIds: string[],
  ): ToolDefinition[];

  has(
    toolId: string,
  ): boolean;

  list(): ToolDefinition[];
}

export class DefaultToolRegistry
  implements ToolRegistry
{
  private readonly tools =
    new Map<
      string,
      ToolDefinition
    >();

  register<
    TInput = unknown,
    TOutput = unknown,
  >(
    tool: ToolDefinition<
      TInput,
      TOutput
    >,
  ): void {
    if (
      this.tools.has(tool.id)
    ) {
      throw new Error(
        `Tool already registered: ${tool.id}`,
      );
    }

    this.tools.set(
      tool.id,
      tool,
    );
  }

  get(
    toolId: string,
  ): ToolDefinition | null {
    return (
      this.tools.get(toolId) ??
      null
    );
  }

  getMany(
    toolIds: string[],
  ): ToolDefinition[] {
    return toolIds
      .map((toolId) =>
        this.tools.get(toolId),
      )
      .filter(
        (
          tool,
        ): tool is ToolDefinition =>
          tool !== undefined,
      );
  }

  has(
    toolId: string,
  ): boolean {
    return this.tools.has(
      toolId,
    );
  }

  list(): ToolDefinition[] {
    return Array.from(
      this.tools.values(),
    );
  }
}