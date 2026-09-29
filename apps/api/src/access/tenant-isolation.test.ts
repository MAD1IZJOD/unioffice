import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  ApprovalId,
  ApprovalRequest,
  Artifact,
  ArtifactId,
  Event,
  MemberId,
  Memory,
  MemoryId,
  OrganizationId,
  OrganizationRole,
  Task,
  TaskId,
  UserId,
  Work,
  WorkId,
  Workspace,
} from "@unioffice/core";

import {
  InMemoryExecutionJobRepository,
  InMemoryKnowledgeRepository,
  InMemoryMembershipRepository,
  InMemoryOperationalReadRepository,
} from "@unioffice/database";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { CompanyBrainService } from "../company-brain-service.js";
import { EventRecorder } from "../event-recorder.js";
import { ExecutionQueueService } from "../execution-queue-service.js";
import { ExecutionRoomService } from "../execution-room-service.js";
import { GovernanceService } from "../governance-service.js";
import { KnowledgeGovernance } from "../knowledge-governance.js";
import { KnowledgeRecallService } from "../knowledge-recall-service.js";
import { MissionIntelligenceService } from "../mission-intelligence-service.js";
import { buildApiServer, type ApiServices } from "../server.js";
import { WorkApprovalService } from "../work-approval-service.js";
import { WorkQueryService } from "../work-query-service.js";
import { WorkforceService } from "../workforce-service.js";

import { AccessResolver } from "./access-resolver.js";
import type { Identity } from "./authenticator.js";
import { StreamTickets } from "./stream-tickets.js";

/**
 * Two companies on one server, and someone who has only just signed up.
 *
 * The other access tests stand the services in with stubs and check the
 * route hands them the caller's organization. This one keeps the real
 * membership resolver and the real services, over one set of tables holding
 * both companies' rows side by side - the way the service-role database
 * holds them, with nothing below the API to keep them apart. So what is
 * checked is the whole path: token, membership, organization, workspace,
 * and the row.
 *
 * A new sign-in belongs nowhere until someone invites them. It is never
 * placed in a company that happens to exist already, and it is never shown
 * one company's missions, agents, results, approvals or knowledge, whatever
 * id it asks for.
 */

const now = new Date("2026-09-29T09:00:00.000Z");

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;

interface Company {
  organizationId: OrganizationId;
  work: WorkId;
  task: TaskId;
  agent: AgentId;
  artifact: ArtifactId;
  approval: ApprovalId;
  knowledge: MemoryId;
}

const a: Company = {
  organizationId: orgA,
  work: "a1000000-0000-4000-8000-000000000001" as WorkId,
  task: "a2000000-0000-4000-8000-000000000001" as TaskId,
  agent: "a3000000-0000-4000-8000-000000000001" as AgentId,
  artifact: "a4000000-0000-4000-8000-000000000001" as ArtifactId,
  approval: "a5000000-0000-4000-8000-000000000001" as ApprovalId,
  knowledge: "a6000000-0000-4000-8000-000000000001" as MemoryId,
};

const b: Company = {
  organizationId: orgB,
  work: "b1000000-0000-4000-8000-000000000002" as WorkId,
  task: "b2000000-0000-4000-8000-000000000002" as TaskId,
  agent: "b3000000-0000-4000-8000-000000000002" as AgentId,
  artifact: "b4000000-0000-4000-8000-000000000002" as ArtifactId,
  approval: "b5000000-0000-4000-8000-000000000002" as ApprovalId,
  knowledge: "b6000000-0000-4000-8000-000000000002" as MemoryId,
};

/** One company's rows: a planned mission, its agent, a result, a pending approval, a piece of knowledge. */
function rowsOf(company: Company, name: string) {
  const { organizationId } = company;

  const work: Work = {
    id: company.work,
    organizationId,
    requesterId: "11111111-0000-4000-8000-000000000000" as UserId,
    objective: `Close ${name}'s books for September.`,
    status: "queued",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: { plan: { taskCount: 1 } },
  };

  const agent: Agent = {
    id: company.agent,
    organizationId,
    name: `${name}'s Harvey`,
    description: "Finance.",
    type: "specialist",
    status: "active",
    capabilities: ["financial_analysis"],
    toolIds: ["calculator"],
    skills: [],
    createdAt: now,
    updatedAt: now,
    metadata: { systemInstructions: `${name}'s private instructions.` },
  };

  const task: Task = {
    id: company.task,
    workId: company.work,
    title: "Reconcile the ledger",
    description: "Reconcile the ledger.",
    status: "pending",
    assignedAgentId: company.agent,
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    metadata: {
      routing: { requiredTools: ["calculator"], requiredCapabilities: ["financial_analysis"] },
      delegation: { unmatchedCapabilities: [] },
    },
  };

  const artifact = {
    id: company.artifact,
    organizationId,
    workId: company.work,
    taskId: company.task,
    createdByAgentId: company.agent,
    name: `${name}'s ledger summary`,
    type: "report",
    version: 1,
    createdAt: now,
    updatedAt: now,
    metadata: { content: `${name}'s confidential numbers.` },
  } as unknown as Artifact;

  const approval: ApprovalRequest = {
    id: company.approval,
    organizationId,
    workId: company.work,
    taskId: company.task,
    agentId: company.agent,
    action: "tool.execute",
    resource: "calculator",
    reason: `${name}'s step waits for a person.`,
    status: "pending",
    createdAt: now,
    metadata: {},
  };

  const knowledge: Memory = {
    id: company.knowledge,
    organizationId,
    scope: "company",
    type: "fact",
    status: "active",
    title: `${name}'s pricing`,
    content: `${name} charges its own private rate.`,
    sourceType: "task",
    importance: 0.6,
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const event = {
    id: `${company.work.slice(0, 8)}-e000-4000-8000-000000000001`,
    organizationId,
    workId: company.work,
    actorType: "system",
    type: "work.created",
    timestamp: now,
    payload: {},
    metadata: {},
  } as unknown as Event;

  return { work, agent, task, artifact, approval, knowledge, event };
}

/**
 * The tables, as the service role sees them: every company's rows in one
 * place, found by id or by the column a query filters on - nothing more.
 */
async function company() {
  const rows = [rowsOf(a, "Acme"), rowsOf(b, "Borealis")];

  const works = rows.map((row) => row.work);
  const tasks = rows.map((row) => row.task);
  const agents = rows.map((row) => row.agent);
  const artifacts = rows.map((row) => row.artifact);
  const approvals = rows.map((row) => row.approval);
  const events = rows.map((row) => row.event);
  const workspaces: Workspace[] = [];

  const workRepository = {
    async findById(id: WorkId) { return works.find((work) => work.id === id) ?? null; },
    async findByOrganization(organizationId: OrganizationId) { return works.filter((work) => work.organizationId === organizationId); },
    async update(work: Work) { works.splice(works.findIndex((row) => row.id === work.id), 1, work); return work; },
  };
  const taskRepository = {
    async findById(id: TaskId) { return tasks.find((task) => task.id === id) ?? null; },
    async findByWork(workId: WorkId) { return tasks.filter((task) => task.workId === workId); },
    async update(task: Task) { tasks.splice(tasks.findIndex((row) => row.id === task.id), 1, task); return task; },
  };
  const agentRepository = {
    async findById(id: AgentId) { return agents.find((agent) => agent.id === id) ?? null; },
    async findByOrganization(organizationId: OrganizationId) { return agents.filter((agent) => agent.organizationId === organizationId); },
  };
  const artifactRepository = {
    async findById(id: ArtifactId) { return artifacts.find((artifact) => artifact.id === id) ?? null; },
    async findByWork(workId: WorkId) { return artifacts.filter((artifact) => artifact.workId === workId); },
    async findByOrganization(organizationId: OrganizationId) { return artifacts.filter((artifact) => artifact.organizationId === organizationId); },
  };
  const approvalRepository = {
    async findById(id: ApprovalId) { return approvals.find((approval) => approval.id === id) ?? null; },
    async findByWork(workId: WorkId) { return approvals.filter((approval) => approval.workId === workId); },
    async findPendingByOrganization(organizationId: OrganizationId) {
      return approvals.filter((approval) => approval.organizationId === organizationId && approval.status === "pending");
    },
    async resolvePending(id: ApprovalId, status: ApprovalRequest["status"], resolvedBy: string, resolvedAt: Date) {
      const approval = approvals.find((row) => row.id === id && row.status === "pending");
      if (!approval) return null;
      Object.assign(approval, { status, resolvedBy, resolvedAt });
      return approval;
    },
  };
  const eventRepository = {
    async create(event: Event) { events.push(event); return event; },
    async findByWork(workId: WorkId) { return events.filter((event) => event.workId === workId); },
    async findByOrganization(organizationId: OrganizationId) { return events.filter((event) => event.organizationId === organizationId); },
  };
  const workspaceRepository = {
    async findById() { return null; },
    async findByOrganization() { return workspaces; },
  };
  const policies = {
    async create(policy: never) { return policy; },
    async findById() { return null; },
    async findByOrganization() { return []; },
    async findEnforced() { return []; },
    async update(policy: never) { return policy; },
  };

  const knowledge = new InMemoryKnowledgeRepository();
  for (const row of rows) await knowledge.create(row.knowledge);

  const jobs = new InMemoryExecutionJobRepository();
  const tools = createDefaultToolRegistry();
  const eventRecorder = new EventRecorder(eventRepository as never);

  // The real recall, so the "related knowledge" a detail read shows is
  // searched the way it is in production - across the one shared store.
  const recall = new KnowledgeRecallService(
    knowledge,
    knowledge,
    new KnowledgeGovernance(policies, new GovernanceService(policies, tools, eventRecorder)),
    eventRecorder,
    workRepository as never,
    taskRepository as never,
    artifactRepository as never,
  );

  const workQueryService = new WorkQueryService(
    workRepository as never,
    taskRepository as never,
    eventRepository as never,
    artifactRepository as never,
    agentRepository as never,
    approvalRepository as never,
    knowledge,
  );

  const services = {
    authenticator: { verify: async (token: string) => identities.get(token) ?? null },
    accessResolver: new AccessResolver(members, () => now),
    streamTickets: new StreamTickets(),
    workQueryService,
    executionRoomService: new ExecutionRoomService(
      workRepository as never,
      taskRepository as never,
      eventRepository as never,
      artifactRepository as never,
      approvalRepository as never,
      agentRepository as never,
      knowledge,
      workspaceRepository as never,
      jobs,
      tools,
    ),
    missionIntelligenceService: new MissionIntelligenceService({
      tasks: taskRepository,
      agents: agentRepository,
      workspaces: workspaceRepository,
      policies,
      tools,
      jobs,
    }),
    executionQueueService: new ExecutionQueueService(jobs, workRepository as never, taskRepository as never, eventRecorder),
    workApprovalService: new WorkApprovalService(
      approvalRepository as never,
      taskRepository as never,
      workRepository as never,
      eventRecorder,
    ),
    workforceService: new WorkforceService({
      agents: agentRepository,
      reads: new InMemoryOperationalReadRepository(works, tasks, events, artifacts),
      workspaces: workspaceRepository,
      policies,
      tools,
    }),
    companyBrainService: new CompanyBrainService(
      knowledge,
      knowledge,
      recall,
      {} as never,
      eventRecorder,
      workRepository as never,
      taskRepository as never,
      artifactRepository as never,
      workspaceRepository as never,
      agentRepository as never,
    ),
    workRecoveryService: { async retryWork() { throw new Error("retry must not be reached across companies"); } },
    workCancellationService: { async cancelWork() { throw new Error("cancel must not be reached across companies"); } },
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices;

  const app = buildApiServer(services);
  const as = (who: string, url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer token-${who}` } });
  const post = (who: string, url: string, payload: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url, headers: { authorization: `Bearer token-${who}` }, payload });

  return { as, post, approvals, jobs, works };
}

/*
 * The people. Acme's owner has run UNIOFFICE for a while - their company is
 * the one full of test missions. Borealis's owner has a company of their own.
 * The newcomer has just signed in for the first time and belongs nowhere.
 */
const members = new InMemoryMembershipRepository();
const identities = new Map<string, Identity>();

async function person(key: string, organizationId?: OrganizationId, role: OrganizationRole = "owner", emailConfirmed = true) {
  const index = identities.size + 1;
  const suffix = String(index).padStart(12, "0");
  const identity: Identity = {
    userId: `99999999-0000-4000-8000-${suffix}` as UserId,
    email: `${key}@example.test`,
    emailConfirmed,
  };

  identities.set(`token-${key}`, identity);

  if (organizationId) {
    await members.createMember({
      id: `88888888-0000-4000-8000-${suffix}` as MemberId,
      organizationId,
      userId: identity.userId,
      email: identity.email,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }
}

await person("acme", orgA);
await person("borealis", orgB);
await person("newcomer");

const everyMissionRoute = (work: WorkId) => [
  `/work/${work}`,
  `/work/${work}/room`,
  `/work/${work}/intelligence`,
  `/work/${work}/detail`,
  `/work/${work}/tasks`,
  `/work/${work}/events`,
  `/work/${work}/artifacts`,
  `/work/${work}/approvals`,
];

/* --------------------------------------------------------------------------
   Each company sees its own
   -------------------------------------------------------------------------- */

test("each owner lists their own company's missions and nobody else's", async () => {
  const { as } = await company();

  const acme = (await as("acme", "/work")).json().work.map((work: Work) => work.id);
  const borealis = (await as("borealis", "/work")).json().work.map((work: Work) => work.id);

  assert.deepEqual(acme, [a.work]);
  assert.deepEqual(borealis, [b.work]);
});

test("each owner opens every read of their own mission", async () => {
  const { as } = await company();

  for (const url of everyMissionRoute(a.work)) {
    assert.equal((await as("acme", url)).statusCode, 200, `acme ${url}`);
  }

  for (const url of everyMissionRoute(b.work)) {
    assert.equal((await as("borealis", url)).statusCode, 200, `borealis ${url}`);
  }
});

test("each owner sees their own results, approvals, workforce and knowledge only", async () => {
  const { as } = await company();

  const ids = async (who: string, url: string, key: string) =>
    ((await as(who, url)).json()[key] as Array<{ id: string }>).map((row) => row.id);

  assert.deepEqual(await ids("acme", "/artifacts", "artifacts"), [a.artifact]);
  assert.deepEqual(await ids("borealis", "/artifacts", "artifacts"), [b.artifact]);

  assert.deepEqual(await ids("acme", "/approvals", "approvals"), [a.approval]);
  assert.deepEqual(await ids("borealis", "/approvals", "approvals"), [b.approval]);

  assert.deepEqual(await ids("acme", "/agents", "agents"), [a.agent]);
  assert.deepEqual(await ids("borealis", "/agents", "agents"), [b.agent]);

  const roster = async (who: string) =>
    ((await as(who, "/workforce")).json().members as Array<{ id: string }>).map((agent) => agent.id);
  assert.deepEqual(await roster("acme"), [a.agent]);
  assert.deepEqual(await roster("borealis"), [b.agent]);

  const acmeKnowledge = await as("acme", `/knowledge/${a.knowledge}`);
  const borealisKnowledge = await as("borealis", `/knowledge/${b.knowledge}`);
  assert.equal(acmeKnowledge.statusCode, 200);
  assert.equal(borealisKnowledge.statusCode, 200);

  // Both companies wrote about their pricing. Related knowledge is searched
  // across one store, and still only ever finds the caller's own.
  assert.doesNotMatch(acmeKnowledge.body, /Borealis/);
  assert.doesNotMatch(borealisKnowledge.body, /Acme/);
});

/* --------------------------------------------------------------------------
   Nobody reaches the other company, however they ask
   -------------------------------------------------------------------------- */

test("another company's mission does not exist for you, on any read, by id", async () => {
  const { as } = await company();

  for (const url of everyMissionRoute(a.work)) {
    const response = await as("borealis", url);
    assert.equal(response.statusCode, 404, `borealis ${url}`);
    assert.doesNotMatch(response.body, /Acme/, `borealis ${url} says nothing about it`);
  }

  for (const url of everyMissionRoute(b.work)) {
    assert.equal((await as("acme", url)).statusCode, 404, `acme ${url}`);
  }
});

test("another company's mission cannot be started, retried, cancelled or planned", async () => {
  const { post, jobs, works } = await company();

  for (const operation of ["execute", "retry", "cancel", "plan", "launch", "prepare", "acknowledge"]) {
    const response = await post("borealis", `/work/${a.work}/${operation}`);
    assert.equal(response.statusCode, 404, operation);
  }

  assert.equal(await jobs.findActiveByWork(a.work), null, "nothing was queued for Acme's mission");
  assert.equal(works.find((work) => work.id === a.work)?.status, "queued", "and it is exactly as it was");
});

test("another company's approval cannot be read or decided", async () => {
  const { post, approvals } = await company();

  for (const decision of ["approve", "reject"]) {
    const response = await post("borealis", `/approvals/${a.approval}/${decision}`);
    assert.equal(response.statusCode, 404, decision);
  }

  assert.equal(approvals.find((approval) => approval.id === a.approval)?.status, "pending");
});

test("another company's agents, results and knowledge are not found by id", async () => {
  const { as, post } = await company();

  assert.equal((await as("borealis", `/workforce/${a.agent}`)).statusCode, 404, "agent profile");
  assert.equal((await as("borealis", `/knowledge/${a.knowledge}`)).statusCode, 404, "knowledge");
  assert.equal((await post("borealis", `/artifacts/${a.artifact}/knowledge`)).statusCode, 404, "learning from a result");

  const agents = await as("borealis", "/agents");
  assert.doesNotMatch(agents.body, /Acme|private instructions/);
});

test("naming the other company outright is refused, as if it did not exist", async () => {
  const { as } = await company();

  for (const url of ["/work", "/agents", "/approvals", "/artifacts", "/workforce", "/knowledge/overview", `/work/${a.work}`]) {
    const joiner = url.includes("?") ? "&" : "?";
    const response = await as("borealis", `${url}${joiner}organizationId=${orgA}`);
    assert.equal(response.statusCode, 404, url);
    assert.equal(response.json().error.message, "Organization not found.", url);
  }
});

/* --------------------------------------------------------------------------
   Someone new
   -------------------------------------------------------------------------- */

test("a first sign-in belongs nowhere: it is told so, and handed no company", async () => {
  const { as } = await company();

  const me = (await as("newcomer", "/me")).json();

  assert.equal(me.standing, "none");
  assert.equal(me.organization, null);
  assert.deepEqual(me.memberships, []);

  // Not even by naming the company that has been there longest.
  const named = (await as("newcomer", `/me?organizationId=${orgA}`)).json();
  assert.equal(named.organization, null);
});

test("a first sign-in is shown none of anyone's missions, agents, results, approvals or knowledge", async () => {
  const { as, post, jobs } = await company();

  const reads = [
    "/work",
    "/agents",
    "/workforce",
    "/artifacts",
    "/approvals",
    "/activity",
    "/overview",
    "/company-readiness",
    "/knowledge/overview",
    `/workforce/${a.agent}`,
    `/knowledge/${a.knowledge}`,
    ...everyMissionRoute(a.work),
    ...everyMissionRoute(b.work),
  ];

  for (const url of reads) {
    const response = await as("newcomer", url);
    assert.equal(response.statusCode, 404, url);
    assert.doesNotMatch(response.body, /Acme|Borealis/, url);
  }

  for (const url of [`/work/${a.work}/execute`, `/approvals/${a.approval}/approve`, "/work"]) {
    assert.equal((await post("newcomer", url, { objective: "Take a look around." })).statusCode, 404, url);
  }

  assert.equal(await jobs.findActiveByWork(a.work), null);
});

test("an invitation is the way in, as what it says - never as owner of a company that already exists", async () => {
  const { as } = await company();

  await person("invited");
  await members.createMember({
    id: "88888888-0000-4000-8000-0000000000aa" as MemberId,
    organizationId: orgA,
    email: "invited@example.test",
    role: "viewer",
    status: "invited",
    createdAt: now,
    updatedAt: now,
  });

  const me = (await as("invited", "/me")).json();
  assert.equal(me.organization.id, orgA);
  assert.equal(me.organization.role, "viewer", "joined as invited, not promoted");

  // In Acme, and only Acme.
  assert.equal((await as("invited", `/work/${a.work}`)).statusCode, 200);
  assert.equal((await as("invited", `/work/${b.work}`)).statusCode, 404);
});

test("an invitation is not picked up by an address nobody has confirmed", async () => {
  const { as } = await company();

  await person("unconfirmed", undefined, "owner", false);
  await members.createMember({
    id: "88888888-0000-4000-8000-0000000000bb" as MemberId,
    organizationId: orgA,
    email: "unconfirmed@example.test",
    role: "member",
    status: "invited",
    createdAt: now,
    updatedAt: now,
  });

  const me = (await as("unconfirmed", "/me")).json();
  assert.equal(me.organization, null);
  assert.equal((await as("unconfirmed", `/work/${a.work}`)).statusCode, 404);
});
