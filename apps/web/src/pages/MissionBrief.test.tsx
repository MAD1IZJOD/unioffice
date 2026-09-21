import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type {
  MissionIntelligence,
  PlanStep,
  PreflightCheck,
} from "../lib/api";

import { deferred, json, stubNetwork, type RecordedCall } from "../test/network";
import MissionBrief from "./MissionBrief";

/**
 * The mission as a person reads it before committing to it, over the real
 * client with only the network scripted.
 *
 * What these check is that the page is a window rather than an author: the
 * verdict shown is the server's verdict, a remedy appears only where the
 * server offered one, nothing starts without the person pressing start, and
 * no identifier or resolver score reaches the primary reading.
 */

const MISSION = "cccccccc-0000-4000-8000-000000000001";

function step(number: number, overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    number,
    title: `Step ${number}`,
    description: "In detail.",
    agent: { id: "agent-harvey", name: "Harvey" },
    why: "Harvey can do what this step calls for and is cleared to use Calculator.",
    dependsOn: number > 1 ? [number - 1] : [],
    lane: number,
    needsApproval: false,
    ability: "Financial analysis",
    uses: ["Calculator"],
    status: "pending",
    technical: {
      requiredTools: ["calculator"],
      requiredCapabilities: ["financial_analysis"],
      skill: { slug: "financial-analysis", version: 1, scope: "system" },
      selectionReason: "Selected by deterministic rank: exact workspace compatibility, 1 required capability matches.",
    },
    ...overrides,
  };
}

function check(id: PreflightCheck["id"], overrides: Partial<PreflightCheck> = {}): PreflightCheck {
  return {
    id,
    name: id === "tools" ? "Tools" : "Workforce",
    state: "ok",
    summary: "All good.",
    steps: [],
    ...overrides,
  };
}

function intelligence(overrides: Partial<MissionIntelligence> = {}): MissionIntelligence {
  return {
    missionId: MISSION,
    generatedAt: new Date().toISOString(),
    status: "queued",
    stage: "planned",
    brief: {
      title: "Decide whether the laptop upgrade is worth it.",
      titleSource: "requested",
      objective: "Decide whether the laptop upgrade is worth it.",
      briefing: "Only the Bangalore team.",
      priority: "normal",
      successCriteria: [
        { text: "Work out the total cost", source: "planned" },
        { text: "Write the recommendation", source: "planned" },
      ],
      workAreas: ["Financial analysis"],
      participants: [{ id: "agent-harvey", name: "Harvey", role: "Financial analysis" }],
      gaps: [],
    },
    preflight: {
      state: "ready",
      headline: "Ready to start.",
      detail: "Everything this mission needs is in place.",
      checks: [check("workforce"), check("tools")],
      canStart: true,
    },
    plan: {
      steps: [step(1), step(2)],
      widestLane: 1,
      hasCycle: false,
      expectedOutputs: ["Write the recommendation"],
      approvalCount: 0,
    },
    ...overrides,
  };
}

function open(
  respond: () => Response | Promise<Response> = () => json(200, intelligence()),
  routes: (call: RecordedCall) => Response | Promise<Response> = () => json(200, {}),
) {
  const calls = stubNetwork((call) =>
    call.method === "GET" && call.url.pathname.endsWith("/intelligence") ? respond() : routes(call));

  const router = createMemoryRouter(
    [
      { path: "/missions/:missionId/brief", element: <MissionBrief /> },
      { path: "*", element: <p>Somewhere else</p> },
    ],
    { initialEntries: [`/missions/${MISSION}/brief`] },
  );

  render(<RouterProvider router={router} />);
  return calls;
}

describe("the mission brief", () => {
  it("says it is reading the mission until the API answers", async () => {
    const pending = deferred<Response>();
    open(() => pending.promise);

    expect(screen.getByRole("status").textContent).toContain("Reading the mission");

    pending.resolve(json(200, intelligence()));
    expect(await screen.findByText("Ready to start.")).toBeDefined();
  });

  it("repeats what was asked for without rewriting it", async () => {
    open();
    await screen.findByText("Ready to start.");

    expect(screen.getAllByText("Decide whether the laptop upgrade is worth it.").length).toBeGreaterThan(0);
    expect(screen.getByText("Only the Bangalore team.")).toBeDefined();
    expect(screen.getByText("Work out the total cost")).toBeDefined();
  });

  it("shows the verdict, its reason and each check the server returned", async () => {
    open();
    await screen.findByText("Ready to start.");

    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByText("Everything this mission needs is in place.")).toBeDefined();

    // Scoped to the checks: "Tools" is also a label inside each step's
    // technical disclosure, which is a different thing entirely.
    const checks = document.querySelector(".intel-checks")!;
    expect(within(checks as HTMLElement).getByText("Workforce")).toBeDefined();
    expect(within(checks as HTMLElement).getByText("Tools")).toBeDefined();
  });

  it("lays the plan out in order, naming the agent and what it follows", async () => {
    open();
    await screen.findByText("Ready to start.");

    const steps = screen.getAllByRole("listitem").filter((item) => item.className.includes("intel-step"));
    expect(steps).toHaveLength(2);
    expect(within(steps[0]!).getByRole("link", { name: "Harvey" }).getAttribute("href")).toBe("/workforce/agent-harvey");
    expect(within(steps[1]!).getByText("after step 1")).toBeDefined();
    expect(screen.getAllByText("Financial analysis").length).toBeGreaterThan(0);
  });

  it("keeps the resolver's own words behind the technical disclosure", async () => {
    open();
    await screen.findByText("Ready to start.");

    expect(screen.getAllByText("How this was decided").length).toBe(2);
    expect(
      screen.getAllByText("Harvey can do what this step calls for and is cleared to use Calculator.").length,
    ).toBe(2);

    // Present in the DOM, but only inside a closed <details>.
    const disclosure = screen.getAllByText(/Selected by deterministic rank/)[0]!;
    expect(disclosure.closest("details")).not.toBeNull();
  });

  it("starts nothing until the person presses start, then goes to the room", async () => {
    const calls = open();
    await screen.findByText("Ready to start.");

    expect(calls.some((call) => call.method === "POST")).toBe(false);

    await userEvent.setup().click(screen.getByRole("button", { name: /Start mission/ }));

    await waitFor(() => expect(screen.getByText("Somewhere else")).toBeDefined());
    const started = calls.filter((call) => call.url.pathname.endsWith("/execute"));
    expect(started).toHaveLength(1);
  });

  it("says a mission is partly ready without hiding the start", async () => {
    open(() => json(200, intelligence({
      preflight: {
        state: "partially_ready",
        headline: "Ready, with one thing worth knowing.",
        detail: "The company had nothing recorded about this yet. The mission can still run.",
        checks: [check("inputs", { name: "Missing information", state: "warning", summary: "Nothing recorded yet.", steps: [1] })],
        canStart: true,
      },
    })));

    await screen.findByText("Ready, with one thing worth knowing.");
    expect(screen.getByText("Ready, with a limit")).toBeDefined();
    expect(screen.getByRole("button", { name: /Start mission/ })).toBeDefined();
    expect(screen.getByText("It will run with the limit above.")).toBeDefined();
  });

  it("refuses to offer a start for a blocked mission and says what is wrong", async () => {
    open(() => json(200, intelligence({
      preflight: {
        state: "blocked",
        headline: "This mission cannot start yet.",
        detail: "Harvey is not authorized for Calculator.",
        checks: [check("tools", {
          state: "blocked",
          summary: "Harvey is not authorized for Calculator.",
          steps: [1, 2],
          fix: { label: "Prepare Harvey", path: "/workforce/agent-harvey" },
        })],
        canStart: false,
        startNote: "Resolve what is blocking it and this mission can run.",
      },
    })));

    await screen.findByText("This mission cannot start yet.");
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Start mission/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Prepare Harvey/ }).getAttribute("href")).toBe("/workforce/agent-harvey");
    expect(screen.getByText("Steps 1, 2")).toBeDefined();
  });

  it("offers no remedy to someone the server offered none to", async () => {
    open(() => json(200, intelligence({
      preflight: {
        state: "blocked",
        headline: "This mission cannot start yet.",
        detail: "Harvey is not authorized for Calculator.",
        checks: [check("tools", { state: "blocked", summary: "Harvey is not authorized for Calculator.", steps: [1] })],
        canStart: false,
      },
    })));

    await screen.findByText("This mission cannot start yet.");
    expect(screen.queryByRole("link", { name: /Prepare Harvey/ })).toBeNull();
  });

  it("tells someone who cannot start it who can, instead of a dead button", async () => {
    open(() => json(200, intelligence({
      preflight: {
        ...intelligence().preflight,
        canStart: false,
        startNote: "Your role can follow this mission but not start it. An owner, an admin or a member can.",
      },
    })));

    await screen.findByText("Ready to start.");
    expect(screen.queryByRole("button", { name: /Start mission/ })).toBeNull();
    expect(screen.getByText(/can follow this mission but not start it/)).toBeDefined();
  });

  it("explains that the plan is still being written rather than showing a spinner", async () => {
    open(() => json(200, intelligence({
      stage: "planning",
      status: "planning",
      plan: null,
      preflight: {
        state: "unknown",
        headline: "Still being prepared.",
        detail: "UNIOFFICE is working out the steps.",
        checks: [],
        canStart: false,
      },
    })));

    expect(await screen.findByText(/Working out who should do this/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Start mission/ })).toBeNull();
  });

  it("asks the server to write the plan once for a mission that has none", async () => {
    // A mission with nothing planned yet claims no readiness at all, which is
    // what makes the two answers distinguishable here.
    const unplanned = intelligence({
      stage: "awaiting_plan",
      plan: null,
      brief: { ...intelligence().brief, successCriteria: [], participants: [] },
      preflight: {
        state: "unknown",
        headline: "Nothing to check yet.",
        detail: "This mission has no steps.",
        checks: [],
        canStart: false,
      },
    });

    let answered = 0;
    const calls = open(() => {
      answered += 1;
      return json(200, answered === 1 ? unplanned : intelligence());
    });

    await screen.findByText("Nothing to check yet.");

    await waitFor(() => {
      const prepared = calls.filter((call) => call.url.pathname.endsWith("/prepare"));
      expect(prepared).toHaveLength(1);
      expect(prepared[0]!.method).toBe("POST");
    });

    // And the plan it wrote is what the page then shows.
    expect(await screen.findByText("Ready to start.")).toBeDefined();
    expect(calls.filter((call) => call.url.pathname.endsWith("/prepare"))).toHaveLength(1);
  });

  it("never claims readiness for a mission that could not be prepared", async () => {
    open(() => json(200, intelligence({
      stage: "planning_failed",
      status: "failed",
      plan: null,
      preflight: {
        state: "unknown",
        headline: "This mission could not be prepared.",
        detail: "The local model was unavailable when this ran.",
        checks: [],
        canStart: false,
      },
    })));

    await screen.findByText("This mission could not be prepared.");
    expect(screen.getByText("Not checked")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Start mission/ })).toBeNull();
  });

  it("explains a failed read and offers a way back", async () => {
    open(() => json(500, { error: { message: "The database is unreachable." } }));

    expect(await screen.findByText("This mission could not be read")).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Every mission" }).getAttribute("href")).toBe("/missions");
  });

  it("marks the steps that will stop to ask, and what the mission produces", async () => {
    open(() => json(200, intelligence({
      plan: {
        steps: [step(1), step(2, { needsApproval: true, approvalReason: "This leaves the company." })],
        widestLane: 1,
        hasCycle: false,
        expectedOutputs: ["Write the recommendation"],
        approvalCount: 1,
      },
    })));

    await screen.findByText("Ready to start.");
    expect(screen.getByText("Waits for you")).toBeDefined();
    expect(screen.getByText("This leaves the company.")).toBeDefined();
    expect(screen.getByText("What you get")).toBeDefined();
  });

  it("does not offer to start a mission that is already on its way", async () => {
    open(() => json(200, intelligence({ stage: "under_way", status: "executing" })));

    await screen.findByText("Ready to start.");
    expect(screen.queryByRole("button", { name: /Start mission/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Watch it run/ }).getAttribute("href")).toBe(`/missions/${MISSION}`);
  });
});
