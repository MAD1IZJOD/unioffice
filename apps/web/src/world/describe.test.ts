import { describe, expect, it } from "vitest";

import type { WorldAgent, WorldSnapshot } from "../lib/api";

import { agentLabel, agentLine, deskStateOf, momentLine, recentFailure } from "./describe";

function agent(overrides: Partial<WorldAgent> = {}): WorldAgent {
  return {
    id: "tony",
    name: "Tony",
    type: "specialist",
    status: "active",
    presence: "available",
    capabilities: ["coding"],
    roomId: "engineering",
    seat: 0,
    workingElsewhere: false,
    upcomingSteps: 0,
    planningElsewhere: false,
    ...overrides,
  };
}

const current = { missionId: "launch", missionName: "Launch", taskTitle: "Build it", state: "working" as const };

describe("what the world says about an agent", () => {
  it("names the step and the mission of someone at work", () => {
    const tony = agent({ presence: "working", current });

    expect(deskStateOf(tony)).toBe("working");
    expect(agentLine(tony)).toBe("Working on “Build it” in “Launch”.");
  });

  it("says someone is busy, and not on what, when the caller cannot open the mission", () => {
    const tony = agent({ presence: "working", workingElsewhere: true });

    expect(deskStateOf(tony)).toBe("elsewhere");
    expect(agentLine(tony)).toBe("Working on a mission you cannot open.");
  });

  it("puts waiting on a person above everything but the agent's own status", () => {
    expect(deskStateOf(agent({ presence: "waiting", current: { ...current, state: "waiting" } }))).toBe("waiting");
    expect(deskStateOf(agent({ presence: "waiting", status: "paused" }))).toBe("paused");
    expect(deskStateOf(agent({ status: "disabled" }))).toBe("unavailable");
  });

  it("shows the planner planning only when the server says so", () => {
    expect(deskStateOf(agent({ type: "orchestrator" }))).toBe("available");
    expect(deskStateOf(agent({ type: "orchestrator", planning: { missionId: "m", missionName: "Offsite" } }))).toBe("planning");
    expect(agentLine(agent({ type: "orchestrator", planningElsewhere: true }))).toBe("Writing a plan for a mission you cannot open.");
  });

  it("counts steps that are waiting to start, and invents none", () => {
    expect(agentLine(agent())).toBe("Available.");
    expect(agentLine(agent({ upcomingSteps: 2 }))).toBe("Available, with 2 steps waiting to start.");
  });
});

describe("what the world says about a moment", () => {
  const snapshot = {
    agents: [agent({ id: "tyrion", name: "Tyrion", type: "orchestrator" }), agent(), agent({ id: "mike", name: "Mike" })],
  } as WorldSnapshot;

  it("names who handed what to whom, and in which mission", () => {
    const line = momentLine({
      kind: "handoff",
      key: "k",
      handoff: {
        from: { id: "mike", name: "Mike" },
        to: { id: "tony", name: "Tony" },
        fromStep: { number: 1, title: "Research" },
        toStep: { number: 2, title: "Build" },
        state: "in_progress",
        sentence: "",
        at: "",
        missionId: "launch",
        missionName: "Launch",
      },
    }, snapshot);

    expect(line).toBe("Mike handed step 1 to Tony in “Launch”.");
  });

  it("credits an assignment to the plan, not to a conversation", () => {
    const line = momentLine(
      { kind: "assigned", key: "k", missionId: "launch", missionName: "Launch", fromAgentId: "tyrion", toAgentIds: ["mike", "tony"] },
      snapshot,
    );

    expect(line).toBe("Tyrion's plan for “Launch” gave steps to Mike and Tony.");
  });
});

describe("a step that could not finish", () => {
  const failed = agent({
    lastOutcome: { missionId: "m", missionName: "Launch", taskTitle: "Ship it", outcome: "failed", at: "2026-09-27T10:00:00.000Z" },
  });

  it("flags the desk for a day, by the snapshot's clock", () => {
    expect(recentFailure(failed, "2026-09-27T12:00:00.000Z")).toBe(true);
    expect(recentFailure(failed, "2026-09-28T10:00:01.000Z")).toBe(false);
  });

  it("never flags a step that finished", () => {
    const done = agent({ lastOutcome: { ...failed.lastOutcome!, outcome: "completed" } });
    expect(recentFailure(done, "2026-09-27T12:00:00.000Z")).toBe(false);
  });

  it("is said aloud along with the agent, when flagged", () => {
    expect(agentLabel(failed, "Customer Success", true)).toMatch(/^Tony\. Customer Success\. Available\. Could not finish “Ship it”/);
    expect(agentLabel(failed, "Customer Success")).toBe("Tony. Customer Success. Available.");
  });
});
