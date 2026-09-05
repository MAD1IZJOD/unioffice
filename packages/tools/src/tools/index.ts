import { DefaultToolRegistry, type ToolRegistry } from "../registry/tool-registry.js";
import { calculatorTool } from "./calculator-tool.js";
import { datetimeTool } from "./datetime-tool.js";
import { jsonTransformTool } from "./json-transform-tool.js";

export * from "./calculator-tool.js";
export * from "./datetime-tool.js";
export * from "./json-transform-tool.js";

/** The safe, deterministic tools available to authorized agents by default. */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new DefaultToolRegistry();

  registry.register(calculatorTool);
  registry.register(datetimeTool);
  registry.register(jsonTransformTool);

  return registry;
}
