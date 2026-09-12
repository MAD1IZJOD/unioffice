import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentId,
  OrganizationId,
  Policy,
  PolicyId,
  WorkspaceId,
} from "@unioffice/core";

import { DefaultPolicyEngine } from "./default-policy-engine.js";

import type {
  GovernanceAction,
  GovernanceContext,
} from "./policy.js";

const organizationId = "org-1" as OrganizationId;
const otherOrganizationId = "org-2" as OrganizationId;

const engine = new DefaultPolicyEngine();

function policy(id: string, overrides: Partial<Policy> = {}): Policy {
  return {
    id: id as PolicyId,
    organizationId,
    name: `Policy ${id}`,
    description: "Because the company said so.",
    subject: "tool",
    scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [] },
    effect: "deny",
    risk: "medium",
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    metadata: {},
    ...overrides,
  };
}

function context(overrides: Partial<GovernanceContext> = {}): GovernanceContext {
  return {
    organizationId,
    agentId: "harvey" as AgentId,
    agentCapabilities: ["calculation", "financial_analysis"],
    agentToolIds: ["calculator", "datetime"],
    ...overrides,
  };
}

const useCalculator: GovernanceAction = {
  kind: "tool",
  toolId: "calculator",
  toolRisk: "low",
};

test("an action nothing governs is allowed, and says so rather than inventing a rule", () => {
  const decision = engine.evaluate(useCalculator, context(), []);

  assert.equal(decision.outcome, "allow");
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.decidingPolicyId, undefined);
  assert.match(decision.summary, /No policy restricts calculator/);
});

test("a matching deny stops the action and names the policy that did it", () => {
  const rule = policy("p1", {
    name: "No calculator for anyone",
    scope: { agentIds: [], toolIds: ["calculator"], workspaceIds: [], capabilities: [] },
    effect: "deny",
  });

  const decision = engine.evaluate(useCalculator, context(), [rule]);

  assert.equal(decision.outcome, "deny");
  assert.equal(decision.decidingPolicyName, "No calculator for anyone");
  assert.equal(decision.reasons.length, 1);
  assert.match(decision.summary, /not permitted by No calculator for anyone/);
});

test("a broad allow cannot undo a deny - the strongest effect wins", () => {
  const deny = policy("p1", { name: "Never", effect: "deny" });
  const allow = policy("p2", { name: "Everything is fine", effect: "allow" });

  // Both orderings, because "whatever the database returned first" must not
  // be able to change a security decision.
  for (const policies of [[deny, allow], [allow, deny]]) {
    const decision = engine.evaluate(useCalculator, context(), policies);

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.decidingPolicyName, "Never");
    assert.equal(decision.reasons.length, 2);
  }
});

test("require_approval outranks allow and is outranked by deny", () => {
  const allow = policy("p1", { effect: "allow" });
  const gate = policy("p2", { effect: "require_approval" });
  const deny = policy("p3", { effect: "deny" });

  assert.equal(
    engine.evaluate(useCalculator, context(), [allow, gate]).outcome,
    "require_approval",
  );

  assert.equal(
    engine.evaluate(useCalculator, context(), [gate, deny]).outcome,
    "deny",
  );
});

test("only active policies take part", () => {
  for (const status of ["draft", "paused", "archived"] as const) {
    const decision = engine.evaluate(useCalculator, context(), [
      policy("p1", { status, effect: "deny" }),
    ]);

    assert.equal(decision.outcome, "allow", `${status} must not be enforced`);
  }

  assert.equal(
    engine.evaluate(useCalculator, context(), [
      policy("p1", { status: "active", effect: "deny" }),
    ]).outcome,
    "deny",
  );
});

test("another organization's policy never applies", () => {
  const foreign = policy("p1", {
    organizationId: otherOrganizationId,
    effect: "deny",
  });

  assert.equal(engine.evaluate(useCalculator, context(), [foreign]).outcome, "allow");
});

test("a tool policy does not govern a whole step, and vice versa", () => {
  const toolRule = policy("p1", { subject: "tool", effect: "deny" });
  const taskRule = policy("p2", { subject: "task", effect: "deny" });

  const step: GovernanceAction = {
    kind: "task",
    title: "Work out the runway",
    requiredTools: ["calculator"],
  };

  assert.equal(engine.evaluate(step, context(), [toolRule]).outcome, "allow");
  assert.equal(engine.evaluate(step, context(), [taskRule]).outcome, "deny");
  assert.equal(engine.evaluate(useCalculator, context(), [taskRule]).outcome, "allow");
});

test("an empty scope means the whole company, not nothing", () => {
  const rule = policy("p1", {
    scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [] },
    effect: "require_approval",
  });

  const decision = engine.evaluate(useCalculator, context(), [rule]);

  assert.equal(decision.outcome, "require_approval");
  assert.match(decision.reasons[0]!.explanation, /whole company/);
});

test("agent scope narrows to the named agents only", () => {
  const rule = policy("p1", {
    scope: {
      agentIds: ["peter" as AgentId],
      toolIds: [],
      workspaceIds: [],
      capabilities: [],
    },
    effect: "deny",
  });

  assert.equal(engine.evaluate(useCalculator, context(), [rule]).outcome, "allow");

  assert.equal(
    engine.evaluate(
      useCalculator,
      context({ agentId: "peter" as AgentId }),
      [rule],
    ).outcome,
    "deny",
  );
});

test("capability scope follows the discipline rather than the roster", () => {
  const rule = policy("p1", {
    name: "Financial work is supervised",
    scope: {
      agentIds: [],
      toolIds: [],
      workspaceIds: [],
      capabilities: ["financial_analysis"],
    },
    effect: "require_approval",
  });

  const decision = engine.evaluate(useCalculator, context(), [rule]);

  assert.equal(decision.outcome, "require_approval");
  assert.match(decision.reasons[0]!.explanation, /holds financial_analysis/);

  // An agent without the capability is untouched by the same rule.
  assert.equal(
    engine.evaluate(
      useCalculator,
      context({ agentCapabilities: ["writing"] }),
      [rule],
    ).outcome,
    "allow",
  );
});

test("workspace scope only applies inside that workspace", () => {
  const rule = policy("p1", {
    scope: {
      agentIds: [],
      toolIds: [],
      workspaceIds: ["engineering" as WorkspaceId],
      capabilities: [],
    },
    effect: "deny",
  });

  assert.equal(engine.evaluate(useCalculator, context(), [rule]).outcome, "allow");

  assert.equal(
    engine.evaluate(
      useCalculator,
      context({ workspaceId: "engineering" as WorkspaceId }),
      [rule],
    ).outcome,
    "deny",
  );
});

test("scope dimensions combine with and, not or", () => {
  const rule = policy("p1", {
    scope: {
      agentIds: ["harvey" as AgentId],
      toolIds: ["json_transform"],
      workspaceIds: [],
      capabilities: [],
    },
    effect: "deny",
  });

  // Right agent, wrong tool: the policy must not fire.
  assert.equal(engine.evaluate(useCalculator, context(), [rule]).outcome, "allow");

  assert.equal(
    engine.evaluate(
      { kind: "tool", toolId: "json_transform" },
      context(),
      [rule],
    ).outcome,
    "deny",
  );
});

test("a step is governed by the tools its plan says it needs", () => {
  const rule = policy("p1", {
    subject: "task",
    scope: {
      agentIds: [],
      toolIds: ["calculator"],
      workspaceIds: [],
      capabilities: [],
    },
    effect: "require_approval",
  });

  assert.equal(
    engine.evaluate(
      { kind: "task", title: "Run the numbers", requiredTools: ["calculator"] },
      context(),
      [rule],
    ).outcome,
    "require_approval",
  );

  assert.equal(
    engine.evaluate(
      { kind: "task", title: "Write it up", requiredTools: ["datetime"] },
      context(),
      [rule],
    ).outcome,
    "allow",
  );
});

test("risk is the worst of the tool's own and every policy that matched", () => {
  const decision = engine.evaluate(
    { kind: "tool", toolId: "calculator", toolRisk: "low" },
    context(),
    [
      policy("p1", { effect: "allow", risk: "medium" }),
      policy("p2", { effect: "allow", risk: "critical" }),
    ],
  );

  assert.equal(decision.risk, "critical");
});

test("an ungoverned tool keeps the risk the registry gave it", () => {
  assert.equal(
    engine.evaluate(
      { kind: "tool", toolId: "shell", toolRisk: "high" },
      context(),
      [],
    ).risk,
    "high",
  );
});

test("the approval prompt comes from the policy that required it", () => {
  const rule = policy("p1", {
    effect: "require_approval",
    approvalPrompt: "Confirm the figures before this is sent anywhere.",
  });

  assert.equal(
    engine.evaluate(useCalculator, context(), [rule]).approvalPrompt,
    "Confirm the figures before this is sent anywhere.",
  );
});

test("a policy without a prompt falls back to its description", () => {
  const rule = policy("p1", {
    effect: "require_approval",
    description: "Money leaving the company is a person's decision.",
  });

  assert.equal(
    engine.evaluate(useCalculator, context(), [rule]).approvalPrompt,
    "Money leaving the company is a person's decision.",
  );
});

test("an allow decision carries no approval prompt", () => {
  const rule = policy("p1", {
    effect: "allow",
    approvalPrompt: "should never be shown",
  });

  assert.equal(
    engine.evaluate(useCalculator, context(), [rule]).approvalPrompt,
    undefined,
  );
});

test("two equally strong policies resolve the same way every time", () => {
  const first = policy("aaa", { name: "A", effect: "deny", risk: "high" });
  const second = policy("bbb", { name: "B", effect: "deny", risk: "high" });

  const forward = engine.evaluate(useCalculator, context(), [first, second]);
  const reverse = engine.evaluate(useCalculator, context(), [second, first]);

  assert.equal(forward.decidingPolicyId, reverse.decidingPolicyId);
  assert.equal(forward.decidingPolicyId, "aaa");
});

test("the summary mentions the other policies that applied", () => {
  const decision = engine.evaluate(useCalculator, context(), [
    policy("p1", { name: "Primary", effect: "deny" }),
    policy("p2", { name: "Secondary", effect: "require_approval" }),
  ]);

  assert.match(decision.summary, /1 other policy also applied/);
});
