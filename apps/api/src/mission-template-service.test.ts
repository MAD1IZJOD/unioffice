import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  Event,
  OrganizationId,
  Policy,
  PolicyId,
  UserId,
  Work,
  WorkId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
  EventRepository,
  PolicyRepository,
  WorkRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import { WorkApplicationService } from "./application.js";
import { EventRecorder } from "./event-recorder.js";
import {
  composeBriefing,
  MissionTemplateNotFoundError,
  MissionTemplateService,
  MissionTemplateValidationError,
  TEMPLATE_INPUT_LIMITS,
} from "./mission-template-service.js";
import { findMissionTemplate, MISSION_TEMPLATES } from "./mission-templates.js";

const orgA = "aaaaaaaa-0000-0000-0000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-0000-0000-000000000002" as OrganizationId;
const requesterId = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09" as UserId;
const finance = "f0000000-0000-0000-0000-00000000000f" as WorkspaceId;
const archived = "a0000000-0000-0000-0000-00000000000a" as WorkspaceId;
const foreign = "b0000000-0000-0000-0000-00000000000b" as WorkspaceId;
const now = new Date("2026-09-13T12:00:00Z");

function agent(id: string, overrides: Partial<Agent>): Agent {
  return {
    id: id as AgentId,
    organizationId: orgA,
    name: id,
    description: "Test agent.",
    type: "specialist",
    status: "active",
    capabilities: [],
    toolIds: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function policy(id: string, overrides: Partial<Policy>): Policy {
  return {
    id: id as PolicyId,
    organizationId: orgA,
    name: id,
    description: "",
    subject: "task",
    scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [] },
    effect: "require_approval",
    risk: "high",
    status: "active",
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function workspace(id: WorkspaceId, organizationId: OrganizationId, status: Workspace["status"] = "active"): Workspace {
  return { id, organizationId, name: id, slug: id, status, createdAt: now, updatedAt: now, metadata: {} };
}

function setup(options: { agents?: Agent[]; policies?: Policy[] } = {}) {
  const works = new Map<WorkId, Work>();
  const events: Event[] = [];

  const agents = options.agents ?? [
    agent("tyrion", { name: "Tyrion", type: "orchestrator", capabilities: ["planning", "coordination"] }),
    agent("harvey", { name: "Harvey", capabilities: ["calculation", "financial_analysis", "decision_support"], toolIds: ["calculator"] }),
    agent("mike", { name: "Mike", capabilities: ["research", "synthesis", "writing"] }),
    agent("peter", { name: "Peter", capabilities: ["communication", "stakeholder_messaging", "writing"] }),
    agent("jamie", { name: "Jamie", capabilities: ["people_operations", "process_design", "writing"] }),
    agent("paused", { name: "Paused", status: "paused", capabilities: ["financial_analysis"] }),
    agent("outsider", { name: "Outsider", organizationId: orgB, capabilities: ["financial_analysis", "calculation"] }),
  ];
  const policies = options.policies ?? [];
  const workspaces = new Map<string, Workspace>([
    [finance, workspace(finance, orgA)],
    [archived, workspace(archived, orgA, "archived")],
    [foreign, workspace(foreign, orgB)],
  ]);

  const workRepository = {
    async create(work: Work) { works.set(work.id, work); return work; },
    async findById(id: WorkId) { return works.get(id) ?? null; },
  } as unknown as WorkRepository;
  const eventRepository: EventRepository = {
    async create(event) { events.push(event); return event; },
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  };
  const agentRepository = {
    async findByOrganization(organizationId: OrganizationId) {
      // Deliberately returns every organization's agents: the service must
      // not rely on the repository alone to keep another tenant out.
      return organizationId ? agents : [];
    },
  } as unknown as AgentRepository;
  const workspaceRepository = {
    async findById(id: WorkspaceId) { return workspaces.get(id) ?? null; },
  } as unknown as WorkspaceRepository;
  const policyRepository = {
    async findEnforced() { return policies; },
  } as unknown as PolicyRepository;

  const service = new MissionTemplateService(
    new WorkApplicationService(workRepository, new EventRecorder(eventRepository)),
    agentRepository,
    workspaceRepository,
    policyRepository,
  );

  return { service, works, events };
}

const validInput = {
  organizationId: orgA,
  requesterId,
  templateId: "prepare-a-financial-review",
  name: "Q3 cost review",
  objective: "Review Q3 operating costs against revenue and projected runway.",
  context: "Salaries 48,200 a month, cloud 9,350, lease 12,500. Revenue 61,000. Cash 900,000.",
  desiredOutcome: "Monthly burn, months of runway and the costs that matter most.",
  constraints: "Assume no new hires.",
  priority: "high" as const,
};

/* --------------------------------------------------------------------------
   The catalogue
   -------------------------------------------------------------------------- */

test("the catalogue holds the six system templates, each with a stable id and version", () => {
  assert.deepEqual(MISSION_TEMPLATES.map((template) => template.id), [
    "launch-a-product",
    "research-a-market",
    "prepare-a-financial-review",
    "run-a-hiring-process",
    "prepare-a-stakeholder-update",
    "investigate-a-business-problem",
  ]);
  assert.ok(MISSION_TEMPLATES.every((template) => /^[a-z0-9-]+$/.test(template.id) && template.version >= 1));
  assert.equal(findMissionTemplate("../../etc/passwd"), undefined);
});

test("the likely team comes from the real roster by capability, never from the template naming agents", async () => {
  const { service } = setup();

  const review = await service.getTemplate(orgA, "prepare-a-financial-review");
  const hiring = await service.getTemplate(orgA, "run-a-hiring-process");

  assert.equal(review.likelyTeam[0]!.name, "Harvey");
  assert.deepEqual(review.likelyTeam[0]!.matchedCapabilities, ["financial_analysis", "calculation", "decision_support"]);
  assert.equal(review.planner?.name, "Tyrion");
  assert.ok(hiring.likelyTeam.some((member) => member.name === "Jamie"));

  for (const view of await service.listTemplates(orgA)) {
    assert.ok(!view.likelyTeam.some((member) => member.name === "Paused"), "paused agents are not offered");
    assert.ok(!view.likelyTeam.some((member) => member.name === "Outsider"), "another organization's agents never appear");
    assert.ok(!view.likelyTeam.some((member) => member.name === "Tyrion"), "the planner is named separately");
  }
});

test("a template whose disciplines nobody holds shows an empty team rather than an invented one", async () => {
  const { service } = setup({ agents: [agent("tyrion", { name: "Tyrion", type: "orchestrator" })] });

  const view = await service.getTemplate(orgA, "launch-a-product");

  assert.deepEqual(view.likelyTeam, []);
  assert.equal(view.planner?.name, "Tyrion");
});

test("the approval signal lists only active rules that could reach this template's team", async () => {
  const { service } = setup({
    policies: [
      policy("Finance steps need a person", { scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: ["financial_analysis"] } }),
      policy("Draft rule", { status: "draft" }),
      policy("Allow everything", { effect: "allow" }),
      policy("Other org rule", { organizationId: orgB }),
      policy("Knowledge rule", { subject: "knowledge_recall", effect: "deny" }),
      policy("No calculator", { subject: "tool", effect: "deny", scope: { agentIds: [], toolIds: ["calculator"], workspaceIds: [], capabilities: [] } }),
    ],
  });

  const review = await service.getTemplate(orgA, "prepare-a-financial-review");
  const hiring = await service.getTemplate(orgA, "run-a-hiring-process");

  assert.deepEqual(
    review.governance.gatingPolicies.map((entry) => entry.name).sort(),
    ["Finance steps need a person", "No calculator"],
  );
  assert.deepEqual(hiring.governance.gatingPolicies, [], "no finance agent, no calculator holder on a hiring team");
});

test("an unknown template is not found, however the id is shaped", async () => {
  const { service } = setup();

  for (const id of ["nope", "LAUNCH-A-PRODUCT", "launch-a-product/../x", ""]) {
    await assert.rejects(service.getTemplate(orgA, id), MissionTemplateNotFoundError);
    await assert.rejects(service.startMission({ ...validInput, templateId: id }), MissionTemplateNotFoundError);
  }
});

/* --------------------------------------------------------------------------
   Starting a mission
   -------------------------------------------------------------------------- */

test("starting a template creates ordinary queued work with the template's briefing", async () => {
  const { service, works, events } = setup();

  const work = await service.startMission({ ...validInput, workspaceId: finance });

  assert.equal(works.size, 1);
  assert.equal(work.status, "queued", "nothing is planned or executed by starting a template");
  assert.equal(work.organizationId, orgA);
  assert.equal(work.requesterId, requesterId);
  assert.equal(work.objective, validInput.objective);
  assert.equal(work.priority, "high");
  assert.equal(work.workspaceId, finance);
  assert.deepEqual(work.metadata.template, { id: "prepare-a-financial-review", version: 1, name: "Prepare a Financial Review" });
  assert.equal(work.metadata.missionName, "Q3 cost review");

  const briefing = String(work.metadata.briefing);
  assert.match(briefing, /^Mission type: Prepare a Financial Review\./);
  assert.match(briefing, /Desired outcome: Monthly burn/);
  assert.match(briefing, /Context from the requester:\nSalaries 48,200/);
  assert.match(briefing, /Constraints \(binding\):\nAssume no new hires\./);
  assert.match(briefing, /guidance, not a fixed plan/);

  assert.deepEqual(events.map((event) => event.type), ["work.created"]);
});

test("optional fields may be left out, and are then absent from the briefing", async () => {
  const { service } = setup();

  const work = await service.startMission({
    organizationId: orgA,
    requesterId,
    templateId: "research-a-market",
    objective: "Assess the market for AI scheduling tools for clinics.",
    desiredOutcome: "Whether to enter it this year.",
  });

  assert.equal(work.metadata.missionName, undefined);
  assert.doesNotMatch(String(work.metadata.briefing), /Context from the requester|Constraints|Mission name/);
});

test("missing or too-short required inputs are refused", async () => {
  const { service, works } = setup();

  await assert.rejects(service.startMission({ ...validInput, objective: "   " }), /objective is required/);
  await assert.rejects(service.startMission({ ...validInput, objective: "short" }), /objective is required/);
  await assert.rejects(service.startMission({ ...validInput, desiredOutcome: "" }), /desiredOutcome is required/);
  assert.equal(works.size, 0);
});

test("oversized inputs are refused rather than silently cut", async () => {
  const { service, works } = setup();

  for (const [field, limit] of Object.entries(TEMPLATE_INPUT_LIMITS)) {
    await assert.rejects(
      service.startMission({ ...validInput, [field]: "x".repeat(limit + 1) }),
      new RegExp(`${field} must be ${limit} characters or fewer`),
    );
  }

  assert.equal(works.size, 0);
});

test("non-text inputs are refused", async () => {
  const { service } = setup();

  await assert.rejects(
    service.startMission({ ...validInput, context: { $gt: "" } as unknown as string }),
    MissionTemplateValidationError,
  );
});

test("a workspace from another organization reads as not found, and an archived one is refused", async () => {
  const { service, works } = setup();

  await assert.rejects(service.startMission({ ...validInput, workspaceId: foreign }), /Workspace not found/);
  await assert.rejects(
    service.startMission({ ...validInput, workspaceId: "99999999-9999-9999-9999-999999999999" as WorkspaceId }),
    /Workspace not found/,
  );
  await assert.rejects(service.startMission({ ...validInput, workspaceId: archived }), /archived/);
  assert.equal(works.size, 0);
});

test("fields a caller has no say over are never read, whatever is sent", async () => {
  const { service } = setup();

  const work = await service.startMission({
    ...validInput,
    // Everything below arrives in the input object and must be ignored.
    status: "completed",
    metadata: { approval: { status: "approved" }, routing: { requiredTools: ["shell"] } },
    agentIds: ["harvey"],
    tasks: [{ title: "Pre-written task" }],
    approvalId: "11111111-1111-1111-1111-111111111111",
    template: { id: "evil", version: 99 },
  } as unknown as typeof validInput);

  assert.equal(work.status, "queued");
  assert.deepEqual(Object.keys(work.metadata).sort(), ["briefing", "missionName", "template"]);
  assert.deepEqual(work.metadata.template, { id: "prepare-a-financial-review", version: 1, name: "Prepare a Financial Review" });
});

test("invisible characters used to hide text are removed before the planner ever reads it", async () => {
  const { service } = setup();
  const hidden = String.fromCharCode(0x200b);
  const nul = String.fromCharCode(0);

  const work = await service.startMission({
    ...validInput,
    context: `Salaries 48,200${nul} a month.${hidden} Revenue 61,000.`,
  });

  assert.match(String(work.metadata.briefing), /Salaries 48,200 a month\. Revenue 61,000\./);
  assert.ok(!String(work.metadata.briefing).includes(hidden));
});

test("the briefing never exceeds the existing briefing limit", () => {
  const template = findMissionTemplate("launch-a-product")!;

  const briefing = composeBriefing(template, {
    name: "n".repeat(TEMPLATE_INPUT_LIMITS.name),
    desiredOutcome: "o".repeat(TEMPLATE_INPUT_LIMITS.desiredOutcome),
    context: "c".repeat(TEMPLATE_INPUT_LIMITS.context),
    constraints: "k".repeat(TEMPLATE_INPUT_LIMITS.constraints),
  });

  assert.ok(briefing.length <= 4_000, `briefing was ${briefing.length} characters`);
});
