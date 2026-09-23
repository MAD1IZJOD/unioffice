import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  KnowledgeConflict,
  KnowledgeConflictId,
  KnowledgeRecall,
  MemberId,
  Memory,
  MemoryId,
  OrganizationId,
  OrganizationRole,
  Policy,
  PolicyId,
  Task,
  TaskId,
  UserId,
  Work,
  WorkId,
  Workspace,
  WorkspaceAccessLevel,
  WorkspaceId,
} from "@unioffice/core";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { MissionIntelligenceService } from "./mission-intelligence-service.js";
import type { Access } from "./access/permissions.js";

/**
 * A mission read three ways, before anyone commits to running it.
 *
 * The thing these tests are really about is that none of it is invented. The
 * brief must not put words in the requester's mouth, the preflight must agree
 * with what the delegator and the governance engine would actually do, and
 * the plan must be the task rows that will really execute - named for a
 * person, with every identifier kept behind the technical disclosure.
 */

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const legal = "10000000-0000-4000-8000-000000000001" as WorkspaceId;
const missionId = "cccccccc-0000-4000-8000-000000000001" as WorkId;
const epoch = new Date("2026-09-21T09:00:00.000Z");

function agent(name: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: `agent-${name.toLowerCase()}` as AgentId,
    organizationId: orgA,
    name,
    description: `${name} does the work.`,
    type: "specialist",
    status: "active",
    capabilities: ["calculation", "financial_analysis"],
    toolIds: ["calculator"],
    skills: ["financial-analysis"],
    createdAt: epoch,
    updatedAt: epoch,
    metadata: { systemInstructions: "This must never leave the server." },
    ...overrides,
  };
}

function work(overrides: Partial<Work> = {}): Work {
  return {
    id: missionId,
    organizationId: orgA,
    requesterId: "11111111-0000-4000-8000-000000000001" as UserId,
    objective: "Decide whether the laptop upgrade is worth it.",
    status: "queued",
    priority: "normal",
    createdAt: epoch,
    updatedAt: epoch,
    metadata: { plan: { taskCount: 2, knowledge: { recalled: [], withheldByPolicy: 0 } } },
    ...overrides,
  };
}

/** A task row exactly as work-service writes one after routing a step. */
function task(
  id: string,
  title: string,
  assignedTo: string,
  overrides: {
    dependsOn?: string[];
    requiredTools?: string[];
    requiredCapabilities?: string[];
    skill?: { slug: string; name: string; version: number; scope: "system" | "organization" | "workspace" };
    skillNote?: string;
    approval?: { required: boolean; reason?: string };
    unmatchedCapabilities?: string[];
    selectionReason?: string;
  } = {},
): Task {
  return {
    id: id as TaskId,
    workId: missionId,
    title,
    description: `${title} in detail.`,
    status: "pending",
    assignedAgentId: assignedTo as AgentId,
    dependsOn: (overrides.dependsOn ?? []) as TaskId[],
    createdAt: epoch,
    updatedAt: epoch,
    metadata: {
      approval: overrides.approval?.required
        ? { required: true, reason: overrides.approval.reason, status: "not_requested" }
        : undefined,
      routing: {
        requiredTools: overrides.requiredTools ?? ["calculator"],
        requiredCapabilities: overrides.requiredCapabilities ?? ["financial_analysis"],
        skill: overrides.skill ?? {
          ref: "system:financial-analysis",
          slug: "financial-analysis",
          name: "Financial analysis",
          version: 1,
          scope: "system",
          approval: "none",
        },
        skillNote: overrides.skillNote,
      },
      delegation: {
        delegation: "capability_ranked",
        selectionReason: overrides.selectionReason
          ?? "Selected by deterministic rank: exact workspace compatibility, 1 required capability matches, compatible agent type, and availability score 100. It satisfies every required capability: financial_analysis. It is authorized for the required tool(s): calculator.",
        unmatchedCapabilities: overrides.unmatchedCapabilities ?? [],
        score: { workspace: 2, capabilities: 1, agentType: 0, availability: 100 },
      },
    },
  };
}

function workspace(id: WorkspaceId, name: string): Workspace {
  return {
    id,
    organizationId: orgA,
    name,
    slug: name.toLowerCase(),
    description: "",
    status: "active",
    createdAt: epoch,
    updatedAt: epoch,
    metadata: {},
  } as Workspace;
}

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: "policy-1" as PolicyId,
    organizationId: orgA,
    name: "Calculator needs a person",
    description: "",
    subject: "tool",
    effect: "require_approval",
    risk: "medium",
    status: "active",
    mode: "enforced",
    scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [] },
    createdAt: epoch,
    updatedAt: epoch,
    metadata: {},
    ...overrides,
  } as Policy;
}

function access(
  role: OrganizationRole = "owner",
  workspaces: Array<[WorkspaceId, WorkspaceAccessLevel]> = [],
): Access {
  return {
    userId: "11111111-0000-4000-8000-000000000001" as UserId,
    email: "someone@example.test",
    organizationId: orgA,
    memberId: "00000000-0000-4000-8000-000000000001" as MemberId,
    role,
    workspaces: new Map(workspaces),
  };
}

function service(options: {
  tasks?: Task[];
  agents?: Agent[];
  workspaces?: Workspace[];
  policies?: Policy[];
  /** The records planning wrote when it was handed company knowledge. */
  recalls?: KnowledgeRecall[];
  memories?: Memory[];
  conflicts?: KnowledgeConflict[];
  /** A knowledge store that will not answer. */
  knowledgeFails?: boolean;
  /** No knowledge store at all, as an older deployment has. */
  withoutKnowledge?: boolean;
} = {}) {
  const knowledge = options.withoutKnowledge
    ? {}
    : {
        recalls: {
          async findRecallsByWork() {
            if (options.knowledgeFails) throw new Error("The knowledge store did not answer.");
            return options.recalls ?? [];
          },
          async findConflicts() { return options.conflicts ?? []; },
        },
        memories: {
          async findByIds(_organizationId: OrganizationId, ids: MemoryId[]) {
            return (options.memories ?? []).filter((row) => ids.includes(row.id));
          },
        },
      };

  return new MissionIntelligenceService({
    tasks: { async findByWork() { return options.tasks ?? []; } },
    agents: { async findByOrganization() { return options.agents ?? [agent("Harvey")]; } },
    workspaces: { async findByOrganization() { return options.workspaces ?? []; } },
    policies: { async findEnforced() { return options.policies ?? []; } },
    tools: createDefaultToolRegistry(),
    ...knowledge,
    now: () => epoch,
  });
}

function memory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id: id as MemoryId,
    organizationId: orgA,
    scope: "company",
    type: "fact",
    status: "active",
    title: `Knowledge ${id}`,
    content: `What the company knows, as ${id}.`,
    sourceType: "task",
    importance: 0.6,
    createdAt: new Date("2026-09-12T10:00:00.000Z"),
    updatedAt: new Date("2026-09-12T10:00:00.000Z"),
    metadata: {},
    ...overrides,
  };
}

function recall(memoryId: string, rank: number, overrides: Partial<KnowledgeRecall> = {}): KnowledgeRecall {
  return {
    id: `recall-${memoryId}-${rank}` as KnowledgeRecall["id"],
    organizationId: orgA,
    memoryId: memoryId as MemoryId,
    workId: missionId,
    stage: "planning",
    rank,
    score: 1 - rank / 10,
    reasons: ["matches the objective"],
    recalledAt: epoch,
    ...overrides,
  };
}

const twoStepPlan = [
  task("task-1", "Work out the total cost", "agent-harvey"),
  task("task-2", "Write the recommendation", "agent-harvey", { dependsOn: ["task-1"] }),
];

const checkOf = (result: { preflight: { checks: Array<{ id: string }> } }, id: string) =>
  result.preflight.checks.find((check) => check.id === id) as never as
    { id: string; state: string; summary: string; steps: number[]; fix?: { label: string; path: string } } | undefined;

/* --------------------------------------------------------------------------
   Brief
   -------------------------------------------------------------------------- */

test("the brief repeats what the person asked for without rewriting it", async () => {
  const requested = work({ metadata: { briefing: "Only the Bangalore team.", plan: { taskCount: 2 } } });
  const result = await service({ tasks: twoStepPlan }).getIntelligence(access(), requested);

  assert.equal(result.brief.objective, "Decide whether the laptop upgrade is worth it.");
  assert.equal(result.brief.briefing, "Only the Bangalore team.");
  assert.equal(result.brief.title, "Decide whether the laptop upgrade is worth it.");
  assert.equal(result.brief.titleSource, "requested");
});

test("success criteria and participants come from the plan, never from nowhere", async () => {
  const result = await service({ tasks: twoStepPlan }).getIntelligence(access(), work());

  assert.deepEqual(
    result.brief.successCriteria,
    [
      { text: "Work out the total cost", source: "planned" },
      { text: "Write the recommendation", source: "planned" },
    ],
  );
  assert.deepEqual(result.brief.workAreas, ["Financial analysis"]);
  assert.deepEqual(
    result.brief.participants.map((entry) => ({ name: entry.name, role: entry.role })),
    [{ name: "Harvey", role: "Financial analysis" }],
  );
});

test("a mission with no plan yet claims nothing about how it will be done", async () => {
  const result = await service({ tasks: [] }).getIntelligence(access(), work({ metadata: {} }));

  assert.equal(result.stage, "awaiting_plan");
  assert.equal(result.plan, null);
  assert.deepEqual(result.brief.successCriteria, []);
  assert.deepEqual(result.brief.participants, []);
  assert.deepEqual(result.brief.gaps, []);
  assert.equal(result.brief.objective, "Decide whether the laptop upgrade is worth it.");
});

test("a gap is only ever something the system itself recorded", async () => {
  const stretched = [
    task("task-1", "Work out the total cost", "agent-harvey", {
      unmatchedCapabilities: ["market_research"],
      skillNote: "Market research is active, but no agent available to this mission holds it.",
    }),
  ];

  const result = await service({ tasks: stretched }).getIntelligence(access(), work());

  assert.ok(result.brief.gaps.some((gap) => gap.includes("no agent available to this mission holds it")));
  assert.ok(result.brief.gaps.some((gap) => gap.includes("Harvey is the closest match") && gap.includes("market research")));
});

test("having recalled nothing is reported as a gap, because it limits the answer", async () => {
  const result = await service({ tasks: twoStepPlan })
    .getIntelligence(access(), work({ metadata: { plan: { taskCount: 2 } } }));

  assert.ok(result.brief.gaps.some((gap) => gap.includes("had nothing recorded about this yet")));
});

/* --------------------------------------------------------------------------
   Preflight
   -------------------------------------------------------------------------- */

test("a mission whose every requirement is met reads as ready", async () => {
  const result = await service({ tasks: twoStepPlan }).getIntelligence(access(), work());

  assert.equal(result.stage, "planned");
  assert.equal(result.preflight.state, "ready");
  assert.equal(result.preflight.canStart, true);
  assert.equal(checkOf(result, "workforce")!.state, "ok");
  assert.equal(checkOf(result, "tools")!.state, "ok");
});

test("an agent that lost the tool the step needs blocks the mission and names the tool", async () => {
  const result = await service({ tasks: twoStepPlan, agents: [agent("Harvey", { toolIds: [] })] })
    .getIntelligence(access(), work());

  assert.equal(result.preflight.state, "blocked");
  assert.equal(result.preflight.canStart, false);

  const tools = checkOf(result, "tools")!;
  assert.equal(tools.state, "blocked");
  assert.equal(tools.summary, "Harvey is not authorized for Calculator.");
  assert.deepEqual(tools.steps, [1, 2]);
});

test("an agent that lost a capability blocks the mission", async () => {
  const result = await service({ tasks: twoStepPlan, agents: [agent("Harvey", { capabilities: ["calculation"] })] })
    .getIntelligence(access(), work());

  assert.equal(result.preflight.state, "blocked");
  assert.equal(checkOf(result, "capabilities")!.summary, "Harvey no longer has financial analysis.");
});

test("an agent that lost the skill the step was planned around blocks the mission", async () => {
  const result = await service({ tasks: twoStepPlan, agents: [agent("Harvey", { skills: [] })] })
    .getIntelligence(access(), work());

  assert.equal(result.preflight.state, "blocked");
  assert.match(checkOf(result, "skills")!.summary, /Harvey no longer holds Financial analysis/);
});

test("an agent who has stopped working blocks the mission, as the delegator would", async () => {
  const result = await service({ tasks: twoStepPlan, agents: [agent("Harvey", { status: "paused" })] })
    .getIntelligence(access(), work());

  assert.equal(result.preflight.state, "blocked");
  assert.match(checkOf(result, "workforce")!.summary, /Harvey is paused/);
});

test("an agent removed from the company blocks the mission rather than being ignored", async () => {
  const result = await service({ tasks: twoStepPlan, agents: [] }).getIntelligence(access(), work());

  assert.equal(result.preflight.state, "blocked");
  assert.match(checkOf(result, "workforce")!.summary, /no longer works here/);
});

test("an agent that cannot work where the mission runs blocks it, exactly as routing would", async () => {
  const result = await service({
    tasks: twoStepPlan,
    agents: [agent("Harvey", { workspaceId: legal })],
    workspaces: [workspace(finance, "Finance"), workspace(legal, "Legal")],
  }).getIntelligence(access(), work({ workspaceId: finance }));

  assert.equal(result.preflight.state, "blocked");
  assert.match(checkOf(result, "workforce")!.summary, /does not work where this mission runs/);
});

test("a rule that refuses a tool blocks the mission and points at the rules", async () => {
  const result = await service({
    tasks: twoStepPlan,
    policies: [policy({ effect: "deny", name: "No calculator" })],
  }).getIntelligence(access(), work());

  assert.equal(result.preflight.state, "blocked");

  const rules = checkOf(result, "governance")!;
  assert.equal(rules.state, "blocked");
  assert.match(rules.summary, /A company rule refuses Calculator for Harvey/);
  assert.deepEqual(rules.fix, { label: "Company rules", path: "/governance" });
});

test("a rule that asks for a person is reported without blocking anything", async () => {
  const result = await service({ tasks: twoStepPlan, policies: [policy()] }).getIntelligence(access(), work());

  assert.equal(result.preflight.state, "ready");
  assert.match(checkOf(result, "governance")!.summary, /puts you in front of Calculator/);
});

test("steps that will stop for a person are counted and named by number", async () => {
  const needsPerson = [
    task("task-1", "Work out the total cost", "agent-harvey"),
    task("task-2", "Send the recommendation", "agent-harvey", {
      dependsOn: ["task-1"],
      approval: { required: true, reason: "This leaves the company." },
    }),
  ];

  const result = await service({ tasks: needsPerson }).getIntelligence(access(), work());

  const approvals = checkOf(result, "approvals")!;
  assert.equal(approvals.summary, "1 step will wait for your approval.");
  assert.deepEqual(approvals.steps, [2]);
  assert.equal(result.plan!.approvalCount, 1);
});

test("a limitation the planner recorded makes the mission partly ready, not blocked", async () => {
  const limited = [
    task("task-1", "Work out the total cost", "agent-harvey", {
      skillNote: "Market research is active, but no agent available to this mission holds it.",
    }),
  ];

  const result = await service({ tasks: limited }).getIntelligence(access(), work());

  assert.equal(result.preflight.state, "partially_ready");
  assert.equal(result.preflight.canStart, true);
  assert.equal(checkOf(result, "inputs")!.state, "warning");
  assert.match(result.preflight.detail, /It can still run, but the result may be less complete/);
});

test("steps that depend on each other in a circle are reported rather than papered over", async () => {
  const circular = [
    task("task-1", "First", "agent-harvey", { dependsOn: ["task-2"] }),
    task("task-2", "Second", "agent-harvey", { dependsOn: ["task-1"] }),
  ];

  const result = await service({ tasks: circular }).getIntelligence(access(), work());

  assert.equal(result.preflight.state, "blocked");
  assert.equal(result.plan!.hasCycle, true);
  assert.match(checkOf(result, "dependencies")!.summary, /circle/);
});

test("readiness is never claimed while the plan is still being written", async () => {
  const result = await service({ tasks: [] }).getIntelligence(access(), work({ status: "planning" }));

  assert.equal(result.stage, "planning");
  assert.equal(result.preflight.state, "unknown");
  assert.equal(result.preflight.canStart, false);
  assert.deepEqual(result.preflight.checks, []);
});

test("a mission that could not be prepared says so without the backend's own words", async () => {
  const failed = work({
    status: "failed",
    metadata: { planningError: "llama-server process has terminated: exit status 1: ggml_backend_cpu_buffer" },
  });

  const result = await service({ tasks: [] }).getIntelligence(access(), failed);

  assert.equal(result.stage, "planning_failed");
  assert.equal(result.preflight.state, "unknown");
  assert.equal(result.preflight.detail.includes("llama-server"), false);
  assert.equal(result.preflight.detail.includes("ggml"), false);
});

/* --------------------------------------------------------------------------
   RBAC
   -------------------------------------------------------------------------- */

test("a viewer may read the mission but is never offered the start", async () => {
  const result = await service({ tasks: twoStepPlan }).getIntelligence(access("viewer"), work());

  assert.equal(result.preflight.canStart, false);
  assert.match(result.preflight.startNote!, /not start it/);
  assert.equal(checkOf(result, "permissions")!.state, "warning");
});

test("a member may start a mission but is never offered a configuration remedy", async () => {
  const short = service({ tasks: twoStepPlan, agents: [agent("Harvey", { toolIds: [] })] });

  const owner = await short.getIntelligence(access("owner"), work());
  assert.deepEqual(checkOf(owner, "tools")!.fix, { label: "Prepare Harvey", path: "/workforce/agent-harvey" });

  const member = await short.getIntelligence(access("member"), work());
  assert.equal(member.preflight.canStart, false, "blocked for everyone, not only for the member");
  assert.equal(checkOf(member, "tools")!.fix, undefined);

  const ready = await service({ tasks: twoStepPlan }).getIntelligence(access("member"), work());
  assert.equal(ready.preflight.canStart, true);
});

test("a member with only a viewer grant in this workspace cannot start the mission there", async () => {
  const result = await service({
    tasks: twoStepPlan,
    workspaces: [workspace(finance, "Finance")],
  }).getIntelligence(access("member", [[finance, "viewer"]]), work({ workspaceId: finance }));

  assert.equal(result.preflight.canStart, false);
});

/* --------------------------------------------------------------------------
   Plan
   -------------------------------------------------------------------------- */

test("the plan is the task rows, in order, with dependencies kept by number", async () => {
  const result = await service({ tasks: twoStepPlan }).getIntelligence(access(), work());
  const plan = result.plan!;

  assert.deepEqual(plan.steps.map((step) => step.number), [1, 2]);
  assert.deepEqual(plan.steps.map((step) => step.title), ["Work out the total cost", "Write the recommendation"]);
  assert.deepEqual(plan.steps[0]!.dependsOn, []);
  assert.deepEqual(plan.steps[1]!.dependsOn, [1]);
  assert.deepEqual(plan.steps.map((step) => step.lane), [1, 2]);
  assert.deepEqual(plan.expectedOutputs, ["Write the recommendation"]);
});

test("each step names its agent, its ability and its tools as a person would", async () => {
  const result = await service({ tasks: twoStepPlan }).getIntelligence(access(), work());
  const step = result.plan!.steps[0]!;

  assert.deepEqual(step.agent, { id: "agent-harvey", name: "Harvey" });
  assert.equal(step.ability, "Financial analysis");
  assert.deepEqual(step.uses, ["Calculator"]);
});

test("why an agent holds a step is said in plain words, with the machinery kept behind it", async () => {
  const result = await service({ tasks: twoStepPlan }).getIntelligence(access(), work());
  const step = result.plan!.steps[0]!;

  assert.equal(step.why, "Harvey can do what this step calls for and is cleared to use Calculator.");
  assert.equal(step.why.includes("deterministic"), false);
  assert.match(step.technical.selectionReason!, /deterministic rank/);
});

test("a step the planner named an agent for says so rather than claiming a ranking", async () => {
  const explicit = [
    task("task-1", "Work out the total cost", "agent-harvey", {
      selectionReason: "The planner explicitly assigned this active, compatible agent.",
    }),
  ];

  const result = await service({ tasks: explicit }).getIntelligence(access(), work());

  assert.equal(result.plan!.steps[0]!.why, "Harvey was named for this step.");
});

test("an explanation the delegator did not write is left out rather than guessed at", async () => {
  const odd = [task("task-1", "Work out the total cost", "agent-harvey", { selectionReason: "something else entirely" })];
  const result = await service({ tasks: odd }).getIntelligence(access(), work());

  assert.equal(result.plan!.steps[0]!.why, undefined);
});

test("steps that can run at the same time share a lane", async () => {
  const parallel = [
    task("task-1", "Gather the quotes", "agent-harvey"),
    task("task-2", "Gather the usage data", "agent-harvey"),
    task("task-3", "Decide", "agent-harvey", { dependsOn: ["task-1", "task-2"] }),
  ];

  const result = await service({ tasks: parallel }).getIntelligence(access(), work());

  assert.deepEqual(result.plan!.steps.map((step) => step.lane), [1, 1, 2]);
  assert.equal(result.plan!.widestLane, 2);
  assert.deepEqual(result.plan!.steps[2]!.dependsOn, [1, 2]);
});

test("nothing a person is shown carries an id, a score or a secret", async () => {
  const result = await service({ tasks: twoStepPlan }).getIntelligence(access(), work());

  const shown = JSON.stringify({
    brief: result.brief,
    preflight: result.preflight,
    steps: result.plan!.steps.map(({ technical, agent: assigned, ...rest }) => ({ ...rest, agentName: assigned?.name })),
  });

  assert.equal(/task-\d/.test(shown), false, "task ids must not be shown");
  assert.equal(shown.includes("must never leave the server"), false);
  assert.equal(shown.includes("deterministic"), false);
  assert.equal(shown.includes("capability_ranked"), false);
  assert.equal(shown.includes(missionId), false);
});

/* --------------------------------------------------------------------------
   What the company already knew
   -------------------------------------------------------------------------- */

test("the knowledge the plan was built on is shown with where it came from and why", async () => {
  const result = await service({
    tasks: twoStepPlan,
    recalls: [recall("k1", 1, { reasons: ["matches the objective", "established recently"] })],
    memories: [memory("k1", {
      title: "Enterprise contracts run for a minimum of 12 months.",
      type: "fact",
      workId: "dddddddd-0000-4000-8000-000000000009" as WorkId,
      sourceType: "task",
    })],
  }).getIntelligence(access(), work());

  assert.equal(result.knowledge.state, "available");
  assert.equal(result.knowledge.used.length, 1);

  const [used] = result.knowledge.used;
  assert.equal(used!.title, "Enterprise contracts run for a minimum of 12 months.");
  assert.equal(used!.type, "fact");
  assert.equal(used!.status, "active");
  assert.equal(used!.sourceMissionId, "dddddddd-0000-4000-8000-000000000009");
  assert.deepEqual(used!.establishedAt, new Date("2026-09-12T10:00:00.000Z"));
  assert.deepEqual(used!.reasons, ["matches the objective", "established recently"]);
  assert.equal(used!.disputed, false);
});

test("what was recalled keeps the order the planner was given it in", async () => {
  const result = await service({
    tasks: twoStepPlan,
    recalls: [recall("k2", 2), recall("k1", 1), recall("k3", 3)],
    memories: [memory("k1"), memory("k2"), memory("k3")],
  }).getIntelligence(access(), work());

  assert.deepEqual(result.knowledge.used.map((entry) => entry.id), ["k1", "k2", "k3"]);
});

test("knowledge recalled for a step, not for the plan, is not shown as having shaped the plan", async () => {
  const result = await service({
    tasks: twoStepPlan,
    recalls: [recall("k1", 1), recall("k2", 1, { stage: "execution" })],
    memories: [memory("k1"), memory("k2")],
  }).getIntelligence(access(), work());

  assert.deepEqual(result.knowledge.used.map((entry) => entry.id), ["k1"]);
});

test("proposed knowledge is shown as proposed, not quietly as company fact", async () => {
  const result = await service({
    tasks: twoStepPlan,
    recalls: [recall("k1", 1)],
    memories: [memory("k1", { status: "proposed" })],
  }).getIntelligence(access(), work());

  assert.equal(result.knowledge.used[0]?.status, "proposed");
});

test("knowledge the company is still arguing about is marked as disputed", async () => {
  const result = await service({
    tasks: twoStepPlan,
    recalls: [recall("k1", 1), recall("k2", 2)],
    memories: [memory("k1"), memory("k2")],
    conflicts: [{
      id: "9f0c3a1e-0000-4000-8000-00000000000a" as KnowledgeConflictId,
      organizationId: orgA,
      memoryId: "k1" as MemoryId,
      conflictingMemoryId: "k9" as MemoryId,
      reason: "They state different amounts for the same subject.",
      signals: {},
      status: "open",
      detectedAt: epoch,
    }],
  }).getIntelligence(access(), work());

  assert.deepEqual(
    result.knowledge.used.map((entry) => [entry.id, entry.disputed]),
    [["k1", true], ["k2", false]],
  );
});

test("a rule that kept knowledge out of planning is reported, from what the plan recorded", async () => {
  const withheld = work({ metadata: { plan: { taskCount: 2, knowledge: { withheldByPolicy: 2 } } } });

  const result = await service({
    tasks: twoStepPlan,
    recalls: [recall("k1", 1)],
    memories: [memory("k1")],
  }).getIntelligence(access(), withheld);

  assert.equal(result.knowledge.withheldCount, 2);
});

test("a mission with no plan yet says the company has not been asked, not that it knows nothing", async () => {
  const result = await service({ recalls: [recall("k1", 1)], memories: [memory("k1")] })
    .getIntelligence(access(), work());

  assert.equal(result.knowledge.state, "not_planned");
  assert.deepEqual(result.knowledge.used, []);
});

test("a planned mission the company had nothing for says so, and says it was asked", async () => {
  const result = await service({ tasks: twoStepPlan }).getIntelligence(access(), work());

  assert.equal(result.knowledge.state, "available");
  assert.deepEqual(result.knowledge.used, []);
});

test("a knowledge store that will not answer is reported as unreadable, never as an empty company", async () => {
  const result = await service({ tasks: twoStepPlan, knowledgeFails: true })
    .getIntelligence(access(), work());

  assert.equal(result.knowledge.state, "unavailable");
  assert.deepEqual(result.knowledge.used, []);
});

test("a server with no knowledge store still reads the mission", async () => {
  const result = await service({ tasks: twoStepPlan, withoutKnowledge: true })
    .getIntelligence(access(), work());

  assert.equal(result.knowledge.state, "not_planned");
  assert.equal(result.plan?.steps.length, 2);
});

test("knowledge from another organization is never shown, however it was recalled", async () => {
  const result = await service({
    tasks: twoStepPlan,
    recalls: [recall("k1", 1), recall("intruder", 2)],
    memories: [
      memory("k1"),
      memory("intruder", { organizationId: "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId }),
    ],
  }).getIntelligence(access(), work());

  assert.deepEqual(result.knowledge.used.map((entry) => entry.id), ["k1"]);
});

test("knowledge in a workspace the caller was not given is not shown to them", async () => {
  const options = {
    tasks: twoStepPlan,
    recalls: [recall("k1", 1), recall("k2", 2)],
    memories: [memory("k1"), memory("k2", { workspaceId: legal })],
  };

  const narrowed = await service(options).getIntelligence(access("member", [[finance, "member"]]), work());
  const full = await service(options).getIntelligence(access("owner"), work());

  assert.deepEqual(narrowed.knowledge.used.map((entry) => entry.id), ["k1"]);
  assert.deepEqual(full.knowledge.used.map((entry) => entry.id), ["k1", "k2"]);
});

test("the same knowledge recalled for several steps is listed once", async () => {
  const result = await service({
    tasks: twoStepPlan,
    recalls: [recall("k1", 1), recall("k1", 2)],
    memories: [memory("k1")],
  }).getIntelligence(access(), work());

  assert.equal(result.knowledge.used.length, 1);
});
