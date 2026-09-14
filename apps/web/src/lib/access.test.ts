import { describe, expect, it } from "vitest";

import { accessFrom } from "./access";
import type { Me, OrganizationRole, Permission } from "./api";

const finance = "f0000000-0000-4000-8000-00000000000f";
const legal = "a0000000-0000-4000-8000-00000000000a";

function me(role: OrganizationRole, permissions: Permission[], workspaces: Me["organization"] extends infer O ? O extends { workspaces: infer W } ? W : never : never = []): Me {
  return {
    user: { id: "user-1", email: "person@example.test" },
    standing: "active",
    organization: { id: "org-1", memberId: "member-1", role, permissions, workspaces },
    memberships: [{ organizationId: "org-1", role, status: "active" }],
  };
}

describe("what the web app offers a person", () => {
  it("offers owners and admins their permissions in every workspace", () => {
    const admin = accessFrom(me("admin", ["missions.create", "members.manage"]));

    expect(admin.can("members.manage")).toBe(true);
    expect(admin.canActIn("missions.create", finance)).toBe(true);
    expect(admin.can("owners.manage")).toBe(false);
  });

  it("offers a member company-wide actions, and workspace actions only where they hold a member grant", () => {
    const member = accessFrom(me("member", ["missions.create", "approvals.decide"], [
      { workspaceId: finance, access: "member" },
      { workspaceId: legal, access: "viewer" },
    ]));

    expect(member.canActIn("missions.create", null)).toBe(true);
    expect(member.canActIn("missions.create", finance)).toBe(true);
    expect(member.canActIn("missions.create", legal)).toBe(false);
    expect(member.canActIn("missions.create", "some-other-workspace")).toBe(false);
    expect(member.can("members.manage")).toBe(false);
  });

  it("offers a viewer nothing to change, whatever their grants", () => {
    const viewer = accessFrom(me("viewer", ["organization.read"], [{ workspaceId: finance, access: "member" }]));

    expect(viewer.canActIn("missions.create", finance)).toBe(false);
    expect(viewer.can("approvals.decide")).toBe(false);
  });

  it("offers nothing to someone without an organization", () => {
    const nobody = accessFrom({ ...me("viewer", []), organization: null, standing: "none" });

    expect(nobody.can("organization.read")).toBe(false);
  });
});
