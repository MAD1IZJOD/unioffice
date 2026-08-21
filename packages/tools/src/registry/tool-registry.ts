import type { ToolDefinition } from "../tool.js";

export class ToolRegistry {
  private readonly tools = new Map<
    string,
    ToolDefinition
  >();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) {
      throw new Error(
        `Tool already registered: ${tool.id}`,
      );
    }

    this.tools.set(tool.id, tool);
  }

  get(id: string): ToolDefinition {
    const tool = this.tools.get(id);

    if (!tool) {
      throw new Error(
        `Tool not found: ${id}`,
      );
    }

    return tool;
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  remove(id: string): boolean {
    return this.tools.delete(id);
  }

  clear(): void {
    this.tools.clear();
  }
}