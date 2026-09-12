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

test("captures a validate() that throws instead of crashing the caller", async () => {
  const registry = new DefaultToolRegistry();
  const malformedTool: ToolDefinition = {
    ...echoTool,
    id: "malformed",
    validate: () => {
      throw new TypeError("cannot read property of undefined");
    },
  };
  registry.register(malformedTool);
  const executor = new ToolExecutor(registry);

  const result = await executor.execute("malformed", { anything: true }, context(["malformed"]));

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_INPUT_INVALID");
  assert.match(result.error?.message ?? "", /cannot read property of undefined/);
});

/* --------------------------------------------------------------------------
   Governance.

   The guard narrows what an agent may do. It runs after the registry and the
   agent's own grants, and it can only ever take permission away.
   -------------------------------------------------------------------------- */

function registryWithEcho(): DefaultToolRegistry {
  const registry = new DefaultToolRegistry();
  registry.register(echoTool);
  return registry;
}

test("a guard that allows the call leaves execution untouched", async () => {
  const executor = new ToolExecutor(registryWithEcho(), {
    async check() {
      return { outcome: "allow", reason: "No policy restricts this." };
    },
  });

  const result = await executor.execute("echo", { text: "hi" }, context());

  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { text: "hi" });
});

test("a guard that denies the call stops it and names the policy", async () => {
  const executor = new ToolExecutor(registryWithEcho(), {
    async check() {
      return {
        outcome: "deny",
        reason: "Echo is not permitted outside the engineering workspace.",
        policyId: "policy-1",
        policyName: "Workspace tool boundary",
      };
    },
  });

  const result = await executor.execute("echo", { text: "hi" }, context());

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_DENIED_BY_POLICY");
  assert.equal(
    result.error?.message,
    "Echo is not permitted outside the engineering workspace.",
  );
  assert.equal(result.deniedBy?.policyName, "Workspace tool boundary");
  assert.equal(result.output, undefined);
});

test("a guard is never asked about a tool the agent was not granted", async () => {
  let asked = false;

  const executor = new ToolExecutor(registryWithEcho(), {
    async check() {
      asked = true;
      return { outcome: "allow", reason: "" };
    },
  });

  const result = await executor.execute("echo", { text: "hi" }, context([]));

  assert.equal(result.error?.code, "TOOL_NOT_AUTHORIZED");
  assert.equal(asked, false, "the grant check must settle this first");
});

test("a guard cannot grant a tool the registry does not have", async () => {
  const executor = new ToolExecutor(new DefaultToolRegistry(), {
    async check() {
      return { outcome: "allow", reason: "Governance says yes." };
    },
  });

  const result = await executor.execute("echo", { text: "hi" }, context());

  assert.equal(result.error?.code, "TOOL_NOT_FOUND");
});

test("a guard that throws refuses the call rather than waving it through", async () => {
  const executor = new ToolExecutor(registryWithEcho(), {
    async check() {
      throw new Error("the policy store is unreachable");
    },
  });

  const result = await executor.execute("echo", { text: "hi" }, context());

  // The unsafe reading of "governance is unavailable" is that the call is
  // fine. This asserts the safe one.
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_DENIED_BY_POLICY");
  assert.match(result.error?.message ?? "", /could not be consulted/);
});

test("without a guard the executor behaves exactly as it did before", async () => {
  const executor = new ToolExecutor(registryWithEcho());

  const result = await executor.execute("echo", { text: "hi" }, context());

  assert.equal(result.status, "completed");
});
