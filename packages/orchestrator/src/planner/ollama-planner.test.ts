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

function taskFields() {
  return {
    requiredCapabilities: [],
    requiredTools: [],
    requiresApproval: false,
  };
}

test("parses stable refs and validates dependencies", () => {
  const plan = parseOllamaPlan(
    JSON.stringify({
      tasks: [
        {
          ref: "research",
          title: "Research",
          description: "Collect the facts.",
          ...taskFields(),
          dependsOn: [],
        },
        {
          ref: "brief",
          title: "Brief",
          description: "Summarize the facts.",
          assignedAgentId: agentId,
          requiredCapabilities: ["writing"],
          requiredTools: [],
          requiresApproval: true,
          approvalReason: "A human must review this external brief.",
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
              ...taskFields(),
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
              ...taskFields(),
              dependsOn: ["brief"],
            },
            {
              ref: "brief",
              title: "Brief",
              description: "Write after research.",
              ...taskFields(),
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
              ...taskFields(),
              dependsOn: [],
            },
            {
              ref: "brief",
              title: "Brief",
              description: "Summarize facts.",
              ...taskFields(),
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
  assert.equal(plan.objective, "Create a brief.");
});

test("rejects malformed capability and approval fields", () => {
  assert.throws(
    () => parseOllamaPlan(JSON.stringify({
      tasks: [{
        ref: "review",
        title: "Review",
        description: "Review the proposal.",
        requiredCapabilities: "analysis",
        requiredTools: [],
        requiresApproval: true,
        dependsOn: [],
      }],
    }), []),
    /requiredCapabilities array/,
  );

  assert.throws(
    () => parseOllamaPlan(JSON.stringify({
      tasks: [{
        ref: "review",
        title: "Review",
        description: "Review the proposal.",
        requiredCapabilities: [],
        requiredTools: [],
        requiresApproval: true,
        dependsOn: [],
      }],
    }), []),
    /approvalReason/,
  );
});

test("ignores an inactive approval reason", () => {
  const plan = parseOllamaPlan(JSON.stringify({
    tasks: [{
      ref: "research",
      title: "Research",
      description: "Collect facts.",
      requiredCapabilities: [],
      requiredTools: [],
      requiresApproval: false,
      approvalReason: "This should not create a gate.",
      dependsOn: [],
    }],
  }), []);

  assert.equal(plan.tasks[0]?.requiresApproval, false);
  assert.equal(plan.tasks[0]?.approvalReason, undefined);
});

test("accepts a known required tool and carries it through to the plan", () => {
  const plan = parseOllamaPlan(
    JSON.stringify({
      tasks: [{
        ref: "compute",
        title: "Compute the total",
        description: "Multiply the two figures.",
        requiredCapabilities: [],
        requiredTools: ["calculator"],
        requiresApproval: false,
        dependsOn: [],
      }],
    }),
    [],
    [{ id: "calculator", name: "Calculator", description: "Evaluates arithmetic." }],
  );

  assert.deepEqual(plan.tasks[0]?.requiredTools, ["calculator"]);
});

test("rejects a required tool that does not exist", () => {
  assert.throws(
    () => parseOllamaPlan(
      JSON.stringify({
        tasks: [{
          ref: "compute",
          title: "Compute the total",
          description: "Multiply the two figures.",
          requiredCapabilities: [],
          requiredTools: ["spreadsheet_macro"],
          requiresApproval: false,
          dependsOn: [],
        }],
      }),
      [],
      [{ id: "calculator", name: "Calculator", description: "Evaluates arithmetic." }],
    ),
    /requires an unknown tool: spreadsheet_macro/,
  );
});

test("drops a required capability outside the known vocabulary instead of failing the plan", () => {
  const plan = parseOllamaPlan(
    JSON.stringify({
      tasks: [{
        ref: "compute",
        title: "Compute the total",
        description: "Project revenue growth.",
        requiredCapabilities: ["mathematical_analysis", "coding"],
        requiredTools: [],
        requiresApproval: false,
        dependsOn: [],
      }],
    }),
    [],
    [],
    ["analysis", "writing", "coding"],
  );

  // The hallucinated capability can never be satisfied, so it is ignored -
  // but the real one it named still routes the task.
  assert.deepEqual(plan.tasks[0]!.requiredCapabilities, ["coding"]);
});

test("accepts a required capability that is in the known vocabulary", () => {
  const plan = parseOllamaPlan(
    JSON.stringify({
      tasks: [{
        ref: "compute",
        title: "Compute the total",
        description: "Project revenue growth.",
        requiredCapabilities: ["analysis"],
        requiredTools: [],
        requiresApproval: false,
        dependsOn: [],
      }],
    }),
    [],
    [],
    ["analysis", "writing", "coding"],
  );

  assert.deepEqual(plan.tasks[0]?.requiredCapabilities, ["analysis"]);
});

test("does not enforce a capability vocabulary when the caller supplies none", () => {
  const plan = parseOllamaPlan(
    JSON.stringify({
      tasks: [{
        ref: "compute",
        title: "Compute the total",
        description: "Project revenue growth.",
        requiredCapabilities: ["anything_goes"],
        requiredTools: [],
        requiresApproval: false,
        dependsOn: [],
      }],
    }),
    [],
  );

  assert.deepEqual(plan.tasks[0]?.requiredCapabilities, ["anything_goes"]);
});

test("rejects a malformed requiredTools field", () => {
  assert.throws(
    () => parseOllamaPlan(
      JSON.stringify({
        tasks: [{
          ref: "compute",
          title: "Compute the total",
          description: "Multiply the two figures.",
          requiredCapabilities: [],
          requiredTools: "calculator",
          requiresApproval: false,
          dependsOn: [],
        }],
      }),
      [],
    ),
    /requiredTools array/,
  );
});

test("puts the requester's briefing in front of the model, and says so", async () => {
  let request: Parameters<ModelProvider["generate"]>[0] | undefined;
  const modelProvider: ModelProvider = {
    async generate(input) {
      request = input;

      return {
        model: "test-model",
        content: JSON.stringify({
          tasks: [
            {
              ref: "plan",
              title: "Plan",
              description: "Write the launch plan.",
              ...taskFields(),
              dependsOn: [],
            },
          ],
        }),
        metadata: {},
      };
    },
  };
  const planner = new OllamaPlanner(modelProvider, "test-model");

  await planner.plan({
    workId: "work-1" as WorkId,
    objective: "Prepare the launch.",
    briefing: "Budget is capped at 40k.",
    availableAgentIds: [],
    context: {},
  });

  const system = request?.messages[0]?.content ?? "";
  const user = request?.messages[1]?.content ?? "";

  assert.match(system, /briefing/i);
  assert.match(user, /Budget is capped at 40k\./);
});

test("says nothing about a briefing when the requester attached none", async () => {
  let request: Parameters<ModelProvider["generate"]>[0] | undefined;
  const modelProvider: ModelProvider = {
    async generate(input) {
      request = input;

      return {
        model: "test-model",
        content: JSON.stringify({
          tasks: [
            {
              ref: "plan",
              title: "Plan",
              description: "Write the launch plan.",
              ...taskFields(),
              dependsOn: [],
            },
          ],
        }),
        metadata: {},
      };
    },
  };
  const planner = new OllamaPlanner(modelProvider, "test-model");

  await planner.plan({
    workId: "work-1" as WorkId,
    objective: "Prepare the launch.",
    availableAgentIds: [],
    context: {},
  });

  const system = request?.messages[0]?.content ?? "";

  assert.doesNotMatch(system, /briefing/i);
  // The instruction list is joined, so an absent briefing must not leave a
  // blank line pretending to be an instruction.
  assert.doesNotMatch(system, /\n\n/);
});
