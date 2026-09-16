import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  MemberId,
  OrganizationId,
  OrganizationRole,
  Task,
  TaskId,
  UserId,
  Work,
  WorkId,
  WorkspaceAccessLevel,
  WorkspaceId,
  WorkspaceMemberId,
} from "@unioffice/core";

import { InMemoryMembershipRepository, InMemoryOperationalReadRepository } from "@unioffice/database";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { AgentDirectoryService } from "../agent-directory-service.js";
import { buildApiServer, type ApiServices } from "../server.js";
import { WorkforceService } from "../workforce-service.js";

import { AccessResolver } from "./access-resolver.js";
import type { Identity } from "./authenticator.js";
import { StreamTickets } from "./stream-tickets.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const now = new Date();

const tony = "a0000000-0000-4000-8000-00000000000a" as AgentId;
const ledger = "a0000000-0000-4000-8000-00000000000b" as AgentId;
const theirs = "a0000000-0000-4000-8000-00000000000c" as AgentId;

function agent(id: AgentId, name: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    organizationId: orgA,
    name,
    description: `${name} works here.`,
    type: "specialist",
    status: "active",
    capabilities: ["coding"],
    toolIds: ["calculator"],
    createdAt: now,
    updatedAt: now,
    metadata: { systemInstructions: "PROMPT-THAT-MUST-STAY-ON-THE-SERVER" },
    ...overrides,
  };
}

/**
 * The workforce over HTTP with the real membership resolver, the real
 * workforce service and the real agent directory - only storage in memory.
 */
async function company() {
  const members = new InMemoryMembershipRepository();
  const identities = new Map<string, Identity>();
  let counter = 0;

  async function person(name: string, role: OrganizationRole, grants: Record<string, WorkspaceAccessLevel> = {}, organizationId = orgA) {
    counter += 1;
    const suffix = String(counter).padStart(12, "0");
    const identity: Identity = { userId: `11111111-0000-4000-8000-${suffix}` as UserId, email: `${name}@example.test`, emailConfirmed: true };
    const member = await members.createMember({
      id: `00000000-0000-4000-8000-${suffix}` as MemberId,
      organizationId,
      userId: identity.userId,
      email: identity.email,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    for (const [workspaceId, access] of Object.entries(grants)) {
      await members.grantWorkspace({
        id: `44444444-0000-4000-8000-${suffix}` as WorkspaceMemberId,
        organizationId,
        workspaceId: workspaceId as WorkspaceId,
        memberId: member.id,
        access,
        createdAt: now,
        updatedAt: now,
      });
    }

    identities.set(`token-${name}`, identity);
    return member;
  }

  await person("owner", "owner");
  await person("admin", "admin");
  await person("member", "member");
  await person("financeMember", "member", { [finance]: "member" });
  await person("viewer", "viewer");
  const suspended = await person("suspended", "member");
  await members.updateMember({ ...suspended, status: "suspended", updatedAt: now });
  await person("outsider", "owner", {}, orgB);

  const agents: Agent[] = [
    agent(tony, "Tony"),
    agent(ledger, "Ledger", { workspaceId: finance }),
    agent(theirs, "Theirs", { organizationId: orgB }),
  ];

  const works: Work[] = [{
    id: "c0000000-0000-4000-8000-000000000001" as WorkId,
    organizationId: orgA,
    workspaceId: finance,
    requesterId: "u" as Work["requesterId"],
    objective: "Close the Finance books",
    status: "executing",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  }];
  const tasks: Task[] = [{
    id: "d0000000-0000-4000-8000-000000000001" as TaskId,
    workId: works[0]!.id,
    title: "Reconcile the ledger",
    description: "",
    status: "running",
    assignedAgentId: tony,
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    metadata: {},
  }];

  const agentRepository = {
    async findById(id: AgentId) { return agents.find((entry) => entry.id === id) ?? null; },
    async findByOrganization(organizationId: OrganizationId) { return agents.filter((entry) => entry.organizationId === organizationId); },
    async update(updated: Agent) {
      const index = agents.findIndex((entry) => entry.id === updated.id);
      agents[index] = updated;
      return updated;
    },
  };
  const workspaceRepository = {
    async findByOrganization(organizationId: OrganizationId) {
      return organizationId === orgA ? [{ id: finance, organizationId: orgA, name: "Finance", slug: "finance" }] : [];
    },
    async findById(id: WorkspaceId) { return id === finance ? { id: finance, organizationId: orgA, name: "Finance", slug: "finance" } : null; },
  };
  const tools = createDefaultToolRegistry();

  const services = {
    authenticator: { verify: async (token: string) => identities.get(token) ?? null },
    accessResolver: new AccessResolver(members, () => now),
    streamTickets: new StreamTickets(),
    workforceService: new WorkforceService({
      agents: agentRepository,
      reads: new InMemoryOperationalReadRepository(works, tasks),
      workspaces: workspaceRepository as never,
      policies: { async findEnforced() { return []; } },
      tools,
    }),
    agentDirectoryService: new AgentDirectoryService(
      agentRepository as never,
      workspaceRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      tools,
      { record: async () => ({}) } as never,
    ),
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices;

  const app = buildApiServer(services);
  const get = (name: string | null, url: string) =>
    app.inject({ method: "GET", url, headers: name ? { authorization: `Bearer token-${name}` } : {} });
  const post = (name: string, url: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url, headers: { authorization: `Bearer token-${name}` }, payload });

  return { get, post, agents };
}

const names = (body: { members: Array<{ name: string }> }) => body.members.map((member) => member.name).sort();

test("every member of the organization can see its workforce, and nobody outside it can", async () => {
  const { get } = await company();

  assert.equal((await get(null, "/workforce")).statusCode, 401);
  assert.deepEqual(names((await get("owner", "/workforce")).json()), ["Ledger", "Tony"]);
  assert.deepEqual(names((await get("viewer", "/workforce")).json()), ["Tony"]);
  assert.deepEqual(names((await get("outsider", "/workforce")).json()), ["Theirs"]);
  assert.equal((await get("outsider", `/workforce?organizationId=${orgA}`)).statusCode, 404);
  assert.equal((await get("suspended", "/workforce")).statusCode, 403);
});

test("an agent's instructions never leave the server, on the roster or a profile", async () => {
  const { get } = await company();

  const roster = await get("owner", "/workforce");
  const profile = await get("owner", `/workforce/${tony}`);

  assert.equal(profile.statusCode, 200);
  assert.doesNotMatch(roster.body + profile.body, /PROMPT-THAT-MUST-STAY-ON-THE-SERVER|systemInstructions|metadata/);
});

test("knowing an agent's id is not enough: another organization's, or another workspace's, reads as not found", async () => {
  const { get } = await company();

  assert.equal((await get("owner", `/workforce/${theirs}`)).statusCode, 404);
  assert.equal((await get("member", `/workforce/${ledger}`)).statusCode, 404);
  assert.equal((await get("viewer", `/workforce/${ledger}`)).statusCode, 404);
  assert.equal((await get("financeMember", `/workforce/${ledger}`)).statusCode, 200);
  assert.equal((await get("owner", "/workforce/a0000000-0000-4000-8000-0000000000ff")).statusCode, 404);
  assert.equal((await get("owner", "/workforce/not-an-agent")).statusCode, 400);
});

test("current work in a workspace the caller cannot open says the agent is busy, not on what", async () => {
  const { get } = await company();

  const asMember = (await get("member", "/workforce")).json().members.find((member: { name: string }) => member.name === "Tony");
  const asOwner = (await get("owner", "/workforce")).json().members.find((member: { name: string }) => member.name === "Tony");

  assert.equal(asMember.presence, "working");
  assert.equal(asMember.current, undefined);
  assert.equal(asMember.workingElsewhere, true);
  assert.equal(asOwner.current.taskTitle, "Reconcile the ledger");
  assert.doesNotMatch(JSON.stringify(asMember), /Reconcile|Close the Finance books/);
});

test("pausing, resuming and granting tools is for owners and admins, and only to tools that exist", async () => {
  const { post, agents } = await company();

  for (const name of ["member", "viewer", "financeMember"]) {
    assert.equal((await post(name, `/agents/${tony}`, { status: "paused" })).statusCode, 403, name);
    assert.equal((await post(name, `/agents/${tony}`, { toolIds: ["calculator", "datetime"] })).statusCode, 403, name);
  }
  assert.equal(agents[0]!.status, "active");

  assert.equal((await post("admin", `/agents/${tony}`, { toolIds: ["calculator", "shell_exec"] })).statusCode, 400);
  assert.deepEqual(agents[0]!.toolIds, ["calculator"]);

  assert.equal((await post("admin", `/agents/${tony}`, { status: "paused" })).statusCode, 200);
  assert.equal(agents[0]!.status, "paused");
  assert.equal((await post("owner", `/agents/${theirs}`, { status: "paused" })).statusCode, 404);
  assert.equal(agents[2]!.status, "active");
});
