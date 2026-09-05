import assert from "node:assert/strict";
import test from "node:test";

import { DefaultToolRegistry, type ToolDefinition } from "@unioffice/tools";

import type { AgentDefinition } from "../definitions/agent-definition.js";
import type { ModelRequest, ModelProvider } from "./model-provider.js";
import { DefaultAgentRuntime } from "./default-agent-runtime.js";

const echoTool: ToolDefinition<{ value: number }, { doubled: number }> = {
  id: "double",
  name: "Double",
  description: "Doubles a number.",
  version: "1.0.0",
  inputSchema: { type: "object" },
  validate(input) {
    if (typeof input === "object" && input !== null && typeof (input as Record<string, unknown>).value === "number") {
      return { valid: true, value: input as { value: number } };
    }
    return { valid: false, errors: [{ path: "value", message: "value must be a number." }] };
  },
  async execute(input) {
    return { doubled: input.value * 2 };
  },
};

function toolDefinition(toolIds: string[]): AgentDefinition {
  return {
    id: "agent-1",
    name: "Ledger",
    description: "Performs calculations.",
    type: "specialist",
    systemInstructions: "Use tools when they help.",
    capabilities: ["analysis"],
    toolIds,
    constraints: {},
    metadata: {},
  };
}

function baseContext() {
  return {
    agentId: "agent-1" as never,
    workId: "work-1" as never,
    taskId: "task-1" as never,
    work: {
      objective: "Compute a result.",
      organizationId: "org-1" as never,
      priority: "normal",
      metadata: {},
    },
    task: {
      title: "Double the number 21",
      description: "Use the double tool.",
      dependencies: [],
    },
    context: {},
  };
}

test("provides the model with structured work and dependency context", async () => {
  let request: ModelRequest | undefined;
  const provider: ModelProvider = {
    async generate(value) {
      request = value;
      return {
        model: "test-model",
        content: "Completed the brief.",
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
        metadata: { durationMs: 40 },
      };
    },
  };
  const definition: AgentDefinition = {
    id: "agent-1",
    name: "Forge",
    description: "Engineering specialist.",
    type: "specialist",
    systemInstructions: "Complete engineering tasks precisely.",
    capabilities: ["coding"],
    toolIds: [],
    constraints: {},
    metadata: {},
  };
  const runtime = new DefaultAgentRuntime(provider, { model: "test-model" });

  const result = await runtime.execute(definition, {
    agentId: "agent-1" as never,
    workId: "work-1" as never,
    taskId: "task-2" as never,
    work: {
      objective: "Ship an onboarding improvement.",
      organizationId: "org-1" as never,
      priority: "high",
      metadata: { deliveryTempo: "priority" },
    },
    task: {
      title: "Implement the onboarding flow",
      description: "Create the requested implementation plan.",
      dependencies: [{
        id: "task-1" as never,
        title: "Research onboarding issues",
        result: "SSO is the highest-impact gap.",
      }],
    },
    context: { taskMetadata: { source: "planner" } },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.metadata.model, "test-model");
  const prompt = request?.messages[1]?.content ?? "";
  assert.match(prompt, /Work objective:/);
  assert.match(prompt, /Ship an onboarding improvement/);
  assert.match(prompt, /Completed dependency results:/);
  assert.match(prompt, /SSO is the highest-impact gap/);
});

test("bounds oversized and circular dependency context before model execution", async () => {
  let request: ModelRequest | undefined;
  const provider: ModelProvider = {
    async generate(value) {
      request = value;
      return { model: "test-model", content: "Done.", metadata: {} };
    },
  };
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const runtime = new DefaultAgentRuntime(provider);
  const definition: AgentDefinition = {
    id: "agent-1",
    name: "Nova",
    description: "Research specialist.",
    type: "specialist",
    systemInstructions: "Research accurately.",
    capabilities: ["research"],
    toolIds: [],
    constraints: {},
    metadata: {},
  };

  await runtime.execute(definition, {
    agentId: "agent-1" as never,
    workId: "work-1" as never,
    taskId: "task-2" as never,
    work: {
      objective: "Create a decision brief.",
      organizationId: "org-1" as never,
      priority: "normal",
      metadata: circular,
    },
    task: {
      title: "Review research",
      description: "Use prior findings.",
      dependencies: [{
        id: "task-1" as never,
        title: "Large research output",
        result: `${"useful finding ".repeat(2_000)}SENTINEL_TAIL`,
      }],
    },
    context: {},
  });

  const prompt = request?.messages[1]?.content ?? "";
  assert.ok(prompt.length < 18_000);
  assert.match(prompt, /truncated/);
  assert.match(prompt, /circular reference omitted/);
  assert.doesNotMatch(prompt, /SENTINEL_TAIL/);
});

test("executes an authorized tool call and feeds the result back to the model", async () => {
  const registry = new DefaultToolRegistry();
  registry.register(echoTool);
  const calls: ModelRequest[] = [];
  let turn = 0;
  const provider: ModelProvider = {
    async generate(request) {
      calls.push(request);
      turn += 1;

      if (turn === 1) {
        return {
          model: "test-model",
          content: JSON.stringify({ tool_call: { id: "double", input: { value: 21 } } }),
          metadata: {},
        };
      }

      return { model: "test-model", content: "The result is 42.", metadata: {} };
    },
  };
  const runtime = new DefaultAgentRuntime(provider, { model: "test-model", toolRegistry: registry });

  const result = await runtime.execute(toolDefinition(["double"]), baseContext());

  assert.equal(result.status, "completed");
  assert.equal(result.output, "The result is 42.");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.toolId, "double");
  assert.equal(result.toolCalls[0]?.status, "completed");
  assert.deepEqual(result.toolCalls[0]?.output, { doubled: 42 });
  assert.equal(calls.length, 2);
  assert.match(calls[1]?.messages.at(-1)?.content ?? "", /Tool result for "double"/);
});

test("refuses a tool call for a tool id the agent was not granted", async () => {
  const registry = new DefaultToolRegistry();
  registry.register(echoTool);
  let turn = 0;
  const provider: ModelProvider = {
    async generate() {
      turn += 1;

      if (turn === 1) {
        return {
          model: "test-model",
          content: JSON.stringify({ tool_call: { id: "double", input: { value: 21 } } }),
          metadata: {},
        };
      }

      return { model: "test-model", content: "Done without the tool.", metadata: {} };
    },
  };
  // Registry has "double" registered, but this agent was never granted it.
  const runtime = new DefaultAgentRuntime(provider, { model: "test-model", toolRegistry: registry });

  const result = await runtime.execute(toolDefinition([]), baseContext());

  // With no granted tools, no tool catalog is offered and the first response
  // is treated as the final answer rather than parsed as a tool call.
  assert.equal(result.status, "completed");
  assert.equal(result.toolCalls.length, 0);
});

test("forces a final answer once the tool call budget is exhausted", async () => {
  const registry = new DefaultToolRegistry();
  registry.register(echoTool);
  let turn = 0;
  const provider: ModelProvider = {
    async generate() {
      turn += 1;
      // Always tries to call the tool again, never gives a final answer.
      return {
        model: "test-model",
        content: JSON.stringify({ tool_call: { id: "double", input: { value: turn } } }),
        metadata: {},
      };
    },
  };
  const runtime = new DefaultAgentRuntime(provider, {
    model: "test-model",
    toolRegistry: registry,
    maxToolCalls: 2,
  });

  const result = await runtime.execute(toolDefinition(["double"]), baseContext());

  assert.equal(result.status, "completed");
  assert.equal(result.toolCalls.length, 2);
  // The final turn's raw (still tool-call-shaped) content is surfaced as-is
  // rather than looping forever.
  assert.match(result.output as string, /tool_call/);
});

test("records a failed tool execution without crashing the agent loop", async () => {
  const registry = new DefaultToolRegistry();
  registry.register(echoTool);
  let turn = 0;
  const provider: ModelProvider = {
    async generate() {
      turn += 1;

      if (turn === 1) {
        return {
          model: "test-model",
          content: JSON.stringify({ tool_call: { id: "double", input: { value: "not-a-number" } } }),
          metadata: {},
        };
      }

      return { model: "test-model", content: "Recovered after the tool error.", metadata: {} };
    },
  };
  const runtime = new DefaultAgentRuntime(provider, { model: "test-model", toolRegistry: registry });

  const result = await runtime.execute(toolDefinition(["double"]), baseContext());

  assert.equal(result.status, "completed");
  assert.equal(result.toolCalls[0]?.status, "failed");
  assert.equal(result.toolCalls[0]?.error?.code, "TOOL_INPUT_INVALID");
  assert.equal(result.output, "Recovered after the tool error.");
});

test("bounds an oversized tool output before it is fed back into the model", async () => {
  const registry = new DefaultToolRegistry();
  const hugeOutputTool: ToolDefinition<Record<string, never>, { text: string }> = {
    id: "dump",
    name: "Dump",
    description: "Returns a large amount of text.",
    version: "1.0.0",
    inputSchema: { type: "object" },
    validate: () => ({ valid: true, value: {} }),
    async execute() {
      return { text: "x".repeat(50_000) };
    },
  };
  registry.register(hugeOutputTool);
  const requests: ModelRequest[] = [];
  let turn = 0;
  const provider: ModelProvider = {
    async generate(request) {
      requests.push(request);
      turn += 1;

      if (turn === 1) {
        return {
          model: "test-model",
          content: JSON.stringify({ tool_call: { id: "dump", input: {} } }),
          metadata: {},
        };
      }

      return { model: "test-model", content: "Done.", metadata: {} };
    },
  };
  const runtime = new DefaultAgentRuntime(provider, { model: "test-model", toolRegistry: registry });

  const result = await runtime.execute(toolDefinition(["dump"]), baseContext());

  assert.equal(result.status, "completed");
  const followUpPrompt = requests[1]?.messages.at(-1)?.content ?? "";
  assert.ok(followUpPrompt.length < 5_000, "the tool result message must be bounded, not the raw 50,000-char output");
  assert.match(followUpPrompt, /truncated/);
});
