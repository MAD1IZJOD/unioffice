import assert from "node:assert/strict";
import test from "node:test";

import type { ToolDefinition, ToolExecutionContext } from "../tool.js";
import { DefaultToolRegistry } from "../registry/tool-registry.js";
import { ToolExecutor } from "./tool-executor.js";

function context(authorizedToolIds: string[] = ["echo"]): ToolExecutionContext {
  return {
    organizationId: "org-1",
    agentId: "agent-1",
    authorizedToolIds,
    metadata: {},
  };
}

const echoTool: ToolDefinition<{ text: string }, { text: string }> = {
  id: "echo",
  name: "Echo",
  description: "Returns its input.",
  version: "1.0.0",
  inputSchema: { type: "object" },
  validate(input) {
    if (
      typeof input === "object" &&
      input !== null &&
      typeof (input as Record<string, unknown>).text === "string"
    ) {
      return { valid: true, value: input as { text: string } };
    }

    return { valid: false, errors: [{ path: "text", message: "text must be a string." }] };
  },
  async execute(input) {
    return input;
  },
};

test("executes an authorized tool with valid input", async () => {
  const registry = new DefaultToolRegistry();
  registry.register(echoTool);
  const executor = new ToolExecutor(registry);

  const result = await executor.execute("echo", { text: "hello" }, context());

  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { text: "hello" });
});

test("refuses a tool that does not exist", async () => {
  const registry = new DefaultToolRegistry();
  const executor = new ToolExecutor(registry);

  const result = await executor.execute("missing", {}, context([]));

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_NOT_FOUND");
});

test("refuses a tool the agent is not authorized to use", async () => {
  const registry = new DefaultToolRegistry();
  registry.register(echoTool);
  const executor = new ToolExecutor(registry);

  const result = await executor.execute("echo", { text: "hello" }, context([]));

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_NOT_AUTHORIZED");
});

test("refuses input that fails structural validation before execute() runs", async () => {
  const registry = new DefaultToolRegistry();
  registry.register(echoTool);
  const executor = new ToolExecutor(registry);

  const result = await executor.execute("echo", { text: 42 }, context());

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_INPUT_INVALID");
  assert.equal(result.error?.details?.[0]?.path, "text");
});

test("captures a thrown execution error without crashing the caller", async () => {
  const registry = new DefaultToolRegistry();
  const throwingTool: ToolDefinition = {
    ...echoTool,
    id: "throwing",
    validate: () => ({ valid: true, value: {} }),
    execute: async () => {
      throw new Error("boom");
    },
  };
  registry.register(throwingTool);
  const executor = new ToolExecutor(registry);

  const result = await executor.execute("throwing", {}, context(["throwing"]));

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_EXECUTION_FAILED");
  assert.equal(result.error?.message, "boom");
});
