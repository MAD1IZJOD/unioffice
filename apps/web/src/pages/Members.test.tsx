import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AccessContext } from "../lib/access";
import type { MemberItem, OrganizationRole } from "../lib/api";
import { signedInAs } from "../test/access";
import { json, stubNetwork } from "../test/network";
import Members from "./Members";

/**
 * The members page as each role sees it, over the real client with only the
 * network scripted. It offers changes by role; the API is what refuses them.
 */

const joined = new Date(Date.now() - 3_600_000).toISOString();

function member(id: string, email: string, role: OrganizationRole, overrides: Partial<MemberItem> = {}): MemberItem {
  return { id, email, role, status: "active", you: false, joinedAt: joined, updatedAt: joined, workspaces: [], ...overrides };
}

function everyone(myRole: OrganizationRole): MemberItem[] {
  return [
    member("m-me", "me@example.test", myRole, { you: true }),
    member("m-owner", "owner@example.test", "owner"),
    member("m-member", "member@example.test", "member"),
    member("m-invited", "new@example.test", "viewer", { status: "invited" }),
  ];
}

const organization = {
  organization: { id: "org", name: "Test Company" },
  workspaces: [
    { workspace: { id: "ws-finance", name: "Finance", slug: "finance", status: "active" }, agentCount: 0, workCount: 0, activeWorkCount: 0 },
  ],
  unassignedAgentCount: 0,
  agentCount: 0,
  workCount: 0,
  activeWorkCount: 0,
  activity: [],
};

function open(role: OrganizationRole) {
  const calls = stubNetwork((call) => {
    if (call.method === "GET" && call.url.pathname === "/members") return json(200, { members: everyone(role) });
    if (call.url.pathname === "/organization") return json(200, organization);
    if (call.method === "POST") return json(200, { member: everyone(role)[2], removed: "m-member" });
    return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
  });

  const router = createMemoryRouter(
    [{
      path: "/members",
      element: (
        <AccessContext.Provider value={signedInAs(role)}>
          <Members />
        </AccessContext.Provider>
      ),
    }],
    { initialEntries: ["/members"] },
  );

  render(<RouterProvider router={router} />);
  return calls;
}

const rowOf = (email: string) => screen.getByText(email).closest("[role='listitem']") as HTMLElement;

describe("the members page", () => {
  it("shows a viewer who belongs, and offers them nothing to change", async () => {
    open("viewer");

    expect(await screen.findByText("member@example.test")).toBeDefined();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove|Withdraw/ })).toBeNull();
  });

  it("offers an admin only roles below their own, and no control over owners or themselves", async () => {
    open("admin");
    await screen.findByText("member@example.test");

    const inviteRoles = within(screen.getByLabelText("Role")).getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
    expect(inviteRoles).toEqual(["member", "viewer"]);

    expect(screen.queryByLabelText("Role for owner@example.test")).toBeNull();
    expect(screen.queryByLabelText("Role for me@example.test")).toBeNull();
    expect(within(rowOf("owner@example.test")).queryByRole("button")).toBeNull();

    const memberRoles = within(screen.getByLabelText("Role for member@example.test")).getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
    expect(memberRoles).not.toContain("owner");
    expect(memberRoles).not.toContain("admin");
  });

  it("offers an owner every role, including owner", async () => {
    open("owner");
    await screen.findByText("member@example.test");

    const roles = within(screen.getByLabelText("Role for member@example.test")).getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
    expect(roles).toContain("owner");
    expect(screen.getByLabelText("Role for owner@example.test")).toBeDefined();
  });

  it("invites by email and role", async () => {
    const user = userEvent.setup();
    const calls = open("admin");
    await screen.findByText("member@example.test");

    await user.type(screen.getByLabelText("Email"), "hire@example.test");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => {
      const invite = calls.find((call) => call.method === "POST" && call.url.pathname === "/members");
      expect(invite?.body).toMatchObject({ email: "hire@example.test", role: "member" });
    });
  });

  it("asks before removing someone, then removes them", async () => {
    const user = userEvent.setup();
    const calls = open("admin");
    await screen.findByText("member@example.test");

    const row = rowOf("member@example.test");
    await user.click(within(row).getByRole("button", { name: "Remove" }));

    expect(calls.some((call) => call.url.pathname.endsWith("/remove"))).toBe(false);
    expect(within(row).getByText("Remove them from the organization?")).toBeDefined();

    await user.click(within(row).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(calls.some((call) => call.url.pathname === "/members/m-member/remove")).toBe(true));
  });

  it("grants workspace access to a member", async () => {
    const user = userEvent.setup();
    const calls = open("admin");
    await screen.findByText("member@example.test");

    const row = rowOf("member@example.test");
    await user.click(within(row).getByRole("button", { name: "Workspace access" }));
    await user.selectOptions(within(row).getByLabelText("Access to Finance for member@example.test"), "member");

    await waitFor(() => {
      const grant = calls.find((call) => call.url.pathname === "/members/m-member/workspaces");
      expect(grant?.body).toMatchObject({ workspaceId: "ws-finance", access: "member" });
    });
  });
});
