import { describe, expect, it } from "vitest";

import type { WorldAgent, WorldSnapshot } from "../lib/api";

import { agentsOn, missionInView, missionTarget } from "./missionFocus";

function agent(id: string, overrides: Partial<WorldAgent> = {}): WorldAgent {
  return {
    id,
    name: id,
    type: "specialist",
    status: "active",
    presence: "available",
    capabilities: [],
    roomId: "hall",
    seat: 0,
    workingElsewhere: false,
    upcomingSteps: 0,
    planningElsewhere: false,
    ...overrides,
  };
}

const snapshot: WorldSnapshot = {
  organizationId: "org",
  generatedAt: "2026-09-29T10:00:00.000Z",
  rooms: [
    { id: "hall", kind: "hall", name: "Company hall", agentIds: ["tyrion", "jamie"] },
    { id: "engineering", kind: "workspace", name: "Engineering", slug: "engineering", agentIds: ["dana", "tony"] },
    { id: "research", kind: "workspace", name: "Research", slug: "research", agentIds: ["mike"] },
  ],
  agents: [
    agent("tyrion", { type: "orchestrator", planning: { missionId: "draft", missionName: "Draft" } }),
    agent("jamie"),
    agent("dana", { roomId: "engineering" }),
    agent("tony", { roomId: "engineering", seat: 1 }),
    agent("mike", { roomId: "research" }),
  ],
  missions: [
    { id: "launch", name: "Launch", status: "executing", workspaceId: "engineering", agentIds: ["tony", "mike", "dana"], steps: 3, completedSteps: 1 },
    { id: "draft", name: "Draft", status: "planning", workspaceId: "research", agentIds: [], steps: 0, completedSteps: 0 },
    { id: "empty", name: "Empty", status: "executing", workspaceId: "engineering", agentIds: [], steps: 1, completedSteps: 0 },
  ],
  handoffs: [],
};

describe("opening the world on one mission", () => {
  it("finds a mission only in the snapshot the viewer was given", () => {
    expect(missionInView(snapshot, "launch")?.name).toBe("Launch");
    expect(missionInView(snapshot, "another-companys-mission")).toBeUndefined();
    expect(missionInView(snapshot, "")).toBeUndefined();
    expect(missionInView(snapshot, null)).toBeUndefined();
    expect(missionInView(snapshot, undefined)).toBeUndefined();
  });

  it("names everyone holding its steps, in seat order, and nobody else", () => {
    expect(agentsOn(snapshot, missionInView(snapshot, "launch")!)).toEqual(["dana", "tony", "mike"]);
  });

  it("counts the planner writing its plan as on it", () => {
    expect(agentsOn(snapshot, missionInView(snapshot, "draft")!)).toEqual(["tyrion"]);
  });

  it("looks at its people, or at its room while nobody holds a step", () => {
    expect(missionTarget(snapshot, missionInView(snapshot, "launch")!)).toEqual({ kind: "agents", ids: ["dana", "tony", "mike"] });
    expect(missionTarget(snapshot, missionInView(snapshot, "empty")!)).toEqual({ kind: "room", id: "engineering" });
  });

  it("looks nowhere for a mission with nobody on it and no room in view", () => {
    const roomless = { ...snapshot.missions[2]!, workspaceId: "a-room-you-cannot-see" };
    expect(missionTarget(snapshot, roomless)).toBeUndefined();
  });
});
