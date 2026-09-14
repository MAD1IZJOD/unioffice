import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCan } from "../lib/access";
import { organizationId, type Me } from "../lib/api";
import type { SessionState } from "../lib/session";
import { json, stubNetwork } from "../test/network";

import SessionGate from "./SessionGate";

const session = vi.hoisted(() => ({
  state: { status: "signed_out" } as SessionState,
}));

vi.mock("../lib/session", () => ({
  useSession: () => session.state,
  accessToken: async () => "session-token",
  reportUnauthorized: () => {},
  onUnauthorized: () => () => {},
  signOut: vi.fn(async () => {}),
  signInWithGoogle: vi.fn(async () => {}),
  sendSignInLink: vi.fn(async () => {}),
}));

const orgA = "aaaaaaaa-0000-4000-8000-000000000001";
const orgB = "bbbbbbbb-0000-4000-8000-000000000002";

function member(overrides: Partial<Me> = {}): Me {
  return {
    user: { id: "user-b", email: "b@example.test" },
    standing: "active",
    organization: {
      id: orgA,
      memberId: "member-b",
      role: "member",
      permissions: ["organization.read", "missions.create", "missions.operate", "approvals.decide", "knowledge.propose"],
      workspaces: [],
    },
    memberships: [{ organizationId: orgA, role: "member", status: "active" }],
    ...overrides,
  };
}

function Shell() {
  const canStart = useCan("missions.create");
  const canManageMembers = useCan("members.manage");

  return <p>{`inside start:${canStart} members:${canManageMembers}`}</p>;
}

function signIn() {
  session.state = { status: "signed_in", userId: "user-b", email: "b@example.test" };
}

describe("the session gate", () => {
  it("asks a signed-out person to sign in and shows nothing of the company", () => {
    session.state = { status: "signed_out" };

    render(<SessionGate><Shell /></SessionGate>);

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.queryByText(/inside/)).toBeNull();
  });

  it("lets an active member in, acting in the organization the API resolved, with what their role allows", async () => {
    signIn();
    const calls = stubNetwork(() => json(200, member()));

    render(<SessionGate><Shell /></SessionGate>);

    expect(await screen.findByText("inside start:true members:false")).toBeTruthy();
    expect(calls[0]!.url.pathname).toBe("/me");
    expect(organizationId()).toBe(orgA);
  });

  it("keeps someone who belongs nowhere out, and says what to do", async () => {
    signIn();
    stubNetwork(() => json(200, member({ standing: "none", organization: null, memberships: [] })));

    render(<SessionGate><Shell /></SessionGate>);

    expect(await screen.findByRole("heading", { name: "You are not a member of an organization yet" })).toBeTruthy();
    expect(screen.queryByText(/inside/)).toBeNull();
  });

  it("keeps a suspended member out", async () => {
    signIn();
    stubNetwork(() => json(200, member({ standing: "suspended", organization: null })));

    render(<SessionGate><Shell /></SessionGate>);

    expect(await screen.findByRole("heading", { name: "Your access is suspended" })).toBeTruthy();
    expect(screen.queryByText(/inside/)).toBeNull();
  });

  it("forgets a remembered organization they no longer belong to and opens one they do", async () => {
    signIn();
    window.localStorage.setItem("unioffice.organization", orgB);
    const calls = stubNetwork(({ url }) =>
      url.searchParams.get("organizationId") === orgB
        ? json(200, member({ standing: "none", organization: null }))
        : json(200, member()));

    render(<SessionGate><Shell /></SessionGate>);

    expect(await screen.findByText(/inside/)).toBeTruthy();
    expect(calls.map((call) => call.url.searchParams.get("organizationId"))).toEqual([orgB, null]);
    expect(window.localStorage.getItem("unioffice.organization")).toBeNull();
  });

  it("offers a retry when the API cannot be reached", async () => {
    signIn();
    stubNetwork(() => json(500, { error: { message: "An internal error occurred." } }));

    render(<SessionGate><Shell /></SessionGate>);

    expect(await screen.findByRole("heading", { name: "Could not load your access" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
