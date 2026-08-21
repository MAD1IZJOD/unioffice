import type { AgentDefinition } from "../definitions/agent-definition.js";

export class AgentRegistry {
  private readonly definitions = new Map<
    string,
    AgentDefinition
  >();

  register(definition: AgentDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(
        `Agent definition already registered: ${definition.id}`,
      );
    }

    this.definitions.set(definition.id, definition);
  }

  get(id: string): AgentDefinition {
    const definition = this.definitions.get(id);

    if (!definition) {
      throw new Error(
        `Agent definition not found: ${id}`,
      );
    }

    return definition;
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  list(): AgentDefinition[] {
    return [...this.definitions.values()];
  }

  remove(id: string): boolean {
    return this.definitions.delete(id);
  }

  clear(): void {
    this.definitions.clear();
  }
}