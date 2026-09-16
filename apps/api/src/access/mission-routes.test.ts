import assert from "node:assert/strict";
import test from "node:test";

import type {
  MemberId,
  OrganizationId,
  OrganizationRole,
  UserId,
  Work,
  WorkId,
  WorkspaceAccessLevel,
  WorkspaceId,
  WorkspaceMemberId,
} from "@unioffice/core";

import { InMemoryMembershipRepository } from "@unioffice/database";

import { buildApiServer, type ApiServices } from "../server.js";

import { AccessError, AccessResolver } from "./access-resolver.js";
import type { Identity } from "./authenticator.js";
import { StreamTickets } from "./stream-tickets.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const legal = "a0000000-0000-4000-8000-00000000000a" as WorkspaceId;
const now = new Date("2026-09-14T12:00:00.000Z");

const companyWide = "c0000000-0000-4000-8000-000000000001" as WorkId;
const financeWork = "c0000000-0000-4000-8000-000000000002" as WorkId;
const legalWork = "c0000000-0000-4000-8000-000000000003" as WorkId;
const theirWork = "c0000000-0000-4000-8000-000000000004" as WorkId;

const works = new Map<WorkId, Work>([
  [companyWide, { id: companyWide, organizationId: orgA } as Work],
  [financeWork, { id: financeWork, organizationId: orgA, workspaceId: finance } as Work],
  [legalWork, { id: legalWork, organizationId: orgA, workspaceId: legal } as Work],
  [theirWork, { id: theirWork, organizationId: orgB } as Work],
]);

async function company(options: { resolver?: (real: AccessResolver) => ApiServices["accessResolver"] } = {}) {
  const members = new InMemoryMembershipRepository();
  const identities = new Map<string, Identity>();
  const done: string[] = [];
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
  }

  await person("owner", "owner");
  await person("viewer", "viewer", { [finance]: "member" });
  await person("ungranted", "member");
  await person("financeViewer", "member", { [finance]: "viewer" });
  await person("financeMember", "member", { [finance]: "member" });
  await person("outsider", "owner", {}, orgB);

  const real = new AccessResolver(members, () => now);

  const services = {
    authenticator: { verify: async (token: string) => identities.get(token) ?? null },
    accessResolver: options.resolver ? options.resolver(real) : real,
    streamTickets: new StreamTickets(),
    workQueryService: {
      async assertWorkInOrganization(id: WorkId, organizationId: OrganizationId) {
        const work = works.get(id);
        if (!work || work.organizationId !== organizationId) throw new Error(`Work not found: ${id}`);
        return work;
      },
      async getTasks() { return []; },
    },
    executionRoomService: { async getRoom(id: WorkId) { return { work: { id }, agents: [], cast: [] }; } },
    workService: { async planWork(id: WorkId) { done.push(`plan:${id}`); return { id }; } },
    executionQueueService: { async enqueueWork(id: WorkId) { done.push(`execute:${id}`); return { enqueued: true }; } },
    workRecoveryService: { async retryWork(id: WorkId) { done.push(`retry:${id}`); return { mode: "replan" }; } },
    workCancellationService: { async cancelWork(id: WorkId) { done.push(`cancel:${id}`); return { id }; } },
    missionControlService: { async acknowledge(_org: OrganizationId, id: WorkId) { done.push(`acknowledge:${id}`); return { workId: id }; } },
    workspaceService: { async getWorkspace(_org: OrganizationId, id: WorkspaceId) { return { id }; } },
    applicationService: { async createWork(input: { workspaceId?: WorkspaceId }) { done.push(`create:${input.workspaceId ?? "company"}`); return { id: "new" }; } },
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices;

  const app = buildApiServer(services);
  const as = (name: string) => ({ authorization: `Bearer token-${name}` });

  return { app, as, done };
}

const operations = ["plan", "execute", "retry", "cancel", "acknowledge"] as const;

test("a viewer can open a mission's room but cannot start, run or stop anything", async () => {
  const { app, as, done } = await company();

  assert.equal((await app.inject({ method: "GET", url: `/work/${companyWide}/room`, headers: as("viewer") })).statusCode, 200);

  for (const operation of operations) {
    const response = await app.inject({ method: "POST", url: `/work/${companyWide}/${operation}`, headers: as("viewer"), payload: {} });
    assert.equal(response.statusCode, 403, operation);
  }

  // A member grant does not lift a viewer role.
  const inFinance = await app.inject({ method: "POST", url: `/work/${financeWork}/execute`, headers: as("viewer"), payload: {} });
  const create = await app.inject({ method: "POST", url: "/work", headers: as("viewer"), payload: { objective: "Do something" } });

  assert.equal(inFinance.statusCode, 403);
  assert.equal(create.statusCode, 403);
  assert.deepEqual(done, []);
});

test("a mission in a workspace the caller was not given does not exist for them", async () => {
  const { app, as, done } = await company();

  for (const url of [`/work/${legalWork}/room`, `/work/${legalWork}`, `/work/${legalWork}/tasks`, `/work/${financeWork}/room`]) {
    assert.equal((await app.inject({ method: "GET", url, headers: as("ungranted") })).statusCode, 404, url);
  }

  const execute = await app.inject({ method: "POST", url: `/work/${legalWork}/execute`, headers: as("ungranted"), payload: {} });
  assert.equal(execute.statusCode, 404);
  assert.deepEqual(done, []);
});

test("a viewer grant lets a member see a workspace's mission, and a member grant lets them run it", async () => {
  const { app, as, done } = await company();

  assert.equal((await app.inject({ method: "GET", url: `/work/${financeWork}/room`, headers: as("financeViewer") })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: `/work/${financeWork}/execute`, headers: as("financeViewer"), payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/work", headers: as("financeViewer"), payload: { objective: "Close the books", workspaceId: finance } })).statusCode, 403);

  for (const operation of operations) {
    const response = await app.inject({ method: "POST", url: `/work/${financeWork}/${operation}`, headers: as("financeMember"), payload: {} });
    assert.equal(response.statusCode, 200, operation);
  }

  assert.equal((await app.inject({ method: "POST", url: "/work", headers: as("financeMember"), payload: { objective: "Close the books", workspaceId: finance } })).statusCode, 201);
  assert.equal((await app.inject({ method: "POST", url: "/work", headers: as("financeMember"), payload: { objective: "Company-wide", organizationId: orgA } })).statusCode, 201);
  assert.equal(done.at(-2), `create:${finance}`);
  assert.equal(done.at(-1), "create:company");
});

test("an owner reaches every workspace's missions; nobody reaches another organization's", async () => {
  const { app, as } = await company();

  assert.equal((await app.inject({ method: "POST", url: `/work/${legalWork}/execute`, headers: as("owner"), payload: {} })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: `/work/${theirWork}/room`, headers: as("owner") })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: `/work/${companyWide}/cancel`, headers: as("outsider"), payload: {} })).statusCode, 404);
});

test("a member suspended while their request is in flight does not get to run the mission", async () => {
  let calls = 0;
  const { app, as, done } = await company({
    resolver: (real) => ({
      organizationsFor: (identity) => real.organizationsFor(identity),
      async resolve(identity, requested) {
        calls += 1;
        // Active when the request arrives; suspended by the time it acts.
        if (calls > 1) throw new AccessError(403, "Your access to this organization is suspended.");
        return real.resolve(identity, requested);
      },
    }),
  });

  const response = await app.inject({ method: "POST", url: `/work/${financeWork}/execute`, headers: as("financeMember"), payload: {} });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(done, []);
});
