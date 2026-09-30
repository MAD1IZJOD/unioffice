import { describe, expect, it } from "vitest";

import type { ActivityEvent, WorldAgent, WorldSnapshot } from "../lib/api";

import { MAX_RECENT, recentInWorld } from "./recent";

function agent(id: string, name: string): WorldAgent {
  return {
    id,
    name,
    type: "specialist",
    status: "active",
    presence: "available",
    capabilities: ["coding"],
    roomId: "hall",
    seat: 0,
    workingElsewhere: false,
    upcomingSteps: 0,
    planningElsewhere: false,
  };
}

const office: WorldSnapshot = {
  organizationId: "org",
  generatedAt: "2026-09-30T10:00:00.000Z",
  rooms: [{ id: "hall", kind: "hall", name: "Company hall", agentIds: ["tony", "jessica"] }],
  agents: [agent("tony", "Tony"), agent("jessica", "Jessica")],
  missions: [],
  handoffs: [],
};

let sequence = 0;
function event(type: string, agentId: string | undefined, minutesAgo: number, payload: Record<string, unknown> = {}): ActivityEvent {
  sequence += 1;
  return {
    id: `e${sequence}`,
    type,
    timestamp: new Date(Date.parse(office.generatedAt) - minutesAgo * 60_000).toISOString(),
    organizationId: "org",
    agentId,
    actorType: "agent",
    payload,
  };
}

describe("what the record says happened in the office", () => {
  it("tells each event as a line about its agent, newest first", () => {
    const lines = recentInWorld([
      event("task.completed", "tony", 30, { title: "Ship the build" }),
      event("agent.created", "jessica", 5, { name: "Jessica", capabilities: ["product_management"] }),
    ], office);

    expect(lines.map((entry) => entry.line)).toEqual(["Jessica joined the workforce", "Tony · Task completed: Ship the build"]);
    expect(lines.map((entry) => entry.agentId)).toEqual(["jessica", "tony"]);
  });

  it("keeps nothing about an agent this viewer's office does not show, or about no agent at all", () => {
    const lines = recentInWorld([
      event("task.completed", "someone-out-of-reach", 1, { title: "Secret" }),
      event("workspace.created", undefined, 2, { name: "Legal" }),
      event("task.started", "tony", 3, { title: "Build it" }),
    ], office);

    expect(lines.map((entry) => entry.line)).toEqual(["Tony · Task started: Build it"]);
  });

  it("tells a tool call once, by what happened, and an assignment by the step starting", () => {
    const lines = recentInWorld([
      event("tool.called", "tony", 3, { toolId: "calculator" }),
      event("tool.completed", "tony", 2, { toolId: "calculator", output: 4 }),
      event("agent.assigned", "tony", 4),
    ], office);

    expect(lines.map((entry) => entry.line)).toEqual(["Tony · Tool executed: calculator"]);
  });

  it("keeps only the latest few", () => {
    const many = Array.from({ length: MAX_RECENT + 5 }, (_, index) => event("task.completed", "tony", index, { title: `Step ${index}` }));
    const lines = recentInWorld(many, office);

    expect(lines).toHaveLength(MAX_RECENT);
    expect(lines[0]!.line).toBe("Tony · Task completed: Step 0");
  });

  it("says nothing when nothing was recorded", () => {
    expect(recentInWorld([], office)).toEqual([]);
  });
});
