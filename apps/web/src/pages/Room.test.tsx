import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type {
  AgentSummary,
  ArtifactItem,
  ExecutionNode,
  ExecutionRoom,
  OrganizationRole,
  TaskItem,
} from "../lib/api";
import { AccessContext } from "../lib/access";

import { signedInAs } from "../test/access";
import { json, stubNetwork } from "../test/network";
import Room from "./Room";

/**
 * Whether the execution room offers to run a mission.
 *
 * The room used to decide that from the mission's status alone, so it could
 * offer "Run it" beside a brief that said the mission was blocked. It now
 * reads the start decision the server makes for the brief and the execute
 * route, and says why when that decision is a blocker.
 */

const MISSION = "cccccccc-0000-4000-8000-000000000001";
const now = new Date().toISOString();

const harvey: AgentSummary = {
  id: "agent-harvey",
  name: "Harvey",
  description: "Runs the numbers.",
  type: "specialist",
  status: "active",
  capabilities: ["financial_analysis"],
  toolIds: ["calculator"],
  metadata: {},
};

const task: TaskItem = {
  id: "task-1",
  workId: MISSION,
  title: "Work out the total cost",
  description: "In detail.",
  status: "pending",
  assignedAgentId: harvey.id,
  dependsOn: [],
  createdAt: now,
  updatedAt: now,
  metadata: {},
};

const node = {
  taskId: task.id,
  title: task.title,
  description: task.description,
  status: "pending",
  readiness: "ready",
  assignedAgentId: harvey.id,
  depth: 0,
  dependsOn: [],
  blocks: [],
  blockedBy: [],
  toolCallCount: 0,
  requiredTools: ["calculator"],
  requiredCapabilities: ["financial_analysis"],
} as unknown as ExecutionNode;

function room(overrides: Partial<ExecutionRoom> = {}): ExecutionRoom {
  return {
    work: {
      id: MISSION,
      organizationId: "org",
      objective: "Decide whether the laptop upgrade is worth it.",
      status: "queued",
      priority: "normal",
      createdAt: now,
      updatedAt: now,
      metadata: { plan: { taskCount: 1 } },
    },
    tasks: [task],
    events: [],
    artifacts: [],
    approvals: [],
    memories: [],
    executionJob: null,
    agents: [harvey],
    cast: [],
    plan: {
      nodes: [node],
      lanes: [{ depth: 0, taskIds: [task.id] }],
      terminalTaskIds: [task.id],
      totalCount: 1,
      completedCount: 0,
      failedCount: 0,
      progress: 0,
      runningCount: 0,
      widestLane: 1,
      hasCycle: false,
    },
    narrative: {
      timeline: [],
      handoffs: [],
      outcome: {
        status: "running",
        label: "Not started",
        summary: "Nothing has run yet.",
        confidence: "unknown",
        confidenceReason: "Nothing has run yet.",
        limitations: [],
        unfinished: [],
      },
    },
    tools: [{ id: "calculator", name: "Calculator", description: "Adds things up." }],
    ...overrides,
  };
}

function open(data: ExecutionRoom, role: OrganizationRole = "owner", search = "") {
  stubNetwork((call) => {
    if (call.url.pathname.endsWith("/room")) return json(200, data);
    if (call.url.pathname.endsWith("/knowledge")) return json(200, { review: [], learned: [], used: [] });
    return json(404, { error: { message: "Not here." } });
  });

  const router = createMemoryRouter(
    [
      {
        path: "/missions/:missionId",
        element: (
          <AccessContext.Provider value={signedInAs(role)}>
            <Room />
          </AccessContext.Provider>
        ),
      },
      { path: "*", element: <p>Somewhere else</p> },
    ],
    { initialEntries: [`/missions/${MISSION}${search}`] },
  );

  render(<RouterProvider router={router} />);
}

describe("the execution room's start", () => {
  it("offers to run a mission the server says can start", async () => {
    open(room({ startability: { startable: true, mode: "start" } }));

    expect(await screen.findByRole("button", { name: /Run it/ })).toBeDefined();
  });

  it("offers to resume a mission begun and left without a worker", async () => {
    open(room({
      work: { ...room().work, status: "executing" },
      startability: { startable: true, mode: "resume" },
    }));

    expect(await screen.findByRole("button", { name: /Resume it/ })).toBeDefined();
  });

  it("offers to run a mission that will stop for approval, and says where it stops", async () => {
    open(room({
      startability: {
        startable: true,
        mode: "start",
        state: "approval_required",
        message: "It will stop for approval at 1 step.",
      },
    }));

    expect(await screen.findByRole("button", { name: /Run it/ })).toBeDefined();
    expect(screen.getByText("It will stop for approval at 1 step.")).toBeDefined();
  });

  it("offers to run a limited mission, and says what may be missing", async () => {
    open(room({
      startability: {
        startable: true,
        mode: "start",
        state: "limited",
        message: "Mike is the closest match for step 1 but does not have market research.",
      },
    }));

    expect(await screen.findByRole("button", { name: /Run it/ })).toBeDefined();
    expect(screen.getByText("Mike is the closest match for step 1 but does not have market research.")).toBeDefined();
  });

  it("does not offer to run a mission that is already running", async () => {
    open(room({
      startability: {
        startable: false,
        reason: "running",
        message: "This mission is already running, or waiting for a worker to pick it up.",
      },
    }));

    await screen.findAllByText("Decide whether the laptop upgrade is worth it.");
    expect(screen.queryByRole("button", { name: /Run it|Resume it/ })).toBeNull();
  });

  it("does not offer to run a blocked mission, says why, and points at its brief", async () => {
    open(room({
      startability: {
        startable: false,
        reason: "blocked",
        message: "Harvey is paused, so step 1 has nobody to run it.",
      },
    }));

    expect(await screen.findByText("Harvey is paused, so step 1 has nobody to run it.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Run it/ })).toBeNull();
    expect(screen.getByRole("link", { name: "See what it needs" }).getAttribute("href"))
      .toBe(`/missions/${MISSION}/brief`);
  });

  it("offers nothing to someone whose role can only follow the mission", async () => {
    open(room({ startability: { startable: true, mode: "start" } }), "viewer");

    await screen.findAllByText("Decide whether the laptop upgrade is worth it.");
    expect(screen.queryByRole("button", { name: /Run it/ })).toBeNull();
  });

  it("falls back to the mission's status against an API that predates the decision", async () => {
    open(room());

    expect(await screen.findByRole("button", { name: /Run it/ })).toBeDefined();
  });
});

describe("the mission in the office", () => {
  it("links to the office opened on this mission, by its own id", async () => {
    open(room());

    const link = await screen.findByRole("link", { name: "View in World" });
    expect(link.getAttribute("href")).toBe(`/world?mission=${MISSION}`);
  });
});

describe("a link to one of the mission's results", () => {
  const result: ArtifactItem = {
    id: "artifact-1",
    workId: MISSION,
    taskId: task.id,
    createdByAgentId: harvey.id,
    name: "Laptop cost breakdown",
    type: "report",
    version: 1,
    createdAt: now,
    metadata: { content: "Twelve laptops at 1,100 each." },
  };

  it("opens that result in the room's own sheet", async () => {
    open(room({ artifacts: [result] }), "owner", `?artifact=${result.id}`);

    expect(await screen.findByRole("dialog", { name: "Laptop cost breakdown" })).toBeDefined();
  });

  it("opens nothing for an id that is not one of this mission's results", async () => {
    open(room({ artifacts: [result] }), "owner", "?artifact=someone-elses");

    await screen.findAllByText("Decide whether the laptop upgrade is worth it.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
