import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AccessContext } from "../lib/access";
import type { AgentProfile, OrganizationRole } from "../lib/api";
import { signedInAs } from "../test/access";
import { deferred, json, stubNetwork } from "../test/network";
import Agent from "./Agent";

/**
 * An agent's profile over the real client with only the network scripted.
 */

const at = new Date(Date.now() - 3_600_000).toISOString();

const tony: AgentProfile = {
  member: {
    id: "agent-tony",
    name: "Tony",
    description: "Builds. Engineering analysis, technical design and structured data transformation.",
    type: "specialist",
    status: "active",
    presence: "working",
    capabilities: ["coding", "technical_design", "data_transformation"],
    tools: [
      { id: "calculator", name: "Calculator", description: "Arithmetic.", registered: true },
      { id: "json_transform", name: "JSON Transform", description: "Reshape JSON.", registered: true },
      { id: "teleporter", name: "teleporter", description: "", registered: false },
    ],
    current: { missionId: "mission-launch", missionName: "Launch Product X", taskTitle: "Build authentication flow", state: "working", since: at },
    workingElsewhere: false,
    upcomingSteps: 0,
    recent: { completed: 7, failed: 1 },
  },
  history: [
    { taskId: "t1", taskTitle: "Design the schema", status: "completed", missionId: "mission-launch", missionName: "Launch Product X", at },
    { taskId: "t2", taskTitle: "Migrate the data", status: "failed", missionId: "mission-migrate", missionName: "Data migration", at },
  ],
  artifacts: [{ id: "a1", name: "Schema design", type: "analysis", missionId: "mission-launch", createdAt: at }],
  activity: [
    { id: "e1", type: "task.completed", at, summary: "Tony finished “Design the schema”", missionId: "mission-launch" },
    { id: "e2", type: "task.failed", at, summary: "“Migrate the data” failed", missionId: "mission-migrate" },
  ],
  governance: {
    tools: [
      { toolId: "calculator", name: "Calculator", access: "allowed", risk: "low", policyNames: [], explanation: "Granted, and no policy restricts it." },
      { toolId: "json_transform", name: "JSON Transform", access: "requires_approval", risk: "high", policyNames: ["Data changes need a person"], explanation: "Granted, but a person must approve each call." },
    ],
    policies: [{ id: "p1", name: "Data changes need a person", effect: "require_approval", risk: "high" }],
  },
};

function open(role: OrganizationRole, respond: () => Response | Promise<Response> = () => json(200, tony)) {
  const calls = stubNetwork((call) =>
    call.url.pathname === "/workforce/agent-tony" ? respond() : json(200, { tools: [], workspaces: [] }));

  const router = createMemoryRouter(
    [
      {
        path: "/workforce/:agentId",
        element: (
          <AccessContext.Provider value={signedInAs(role)}>
            <Agent />
          </AccessContext.Provider>
        ),
      },
    ],
    { initialEntries: ["/workforce/agent-tony"] },
  );

  render(<RouterProvider router={router} />);
  return calls;
}

const section = (name: string) => screen.getByRole("region", { name });

describe("an agent's profile", () => {
  it("says it is opening the profile until the API answers", async () => {
    const pending = deferred<Response>();
    open("owner", () => pending.promise);

    expect(screen.getByRole("status").textContent).toContain("Opening the profile");
    pending.resolve(json(200, tony));
    expect(await screen.findByRole("heading", { name: "Tony" })).toBeDefined();
  });

  it("shows who the agent is and that it is working", async () => {
    open("owner");

    expect(await screen.findByRole("heading", { name: "Tony" })).toBeDefined();
    expect(screen.getAllByText("Working").length).toBeGreaterThan(0);
    expect(screen.getByText(/Engineering · specialist/)).toBeDefined();
    expect(screen.getByRole("link", { name: "The workforce" }).getAttribute("href")).toBe("/workforce");
  });

  it("links its current work to the mission", async () => {
    open("owner");
    await screen.findByRole("heading", { name: "Tony" });

    const link = within(section("Current work")).getByRole("link");
    expect(link.getAttribute("href")).toBe("/missions/mission-launch");
    expect(link.textContent).toContain("Build authentication flow");
    expect(link.textContent).toContain("Launch Product X");
  });

  it("lists its capabilities, and its tools with what governance lets it do with each", async () => {
    open("owner");
    await screen.findByRole("heading", { name: "Tony" });

    expect(within(section("Capabilities")).getByText("technical design")).toBeDefined();

    const tools = section("Tools");
    expect(within(tools).getByText("Allowed")).toBeDefined();
    expect(within(tools).getByText("Needs approval")).toBeDefined();
    expect(within(tools).getByText(/Data changes need a person/)).toBeDefined();
    expect(within(tools).getByText("No longer registered")).toBeDefined();
    expect(within(section("Rules")).getByRole("link", { name: /Data changes need a person/ }).getAttribute("href")).toBe("/governance");
  });

  it("shows its history, artifacts and record, each leading to its mission", async () => {
    open("owner");
    await screen.findByRole("heading", { name: "Tony" });

    const history = within(section("Work history")).getAllByRole("link");
    expect(history.map((link) => link.getAttribute("href"))).toEqual(["/missions/mission-launch", "/missions/mission-migrate"]);
    expect(screen.getByRole("link", { name: /Schema design/ }).getAttribute("href")).toBe("/missions/mission-launch");

    const record = within(screen.getByRole("list", { name: "Recent activity" }));
    expect(record.getByRole("link", { name: "Tony finished “Design the schema”" }).getAttribute("href")).toBe("/missions/mission-launch");
  });

  it("says plainly when there is no current work or history", async () => {
    open("owner", () =>
      json(200, {
        ...tony,
        member: { ...tony.member, presence: "available", current: undefined },
        history: [],
        artifacts: [],
        activity: [],
      }));
    await screen.findByRole("heading", { name: "Tony" });

    expect(within(section("Current work")).getByText("Nothing right now. Available to be given work.")).toBeDefined();
    expect(screen.getByText("Nothing has been given to this agent yet.")).toBeDefined();
    expect(screen.getByText("Nothing recorded for this agent yet.")).toBeDefined();
  });

  it("offers configuration only to roles that configure the workforce", async () => {
    open("owner");
    expect(await screen.findByRole("button", { name: "Configure" })).toBeDefined();
  });

  it("does not offer configuration, pausing or resuming to a viewer or member", async () => {
    for (const role of ["viewer", "member"] as const) {
      open(role);
      await screen.findByRole("heading", { name: "Tony" });
      expect(screen.queryByRole("button", { name: "Configure" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
      cleanup();
    }
  });

  it("pauses an active agent through the API, then reads the profile again", async () => {
    const user = userEvent.setup();
    const calls = open("admin");

    await user.click(await screen.findByRole("button", { name: "Pause" }));

    await waitFor(() => {
      const update = calls.find((call) => call.method === "POST" && call.url.pathname === "/agents/agent-tony");
      expect(update?.body).toMatchObject({ status: "paused" });
    });
    await waitFor(() => expect(calls.filter((call) => call.url.pathname === "/workforce/agent-tony").length).toBe(2));
  });

  it("offers to resume a paused agent, and says a step it is still on is left to finish", async () => {
    open("owner", () => json(200, { ...tony, member: { ...tony.member, status: "paused", presence: "paused" } }));

    expect(await screen.findByRole("button", { name: "Resume" })).toBeDefined();
    expect(screen.getByText(/The step it is on now is left to finish/)).toBeDefined();
  });

  it("says a paused agent with nothing running is not given new work", async () => {
    open("owner", () =>
      json(200, { ...tony, member: { ...tony.member, status: "paused", presence: "paused", current: undefined } }));

    expect(await screen.findByText("Paused. It is not given new work until it is resumed.")).toBeDefined();
  });

  it("says why the API refused to pause an agent", async () => {
    const user = userEvent.setup();
    stubNetwork((call) =>
      call.method === "POST"
        ? json(400, { error: { code: "VALIDATION_ERROR", message: "Tyrion is the only active orchestrator." } })
        : call.url.pathname === "/workforce/agent-tony" ? json(200, tony) : json(200, { tools: [], workspaces: [] }));

    const router = createMemoryRouter(
      [{ path: "/workforce/:agentId", element: <AccessContext.Provider value={signedInAs("owner")}><Agent /></AccessContext.Provider> }],
      { initialEntries: ["/workforce/agent-tony"] },
    );
    render(<RouterProvider router={router} />);

    await user.click(await screen.findByRole("button", { name: "Pause" }));

    expect(await screen.findByText("The agent's status was not changed")).toBeDefined();
    expect(screen.getByText("Tyrion is the only active orchestrator.")).toBeDefined();
  });

  it("says an unknown or out-of-reach agent is not in the workforce, without retrying", async () => {
    open("member", () => json(404, { error: { code: "NOT_FOUND", message: "Agent not found: agent-tony" } }));

    expect(await screen.findByText("This agent is not in your workforce")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers a retry when the profile could not be read for another reason", async () => {
    open("owner", () => json(500, { error: { code: "INTERNAL_ERROR", message: "An internal error occurred." } }));

    expect(await screen.findByText("This agent could not be opened")).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });
});
