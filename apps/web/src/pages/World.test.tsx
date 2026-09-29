import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { OrganizationRole, WorldAgent, WorldSnapshot } from "../lib/api";
import { AccessContext } from "../lib/access";

import { signedInAs } from "../test/access";
import { json, stubNetwork } from "../test/network";
import World from "./World";

/**
 * The world page over the real client, with only the network scripted.
 *
 * What these hold it to: it shows what the server said and nothing more -
 * an empty room is empty, an agent busy on a mission the viewer cannot open
 * is not told on what - every action is a link into the page that owns it,
 * offered only to a role that could use it, and opening the page replays
 * nothing.
 */

function agent(id: string, overrides: Partial<WorldAgent> = {}): WorldAgent {
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    type: "specialist",
    status: "active",
    presence: "available",
    capabilities: ["coding"],
    roomId: "hall",
    seat: 0,
    workingElsewhere: false,
    upcomingSteps: 0,
    planningElsewhere: false,
    ...overrides,
  };
}

function snapshot(): WorldSnapshot {
  return {
    organizationId: "org",
    generatedAt: new Date().toISOString(),
    rooms: [
      { id: "hall", kind: "hall", name: "Company hall", agentIds: ["tyrion", "mike"] },
      { id: "eng", kind: "workspace", name: "Engineering", slug: "engineering", agentIds: ["tony"] },
      { id: "ops", kind: "workspace", name: "Operations", slug: "operations", agentIds: [] },
    ],
    agents: [
      agent("tyrion", { type: "orchestrator", capabilities: ["planning"] }),
      agent("mike", { seat: 1, capabilities: ["research"], presence: "working", workingElsewhere: true }),
      agent("tony", {
        roomId: "eng",
        presence: "waiting",
        current: { missionId: "launch", missionName: "Launch", taskTitle: "Ship the build", state: "waiting" },
      }),
    ],
    missions: [{ id: "launch", name: "Launch", status: "waiting_approval", workspaceId: "eng", agentIds: ["tony"], steps: 2, completedSteps: 1 }],
    handoffs: [
      {
        from: { id: "mike", name: "Mike" },
        to: { id: "tony", name: "Tony" },
        fromStep: { number: 1, title: "Research it" },
        toStep: { number: 2, title: "Ship the build" },
        state: "waiting",
        sentence: "Mike finished “Research it”. Tony is held until someone decides.",
        at: new Date().toISOString(),
        missionId: "launch",
        missionName: "Launch",
      },
    ],
  };
}

function open(role: OrganizationRole = "owner", data: WorldSnapshot = snapshot()) {
  const calls = stubNetwork((call) =>
    call.url.pathname.endsWith("/world") ? json(200, data) : json(404, { error: { message: "Not here." } }));

  const router = createMemoryRouter(
    [
      {
        path: "/world",
        element: (
          <AccessContext.Provider value={signedInAs(role)}>
            <World />
          </AccessContext.Provider>
        ),
      },
      { path: "*", element: <p>Somewhere else</p> },
    ],
    { initialEntries: ["/world"] },
  );

  render(<RouterProvider router={router} />);
  return calls;
}

async function asList() {
  await userEvent.click(await screen.findByRole("button", { name: "List" }));
}

describe("the world", () => {
  it("counts only what the server reported", async () => {
    open();

    expect(await screen.findByText(/3 agents in 3 rooms/)).toBeDefined();
    expect(screen.getByText(/1 working/)).toBeDefined();
    expect(screen.getByText(/1 waiting on a decision/)).toBeDefined();
    expect(screen.getByText(/1 handoff in play/)).toBeDefined();
  });

  it("keeps an empty room honestly empty", async () => {
    open();
    await asList();

    const operations = screen.getByRole("region", { name: "Operations" });
    expect(within(operations).getByText("Nobody works here.")).toBeDefined();
  });

  it("says someone is working without saying on what, when the viewer cannot open it", async () => {
    open();
    await asList();

    expect(screen.getByText("Working on a mission you cannot open.")).toBeDefined();
  });

  it("offers the decision to a role that can make it, and the mission's own record", async () => {
    open("owner");
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Tony" });
    expect(within(details).getByText("Held on “Ship the build” until someone decides.")).toBeDefined();
    expect(within(details).getByRole("link", { name: /Review the decision/ }).getAttribute("href")).toBe("/approvals");
    expect(within(details).getByRole("link", { name: /Open the mission/ }).getAttribute("href")).toBe("/missions/launch");
    expect(within(details).getByRole("link", { name: "Open profile" }).getAttribute("href")).toBe("/workforce/tony");
  });

  it("offers a viewer the record and not the decision", async () => {
    open("viewer");
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Tony" });
    expect(within(details).queryByRole("link", { name: /Review the decision/ })).toBeNull();
    expect(within(details).getByText("Your role can follow this decision but not make it.")).toBeDefined();
  });

  it("explains a handoff as what the mission recorded, and links to that record", async () => {
    open();
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Mike → Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Work changing hands" });
    expect(within(details).getByText("Mike finished “Research it”. Tony is held until someone decides.")).toBeDefined();
    expect(within(details).getByText(/Nobody met/)).toBeDefined();
    expect(within(details).getByRole("link", { name: /Open the mission record/ }).getAttribute("href")).toBe("/missions/launch");
  });

  it("names the result a handoff delivered and opens it in the mission's own room", async () => {
    const data = snapshot();
    data.handoffs[0]!.delivered = { artifactId: "result-1", name: "Market notes" };
    open("owner", data);
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Mike → Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Work changing hands" });
    expect(within(details).getByText("Market notes")).toBeDefined();
    expect(within(details).getByRole("link", { name: /Open the result/ }).getAttribute("href"))
      .toBe("/missions/launch?artifact=result-1");
  });

  it("offers no result to open when the step stored none", async () => {
    open();
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Mike → Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Work changing hands" });
    expect(within(details).queryByRole("link", { name: /Open the result/ })).toBeNull();
  });

  it("replays nothing on opening: the office is shown as it is", async () => {
    open();

    expect(await screen.findByText(/Nothing has changed since you opened the office/)).toBeDefined();
  });

  it("draws nobody when nobody works here", async () => {
    open("owner", { ...snapshot(), rooms: [{ id: "hall", kind: "hall", name: "Company hall", agentIds: [] }], agents: [], missions: [], handoffs: [] });

    expect(await screen.findByText("Nobody works here yet.")).toBeDefined();
  });
});
