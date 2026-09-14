import assert from "node:assert/strict";
import test from "node:test";

import type {
  MemberId,
  OrganizationId,
  OrganizationMember,
  OrganizationRole,
  UserId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import { InMemoryMembershipRepository, LastOwnerError, MemberConflictError } from "@unioffice/database";

import type { RecordEventInput } from "../event-recorder.js";

import { AccessError } from "./access-resolver.js";
import { MemberNotFoundError, MemberService, MemberStateError, MemberValidationError } from "./member-service.js";
import type { Access } from "./permissions.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const theirWorkspace = "f0000000-0000-4000-8000-0000000000bb" as WorkspaceId;
const now = new Date("2026-09-14T12:00:00.000Z");

let counter = 0;

async function setup() {
  const members = new InMemoryMembershipRepository();
  const events: RecordEventInput[] = [];
  const workspaces = new Map<WorkspaceId, Workspace>([
    [finance, { id: finance, organizationId: orgA } as Workspace],
    [theirWorkspace, { id: theirWorkspace, organizationId: orgB } as Workspace],
  ]);
  const service = new MemberService(
    members,
    { findById: async (id) => workspaces.get(id) ?? null },
    { record: async (event) => { events.push(event); return event as never; } },
    () => now,
  );

  async function person(role: OrganizationRole, overrides: Partial<OrganizationMember> = {}) {
    counter += 1;
    const suffix = String(counter).padStart(12, "0");
    const member = await members.createMember({
      id: `00000000-0000-4000-8000-${suffix}` as MemberId,
      organizationId: orgA,
      userId: `11111111-0000-4000-8000-${suffix}` as UserId,
      email: `person${counter}@example.test`,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });

    const access: Access = {
      userId: member.userId!,
      email: member.email,
      organizationId: member.organizationId,
      memberId: member.id,
      role: member.role,
      workspaces: new Map(),
    };

    return { member, access };
  }

  return { members, events, service, person };
}

async function forbidden(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => error instanceof AccessError && error.statusCode === 403);
}

test("any member can see who belongs, without anyone outside the organization", async () => {
  const { service, person } = await setup();
  const owner = await person("owner");
  const viewer = await person("viewer");
  await person("member", { organizationId: orgB });

  const list = await service.listMembers(viewer.access);

  assert.deepEqual(list.map((member) => member.id).sort(), [owner.member.id, viewer.member.id].sort());
  assert.equal(list.find((member) => member.you)?.id, viewer.member.id);
});

test("an owner or admin invites people at or below their reach, and it is audited without the address", async () => {
  const { service, person, events } = await setup();
  const owner = await person("owner");
  const admin = await person("admin");

  assert.equal((await service.invite(owner.access, { email: "New.Admin@Example.test", role: "admin" })).status, "invited");
  assert.equal((await service.invite(admin.access, { email: "helper@example.test", role: "member" })).role, "member");

  assert.equal(events.at(-1)?.type, "member.invited");
  assert.equal(events.at(-1)?.actorId, `user:${admin.access.userId}`);
  assert.doesNotMatch(JSON.stringify(events.map((event) => event.payload)), /example\.test/);
});

test("nobody invites above their reach, and members and viewers invite nobody", async () => {
  const { service, person } = await setup();
  await person("owner");
  const admin = await person("admin");
  const member = await person("member");
  const viewer = await person("viewer");

  await forbidden(service.invite(admin.access, { email: "boss@example.test", role: "owner" }));
  await forbidden(service.invite(admin.access, { email: "peer@example.test", role: "admin" }));
  await forbidden(service.invite(member.access, { email: "friend@example.test", role: "viewer" }));
  await forbidden(service.invite(viewer.access, { email: "friend@example.test", role: "viewer" }));
});

test("inviting someone already in the organization is a conflict, and bad input is refused", async () => {
  const { service, person } = await setup();
  const owner = await person("owner");

  await assert.rejects(service.invite(owner.access, { email: owner.member.email, role: "member" }), MemberConflictError);
  await assert.rejects(service.invite(owner.access, { email: "nope", role: "member" }), MemberValidationError);
  await assert.rejects(service.invite(owner.access, { email: "x@example.test", role: "superuser" }), MemberValidationError);
});

test("an admin manages members and viewers but cannot touch owners or other admins", async () => {
  const { service, person } = await setup();
  const owner = await person("owner");
  const admin = await person("admin");
  const otherAdmin = await person("admin");
  const member = await person("member");

  assert.equal((await service.changeRole(admin.access, member.member.id, { role: "viewer" })).role, "viewer");

  await forbidden(service.changeRole(admin.access, owner.member.id, { role: "member" }));
  await forbidden(service.suspend(admin.access, owner.member.id));
  await forbidden(service.remove(admin.access, owner.member.id));
  await forbidden(service.changeRole(admin.access, otherAdmin.member.id, { role: "member" }));
  await forbidden(service.changeRole(admin.access, member.member.id, { role: "admin" }));
  await forbidden(service.changeRole(admin.access, member.member.id, { role: "owner" }));
});

test("nobody can raise, suspend or remove themselves", async () => {
  const { service, person } = await setup();
  await person("owner");
  const admin = await person("admin");

  await assert.rejects(service.changeRole(admin.access, admin.member.id, { role: "owner" }), MemberStateError);
  await assert.rejects(service.suspend(admin.access, admin.member.id), MemberStateError);
  await assert.rejects(service.remove(admin.access, admin.member.id), MemberStateError);
});

test("members and viewers cannot change anyone", async () => {
  const { service, person } = await setup();
  const owner = await person("owner");
  const member = await person("member");
  const viewer = await person("viewer");

  await forbidden(service.changeRole(member.access, viewer.member.id, { role: "member" }));
  await forbidden(service.suspend(member.access, viewer.member.id));
  await forbidden(service.remove(viewer.access, member.member.id));
  await forbidden(service.setWorkspaceAccess(member.access, member.member.id, { workspaceId: finance, access: "member" }));
  await forbidden(service.changeRole(viewer.access, owner.member.id, { role: "viewer" }));
});

test("an owner can make another owner, who can then take over; the one left cannot remove themselves", async () => {
  const { service, person, members } = await setup();
  const owner = await person("owner");
  const admin = await person("admin");

  assert.equal((await service.changeRole(owner.access, admin.member.id, { role: "owner" })).role, "owner");

  const promoted: Access = { ...admin.access, role: "owner" };
  await service.remove(promoted, owner.member.id);

  assert.equal(await members.findMember(orgA, owner.member.id), null);
  await assert.rejects(service.remove(promoted, admin.member.id), MemberStateError);
  await assert.rejects(service.changeRole(promoted, admin.member.id, { role: "member" }), MemberStateError);
});

test("two owners suspending each other at once cannot leave the organization ownerless", async () => {
  const { service, person } = await setup();
  const first = await person("owner");
  const second = await person("owner");

  // Both requests were resolved while both were active owners. The first
  // lands; the second is now made by a suspended owner and is refused.
  await service.suspend(first.access, second.member.id);
  await forbidden(service.suspend(second.access, first.member.id));
});

test("when the database refuses to lose the last owner, the refusal reaches the caller unchanged", async () => {
  const { members, person } = await setup();
  const owner = await person("owner");
  const other = await person("owner");

  // Stands in for the trigger firing on a write that raced past the checks.
  const racing = Object.create(members) as InMemoryMembershipRepository;
  racing.updateMember = async () => { throw new LastOwnerError(); };

  const service = new MemberService(racing, { findById: async () => null }, { record: async () => ({}) as never }, () => now);

  await assert.rejects(service.changeRole(owner.access, other.member.id, { role: "admin" }), LastOwnerError);
});

test("an id from another organization is not found", async () => {
  const { service, person } = await setup();
  const owner = await person("owner");
  const theirs = await person("member", { organizationId: orgB });

  await assert.rejects(service.changeRole(owner.access, theirs.member.id, { role: "viewer" }), MemberNotFoundError);
  await assert.rejects(service.remove(owner.access, theirs.member.id), MemberNotFoundError);
  await assert.rejects(service.suspend(owner.access, "99999999-0000-4000-8000-000000000000" as MemberId), MemberNotFoundError);
});

test("a caller demoted or suspended mid-flight cannot finish with the authority they lost", async () => {
  const { service, person, members } = await setup();
  await person("owner");
  const admin = await person("admin");
  const member = await person("member");

  // Resolved as admin, then demoted before the change runs.
  await members.updateMember({ ...admin.member, role: "member", updatedAt: now });
  await forbidden(service.suspend(admin.access, member.member.id));

  await members.updateMember({ ...admin.member, role: "admin", status: "suspended", updatedAt: now });
  await forbidden(service.remove(admin.access, member.member.id));

  // And a removed caller has no membership to act with at all.
  await members.updateMember({ ...admin.member, role: "admin", status: "active", updatedAt: now });
  await members.deleteMember(orgA, admin.member.id);
  await forbidden(service.invite(admin.access, { email: "late@example.test", role: "viewer" }));
});

test("suspending and reactivating is audited; invitations are removed rather than suspended", async () => {
  const { service, person, events } = await setup();
  const owner = await person("owner");
  const member = await person("member");
  const invited = await service.invite(owner.access, { email: "pending@example.test", role: "viewer" });

  assert.equal((await service.suspend(owner.access, member.member.id)).status, "suspended");
  assert.equal((await service.reactivate(owner.access, member.member.id)).status, "active");
  await assert.rejects(service.suspend(owner.access, invited.id), MemberStateError);
  assert.deepEqual(await service.remove(owner.access, invited.id), { removed: invited.id });

  assert.deepEqual(events.map((event) => event.type), ["member.invited", "member.suspended", "member.reactivated", "member.removed"]);
});

test("workspace access is granted, changed and revoked only in the caller's own workspaces", async () => {
  const { service, person, events } = await setup();
  const admin = await person("admin");
  const member = await person("member");

  const granted = await service.setWorkspaceAccess(admin.access, member.member.id, { workspaceId: finance, access: "viewer" });
  assert.deepEqual(granted.workspaces, [{ workspaceId: finance, access: "viewer" }]);

  const changed = await service.setWorkspaceAccess(admin.access, member.member.id, { workspaceId: finance, access: "member" });
  assert.deepEqual(changed.workspaces, [{ workspaceId: finance, access: "member" }]);

  const revoked = await service.setWorkspaceAccess(admin.access, member.member.id, { workspaceId: finance, access: null });
  assert.deepEqual(revoked.workspaces, []);

  await assert.rejects(
    service.setWorkspaceAccess(admin.access, member.member.id, { workspaceId: theirWorkspace, access: "member" }),
    MemberValidationError,
  );
  await assert.rejects(
    service.setWorkspaceAccess(admin.access, member.member.id, { workspaceId: finance, access: "owner" }),
    MemberValidationError,
  );

  assert.deepEqual(events.map((event) => event.type), ["workspace.access_granted", "workspace.access_granted", "workspace.access_revoked"]);
});
