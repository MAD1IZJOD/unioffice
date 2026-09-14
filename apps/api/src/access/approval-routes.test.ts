import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApprovalId,
  ApprovalRequest,
  MemberId,
  OrganizationId,
  OrganizationRole,
  UserId,
  WorkId,
  WorkspaceAccessLevel,
  WorkspaceId,
  WorkspaceMemberId,
} from "@unioffice/core";

import { InMemoryMembershipRepository } from "@unioffice/database";

import { buildApiServer, type ApiServices } from "../server.js";

import { AccessResolver } from "./access-resolver.js";
import type { Identity } from "./authenticator.js";
import { StreamTickets } from "./stream-tickets.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const now = new Date("2026-09-14T12:00:00.000Z");

interface Case {
  organizationId: OrganizationId;
  workId: WorkId;
  workspaceId?: WorkspaceId;
  governedByPolicy: boolean;
}

const planner = "a1111111-0000-4000-8000-000000000001" as ApprovalId;
const governed = "a1111111-0000-4000-8000-000000000002" as ApprovalId;
const inFinance = "a1111111-0000-4000-8000-000000000003" as ApprovalId;
const theirs = "a1111111-0000-4000-8000-000000000004" as ApprovalId;

const cases = new Map<ApprovalId, Case>([
  [planner, { organizationId: orgA, workId: "c0000000-0000-4000-8000-000000000001" as WorkId, governedByPolicy: false }],
  [governed, { organizationId: orgA, workId: "c0000000-0000-4000-8000-000000000002" as WorkId, governedByPolicy: true }],
  [inFinance, { organizationId: orgA, workId: "c0000000-0000-4000-8000-000000000003" as WorkId, workspaceId: finance, governedByPolicy: false }],
  [theirs, { organizationId: orgB, workId: "c0000000-0000-4000-8000-000000000004" as WorkId, governedByPolicy: false }],
]);

async function company() {
  const members = new InMemoryMembershipRepository();
  const identities = new Map<string, Identity>();
  const decisions: Array<{ decision: string; approvalId: ApprovalId; by: string }> = [];
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
    return identity;
  }

  const people = {
    owner: await person("owner", "owner"),
    admin: await person("admin", "admin"),
    member: await person("member", "member"),
    viewer: await person("viewer", "viewer"),
    financeViewer: await person("financeViewer", "member", { [finance]: "viewer" }),
    financeMember: await person("financeMember", "member", { [finance]: "member" }),
    outsider: await person("outsider", "owner", {}, orgB),
  };

  const approvalOf = (id: ApprovalId): ApprovalRequest => {
    const entry = cases.get(id)!;
    return { id, organizationId: entry.organizationId, workId: entry.workId, status: "pending" } as ApprovalRequest;
  };

  const decide = (decision: string) => async (id: ApprovalId, by: string, organizationId: OrganizationId) => {
    if (cases.get(id)?.organizationId !== organizationId) throw new Error(`Approval not found: ${id}`);
    decisions.push({ decision, approvalId: id, by });
    return approvalOf(id);
  };

  const services = {
    authenticator: { verify: async (token: string) => identities.get(token) ?? null },
    accessResolver: new AccessResolver(members, () => now),
    streamTickets: new StreamTickets(),
    workApprovalService: {
      async getDecisionContext(id: ApprovalId, organizationId: OrganizationId) {
        const entry = cases.get(id);
        if (!entry || entry.organizationId !== organizationId) throw new Error(`Approval not found: ${id}`);
        return { approval: approvalOf(id), workspaceId: entry.workspaceId, governedByPolicy: entry.governedByPolicy };
      },
      async getPendingApprovals(organizationId: OrganizationId) {
        return [...cases.keys()].filter((id) => cases.get(id)!.organizationId === organizationId).map(approvalOf);
      },
      approve: decide("approve"),
      reject: decide("reject"),
    },
    workQueryService: {
      async workspaceIndex() {
        return new Map([...cases.values()].map((entry) => [entry.workId, entry.workspaceId]));
      },
    },
    executionQueueService: { async enqueueWork() { return { enqueued: true }; } },
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices;

  const app = buildApiServer(services);
  const as = (name: keyof typeof people) => ({ authorization: `Bearer token-${name}` });

  const post = (name: keyof typeof people, id: ApprovalId, decision: "approve" | "reject", payload: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: `/approvals/${id}/${decision}`, headers: as(name), payload });

  return { app, as, post, people, decisions };
}

test("a viewer cannot approve or reject anything", async () => {
  const { post, decisions } = await company();

  assert.equal((await post("viewer", planner, "approve")).statusCode, 403);
  assert.equal((await post("viewer", planner, "reject")).statusCode, 403);
  assert.deepEqual(decisions, []);
});

test("a member decides a step the planner raised, but not one a governance policy requires", async () => {
  const { post, decisions, people } = await company();

  assert.equal((await post("member", planner, "approve")).statusCode, 200);
  assert.equal((await post("member", governed, "approve")).statusCode, 403);
  assert.equal((await post("member", governed, "reject")).statusCode, 403);

  assert.deepEqual(decisions, [{ decision: "approve", approvalId: planner, by: people.member.userId }]);
});

test("owners and admins decide policy-governed steps, recorded as themselves whatever the body says", async () => {
  const { post, decisions, people } = await company();

  assert.equal((await post("admin", governed, "approve", { resolvedBy: "someone-else", organizationId: orgA })).statusCode, 200);
  assert.equal((await post("owner", governed, "reject")).statusCode, 200);

  assert.deepEqual(decisions.map((entry) => entry.by), [people.admin.userId, people.owner.userId]);
});

test("a workspace's approval needs a member grant there; without any grant it does not exist", async () => {
  const { post, decisions } = await company();

  assert.equal((await post("member", inFinance, "approve")).statusCode, 404);
  assert.equal((await post("financeViewer", inFinance, "approve")).statusCode, 403);
  assert.equal((await post("financeMember", inFinance, "approve")).statusCode, 200);
  assert.equal(decisions.length, 1);
});

test("another organization's approval is not found, by id or by naming their organization", async () => {
  const { app, as, post, decisions } = await company();

  assert.equal((await post("owner", theirs, "approve")).statusCode, 404);
  assert.equal((await post("owner", theirs, "approve", { organizationId: orgB })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/approvals/not-an-id/approve", headers: as("owner"), payload: {} })).statusCode, 400);
  assert.deepEqual(decisions, []);
});

test("the pending list shows only approvals in workspaces the caller reaches", async () => {
  const { app, as } = await company();

  const ids = async (name: "owner" | "member" | "financeViewer") =>
    (await app.inject({ method: "GET", url: "/approvals", headers: as(name) })).json().approvals.map((approval: { id: string }) => approval.id).sort();

  assert.deepEqual(await ids("owner"), [planner, governed, inFinance].sort());
  assert.deepEqual(await ids("member"), [planner, governed].sort());
  assert.deepEqual(await ids("financeViewer"), [planner, governed, inFinance].sort());
});
