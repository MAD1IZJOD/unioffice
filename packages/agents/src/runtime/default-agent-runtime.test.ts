import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDefinition } from "../definitions/agent-definition.js";
import type { ModelRequest, ModelProvider } from "./model-provider.js";
import { DefaultAgentRuntime } from "./default-agent-runtime.js";

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
