import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccessContext } from "../lib/access";
import type { ConnectionItem, ConnectionsOverview, OrganizationRole } from "../lib/api";
import { signedInAs } from "../test/access";
import { json, stubNetwork } from "../test/network";
import Connection from "./Connection";
import Connections from "./Connections";

const leave = vi.hoisted(() => vi.fn());

vi.mock("../lib/connections", async (original) => ({
  ...(await original<typeof import("../lib/connections")>()),
  leaveForAuthorization: leave,
}));

/**
 * Settings -> Connections as each role sees it, over the real client with the
 * network scripted. The page offers by role; the API decides.
 */

const connectedAt = new Date(Date.now() - 86_400_000).toISOString();

function github(overrides: Partial<ConnectionItem> = {}): ConnectionItem {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    provider: "github",
    providerName: "GitHub",
    status: "active",
    workspace: null,
    account: "octo-dev",
    scopes: ["public_repo"],
    capabilities: ["github.read"],
    availableCapabilities: [
      { capability: "github.read", label: "Read repositories, issues, pull requests and commits", access: "read", enabled: true, grantable: true },
      { capability: "github.write", label: "Open issues, create branches and open pull requests, each with a person's approval", access: "write", enabled: false, grantable: true },
    ],
    connectedBy: "owner@example.test",
    connectedAt,
    lastUsedAt: null,
    problem: null,
    revokedAt: null,
    tools: [
      { id: "github_issue", name: "GitHub issue", access: "read" },
      { id: "github_create_issue", name: "Create GitHub issue", access: "write" },
    ],
    ...overrides,
  };
}

function overview(connections: ConnectionItem[], configured = true): ConnectionsOverview {
  return {
    providers: [
      { provider: "github", name: "GitHub", description: "Repositories, branches, issues, pull requests and commits.", configured },
      { provider: "google_drive", name: "Google Drive", description: "Find and read documents. Read-only.", configured },
    ],
    connections,
  };
}

function open(role: OrganizationRole, options: { data?: ConnectionsOverview; path?: string; detail?: ConnectionItem } = {}) {
  const data = options.data ?? overview([github()]);

  const calls = stubNetwork((call) => {
    if (call.method === "GET" && call.url.pathname === "/connections") return json(200, data);
    if (call.method === "GET" && call.url.pathname.startsWith("/connections/")) {
      return options.detail ? json(200, { connection: options.detail }) : json(404, { error: { code: "NOT_FOUND", message: "Connection not found." } });
    }
    if (call.url.pathname === "/organization") return json(200, { organization: { id: "org", name: "Test" }, workspaces: [] });
    if (call.method === "POST" && call.url.pathname.endsWith("/authorize")) {
      return json(200, { authorizationUrl: "https://github.com/login/oauth/authorize?client_id=abc&state=s" });
    }
    if (call.method === "POST" && call.url.pathname.endsWith("/disconnect")) {
      return json(200, { connection: github({ status: "revoked", revokedAt: new Date().toISOString() }), providerRevoked: true });
    }
    if (call.method === "POST" && call.url.pathname.endsWith("/capabilities")) {
      return json(200, { connection: github({ capabilities: (call.body as { capabilities: ConnectionItem["capabilities"] }).capabilities }) });
    }
    return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
  });

  const router = createMemoryRouter(
    [
      { path: "/settings/connections", element: <Connections /> },
      { path: "/settings/connections/:connectionId", element: <Connection /> },
    ].map((route) => ({
      ...route,
      element: <AccessContext.Provider value={signedInAs(role)}>{route.element}</AccessContext.Provider>,
    })),
    { initialEntries: [options.path ?? "/settings/connections"] },
  );

  render(<RouterProvider router={router} />);
  return calls;
}

const rowOf = (name: string) => screen.getByRole("listitem", { name });

beforeEach(() => {
  leave.mockReset();
});

describe("the connections page", () => {
  it("shows a viewer what is connected and by whom, and offers nothing to change", async () => {
    open("viewer");

    const row = await screen.findByRole("listitem", { name: "GitHub" });
    expect(within(row).getByText(/octo-dev · connected by owner@example.test/)).toBeDefined();
    expect(within(row).getByText("Connected")).toBeDefined();

    expect(screen.queryByRole("button", { name: /Connect/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("lets an owner connect a system by sending them to the provider", async () => {
    const calls = open("owner");
    const user = userEvent.setup();

    const drive = await screen.findByRole("listitem", { name: "Google Drive" });
    await user.click(within(drive).getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(leave).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?client_id=abc&state=s"));

    const request = calls.find((call) => call.method === "POST")!;
    expect(request.url.pathname).toBe("/connections/google_drive/authorize");
    expect(Object.keys(request.body as object).sort()).toEqual(["organizationId"]);
  });

  it("asks before disconnecting, and disconnects", async () => {
    const calls = open("admin");
    const user = userEvent.setup();

    await screen.findByRole("listitem", { name: "GitHub" });
    await user.click(within(rowOf("GitHub")).getByRole("button", { name: "Disconnect" }));
    expect(calls.some((call) => call.url.pathname.endsWith("/disconnect"))).toBe(false);

    await user.click(within(rowOf("GitHub")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(calls.some((call) => call.url.pathname === "/connections/c0000000-0000-4000-8000-000000000001/disconnect")).toBe(true));
  });

  it("says plainly when a provider is not set up, and offers no button that cannot work", async () => {
    open("owner", { data: overview([], false) });

    expect(await screen.findByText(/No external system is set up on this server yet/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("shows a failed round trip as a fixed sentence, never the text from the address", async () => {
    open("owner", { path: "/settings/connections?error=%3Cimg%20src%3Dx%3E" });

    expect(await screen.findByText("The connection was not completed.")).toBeDefined();
    expect(screen.queryByText(/img/)).toBeNull();
  });

  it("offers a reconnect when the provider stopped accepting the connection", async () => {
    open("owner", { data: overview([github({ status: "needs_attention", problem: "The provider no longer accepts this connection. Reconnect it." })]) });

    const row = await screen.findByRole("listitem", { name: "GitHub" });
    expect(within(row).getByText("Needs reconnecting")).toBeDefined();
    expect(within(row).getByRole("button", { name: "Reconnect" })).toBeDefined();
  });
});

describe("a connection's page", () => {
  it("shows the facts a person needs, and nothing secret", async () => {
    open("member", { path: "/settings/connections/c0000000-0000-4000-8000-000000000001", detail: github({ lastUsedAt: new Date().toISOString() }) });

    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeDefined();
    const facts = screen.getByRole("list", { name: "Connection facts" });
    expect(within(facts).getByText("owner@example.test")).toBeDefined();
    expect(within(facts).getByText("Whole organization")).toBeDefined();
    expect(screen.getByText("Public repositories (read and write)")).toBeDefined();

    // A member sees the capabilities but cannot change them, and cannot disconnect.
    for (const box of within(screen.getByRole("group", { name: "Capabilities" })).getAllByRole("checkbox")) {
      expect((box as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.queryByRole("button", { name: /Disconnect/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/token|secret/i);
  });

  it("lets an owner allow writes, sending only the capability list", async () => {
    const calls = open("owner", { path: "/settings/connections/c0000000-0000-4000-8000-000000000001", detail: github() });
    const user = userEvent.setup();

    const writes = await screen.findByRole("checkbox", { name: /Open issues/ });
    await user.click(writes);

    await waitFor(() => expect(calls.some((call) => call.url.pathname.endsWith("/capabilities"))).toBe(true));
    const request = calls.find((call) => call.url.pathname.endsWith("/capabilities"))!;
    expect(request.body).toEqual({ organizationId: expect.any(String), capabilities: ["github.read", "github.write"] });
  });

  it("reads as not found for a connection the person cannot reach", async () => {
    open("member", { path: "/settings/connections/c0000000-0000-4000-8000-000000000009" });

    expect(await screen.findByText("This connection is not here")).toBeDefined();
  });
});
