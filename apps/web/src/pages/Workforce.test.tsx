import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AccessContext } from "../lib/access";
import type { OrganizationRole, Workforce as WorkforceData, WorkforceMember } from "../lib/api";
import { signedInAs } from "../test/access";
import { deferred, json, stubNetwork } from "../test/network";
import Workforce from "./Workforce";

/**
 * The workforce as a person sees it, over the real client with only the
 * network scripted. Every status and line of work is the API's; the page only
 * arranges it.
 */

const at = new Date(Date.now() - 2 * 3_600_000).toISOString();

function member(name: string, overrides: Partial<WorkforceMember> = {}): WorkforceMember {
  return {
    id: `agent-${name.toLowerCase()}`,
    name,
    description: `${name} does the work.`,
    type: "specialist",
    status: "active",
    presence: "available",
    capabilities: ["calculation", "financial_analysis"],
    tools: [{ id: "calculator", name: "Calculator", description: "Arithmetic.", registered: true }],
    workingElsewhere: false,
    upcomingSteps: 0,
    recent: { completed: 0, failed: 0 },
    ...overrides,
  };
}

function roster(members: WorkforceMember[]): WorkforceData {
  const count = (presence: WorkforceMember["presence"]) => members.filter((entry) => entry.presence === presence).length;

  return {
    organizationId: "org",
    generatedAt: new Date().toISOString(),
    missionWindow: 100,
    summary: {
      total: members.length,
      working: count("working"),
      waiting: count("waiting"),
      available: count("available"),
      paused: count("paused"),
      unavailable: count("unavailable"),
    },
    members,
  };
}

const company = roster([
  member("Tony", {
    capabilities: ["coding", "technical_design", "data_transformation"],
    presence: "working",
    current: { missionId: "mission-launch", missionName: "Launch Product X", taskTitle: "Build authentication flow", state: "working" },
    tools: [
      { id: "calculator", name: "Calculator", description: "", registered: true },
      { id: "json_transform", name: "JSON Transform", description: "", registered: true },
    ],
  }),
  member("Harvey", {
    presence: "waiting",
    current: { missionId: "mission-budget", missionName: "Q3 budget", taskTitle: "Approve the spend", state: "waiting" },
  }),
  member("Mike", {
    capabilities: ["research", "synthesis", "writing"],
    tools: [],
    lastOutcome: { missionId: "mission-market", missionName: "Market scan", taskTitle: "Summarise competitors", outcome: "completed", at },
    recent: { completed: 4, failed: 1 },
  }),
  member("Jamie", { status: "paused", presence: "paused", capabilities: ["people_operations"] }),
  member("Peter", { presence: "working", workingElsewhere: true, capabilities: ["communication"] }),
]);

function open(role: OrganizationRole, respond: () => Response | Promise<Response> = () => json(200, company)) {
  const calls = stubNetwork((call) =>
    call.url.pathname === "/workforce" ? respond() : call.method === "POST" ? json(201, { agent: {} }) : json(200, { workspaces: [], tools: [] }));

  const router = createMemoryRouter(
    [
      {
        path: "/workforce",
        element: (
          <AccessContext.Provider value={signedInAs(role)}>
            <Workforce />
          </AccessContext.Provider>
        ),
      },
    ],
    { initialEntries: ["/workforce"] },
  );

  render(<RouterProvider router={router} />);
  return calls;
}

const row = (name: string) => screen.getByRole("article", { name });

describe("the workforce", () => {
  it("says it is reading the workforce until the API answers", async () => {
    const pending = deferred<Response>();
    open("owner", () => pending.promise);

    expect(screen.getByRole("status").textContent).toContain("Reading the workforce");

    pending.resolve(json(200, company));
    expect(await screen.findByRole("article", { name: "Tony" })).toBeDefined();
  });

  it("puts who is at work first, then who is free, then who is off work", async () => {
    open("owner");
    await screen.findByRole("article", { name: "Tony" });

    const names = (section: string) =>
      within(screen.getByRole("region", { name: section })).getAllByRole("article").map((entry) => entry.getAttribute("aria-label"));

    expect(names("At work")).toEqual(["Tony", "Harvey", "Peter"]);
    expect(names("Available")).toEqual(["Mike"]);
    expect(names("Paused or unavailable")).toEqual(["Jamie"]);
  });

  it("shows current work with a link to its mission, and the agent's profile behind its name", async () => {
    open("owner");
    const tony = await screen.findByRole("article", { name: "Tony" });

    expect(within(tony).getByText("Working")).toBeDefined();
    expect(within(tony).getByRole("link", { name: "Launch Product X" }).getAttribute("href")).toBe("/missions/mission-launch");
    expect(within(tony).getByText("Build authentication flow")).toBeDefined();
    expect(within(tony).getByRole("link", { name: /^Tony/ }).getAttribute("href")).toBe("/workforce/agent-tony");
  });

  it("names each agent by the role they were given, and the rest by what they can do", async () => {
    open("owner", () => json(200, roster([
      ...company.members,
      member("Bruce", { role: "Backend Engineer", capabilities: ["backend_development", "coding", "technical_design"] }),
    ])));

    expect(within(await screen.findByRole("article", { name: "Bruce" })).getByText("Backend Engineer")).toBeDefined();
    expect(within(row("Tony")).getByText("Engineering")).toBeDefined();
  });

  it("names each state the way the backend records it", async () => {
    open("owner");
    await screen.findByRole("article", { name: "Tony" });

    expect(within(row("Harvey")).getByText("Waiting on a decision")).toBeDefined();
    expect(within(row("Harvey")).getByText(/Held for a decision/)).toBeDefined();
    expect(within(row("Jamie")).getByText("Paused")).toBeDefined();
    expect(within(row("Jamie")).getByText("Not being given new work")).toBeDefined();
  });

  it("shows the capabilities and tools the backend granted, and says when there are no tools", async () => {
    open("owner");
    const tony = await screen.findByRole("article", { name: "Tony" });

    expect(within(within(tony).getByLabelText("Capabilities")).getAllByText(/./).map((token) => token.textContent)).toEqual([
      "coding",
      "technical design",
      "data transformation",
    ]);
    expect(within(tony).getByLabelText("Tools").textContent).toContain("JSON Transform");
    expect(within(row("Mike")).getByLabelText("Tools").textContent).toBe("no tools");
  });

  it("shows a free agent's last outcome and recent counts", async () => {
    open("owner");
    const mike = await screen.findByRole("article", { name: "Mike" });

    expect(within(mike).getByRole("link", { name: "Market scan" }).getAttribute("href")).toBe("/missions/mission-market");
    expect(within(mike).getByText(/Finished “Summarise competitors”/)).toBeDefined();
    expect(within(mike).getByText("4 done · 1 failed")).toBeDefined();
  });

  it("says an agent is busy elsewhere without naming a mission the person cannot open", async () => {
    open("member");
    const peter = await screen.findByRole("article", { name: "Peter" });

    expect(within(peter).getByText("On a mission outside your workspaces")).toBeDefined();
    const missionLinks = within(peter).queryAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/missions"));
    expect(missionLinks).toHaveLength(0);
  });

  it("opens each agent in the World, on its own desk, whatever the viewer's role", async () => {
    for (const role of ["owner", "viewer"] as const) {
      open(role);
      const link = within(await screen.findByRole("article", { name: "Tony" })).getByRole("link", { name: "View Tony in World" });
      expect(link.getAttribute("href")).toBe("/world?agent=agent-tony");
      cleanup();
    }
  });

  it("offers adding an agent only to roles that configure the workforce", async () => {
    open("owner");
    expect(await screen.findByRole("button", { name: "Add an agent" })).toBeDefined();
  });

  it("adds an agent with the role it is given, and without one when it is left empty", async () => {
    const user = userEvent.setup();
    const calls = open("owner");

    const hire = async (role: string) => {
      await user.click(await screen.findByRole("button", { name: "Add an agent" }));
      await user.type(screen.getByLabelText("Name"), "Jessica");
      if (role) await user.type(screen.getByLabelText("Role"), role);
      await user.type(screen.getByLabelText("What it does"), "Decides what gets built next.");
      await user.type(screen.getByPlaceholderText(/research, calculation/), "product management{Enter}");
      await user.click(screen.getByRole("button", { name: "Add to the workforce" }));
    };

    await hire("  Product Manager ");
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(1));
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
      name: "Jessica",
      role: "Product Manager",
      capabilities: ["product_management"],
    });

    await hire("");
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(2));
    expect(calls.filter((call) => call.method === "POST")[1]?.body).not.toHaveProperty("role");
    // Typing two whole forms is slow under a full, parallel run.
  }, 15_000);

  it("does not offer adding an agent to a member", async () => {
    open("member");
    await screen.findByRole("article", { name: "Tony" });
    expect(screen.queryByRole("button", { name: "Add an agent" })).toBeNull();
  });

  it("says plainly when nobody works for the organization", async () => {
    open("viewer", () => json(200, roster([])));

    expect(await screen.findByText("No agents work for this organization.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /agent/ })).toBeNull();
  });

  it("explains a failed read and offers to try again", async () => {
    open("owner", () => json(500, { error: { code: "INTERNAL_ERROR", message: "An internal error occurred." } }));

    expect(await screen.findByText("UNIOFFICE couldn't load the workforce")).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });
});
