import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentId,
  WorkId,
} from "@unioffice/core";

import type {
  ModelProvider,
} from "@unioffice/agents";

import {
  OllamaPlanner,
  parseOllamaPlan,
} from "./ollama-planner.js";

const agentId = "agent-1" as AgentId;

test("parses stable refs and validates dependencies", () => {
  const plan = parseOllamaPlan(
    JSON.stringify({
      tasks: [
        {
          ref: "research",
          title: "Research",
          description: "Collect the facts.",
          dependsOn: [],
        },
        {
          ref: "brief",
          title: "Brief",
          description: "Summarize the facts.",
          assignedAgentId: agentId,
          dependsOn: ["research"],
        },
      ],
    }),
    [agentId],
  );

  assert.deepEqual(plan.tasks[1]?.dependsOn, ["research"]);
  assert.equal(plan.tasks[1]?.assignedAgentId, agentId);
});

test("rejects invalid planner JSON", () => {
  assert.throws(
    () => parseOllamaPlan("not json", []),
    /Planner returned invalid JSON/,
  );
});

test("rejects dependency references that do not exist", () => {
  assert.throws(
    () =>
      parseOllamaPlan(
        JSON.stringify({
          tasks: [
            {
              ref: "brief",
              title: "Brief",
              description: "Write a brief.",
              dependsOn: ["missing"],
            },
          ],
        }),
        [],
      ),
    /depends on unknown ref: missing/,
  );
});

test("rejects circular planner dependencies", () => {
  assert.throws(
    () =>
      parseOllamaPlan(
        JSON.stringify({
          tasks: [
            {
              ref: "research",
              title: "Research",
              description: "Research first.",
              dependsOn: ["brief"],
            },
            {
              ref: "brief",
              title: "Brief",
              description: "Write after research.",
              dependsOn: ["research"],
            },
          ],
        }),
        [],
      ),
    /circular dependency/,
  );
});

test("converts dependency refs to persistent task IDs", async () => {
  const modelProvider: ModelProvider = {
    async generate() {
      return {
        model: "test-model",
        content: JSON.stringify({
          tasks: [
            {
              ref: "research",
              title: "Research",
              description: "Collect facts.",
              dependsOn: [],
            },
            {
              ref: "brief",
              title: "Brief",
              description: "Summarize facts.",
              dependsOn: ["research"],
            },
          ],
        }),
        metadata: {},
      };
    },
  };
  const planner = new OllamaPlanner(modelProvider, "test-model");

  const plan = await planner.plan({
    workId: "work-1" as WorkId,
    objective: "Create a brief.",
    availableAgentIds: [],
    context: {},
  });

  assert.equal(plan.tasks[0]?.ref, "research");
  assert.deepEqual(
    plan.tasks[1]?.dependsOn,
    [plan.tasks[0]?.id],
  );
});
