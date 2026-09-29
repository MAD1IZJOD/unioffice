import { describe, expect, it } from "vitest";

import type { WorldAgent, WorldSnapshot } from "../lib/api";

import { searchWorld } from "./search";

function agent(id: string, overrides: Partial<WorldAgent> = {}): WorldAgent {
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
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
    { id: "hall", kind: "hall", name: "Company hall", agentIds: ["tyrion"] },
    { id: "finance", kind: "workspace", name: "Finance", slug: "finance", agentIds: ["harvey"] },
    { id: "research", kind: "workspace", name: "Research", slug: "research", agentIds: ["mike"] },
  ],
  agents: [
    agent("tyrion", { type: "orchestrator" }),
    agent("harvey", {
      roomId: "finance",
      presence: "working",
      current: { missionId: "q3", missionName: "Quarterly review", taskTitle: "Run the expense analysis", state: "working" },
    }),
    agent("mike", { roomId: "research" }),
  ],
  missions: [{ id: "q3", name: "Quarterly review", status: "executing", workspaceId: "finance", agentIds: ["harvey", "mike"], steps: 3, completedSteps: 1 }],
  handoffs: [
    {
      from: { id: "mike", name: "Mike" },
      to: { id: "harvey", name: "Harvey" },
      fromStep: { number: 1, title: "Gather last quarter's receipts" },
      toStep: { number: 2, title: "Run the expense analysis" },
      delivered: { artifactId: "r1", name: "Receipts summary" },
      state: "in_progress",
      sentence: "Mike finished it. Harvey is using it.",
      at: "2026-09-29T09:50:00.000Z",
      missionId: "q3",
      missionName: "Quarterly review",
    },
  ],
};

describe("finding something in the office", () => {
  it("finds an agent by name, to be brought into view", () => {
    expect(searchWorld(snapshot, "harvey")[0]).toEqual({
      kind: "agent",
      select: { kind: "agent", id: "harvey" },
      label: "Harvey",
      detail: "Finance",
      agentId: "harvey",
    });
  });

  it("finds a room by name", () => {
    expect(searchWorld(snapshot, "Finance")[0]?.select).toEqual({ kind: "room", id: "finance" });
  });

  it("finds whoever is on a step, by what the step is", () => {
    const hits = searchWorld(snapshot, "expense analysis");

    expect(hits[0]?.select).toEqual({ kind: "agent", id: "harvey" });
    expect(hits[0]?.detail).toBe("Working on “Run the expense analysis” in “Quarterly review”.");
  });

  it("finds a live mission and a result that changed hands", () => {
    expect(searchWorld(snapshot, "quarterly")[0]?.select).toEqual({ kind: "mission", id: "q3" });
    expect(searchWorld(snapshot, "receipts summary")[0]).toMatchObject({
      select: { kind: "handoff", key: "q3:1>2" },
      label: "Receipts summary",
    });
  });

  it("puts a name that starts with the words ahead of one that only contains them", () => {
    const labels = searchWorld(snapshot, "re").map((hit) => hit.label);
    expect(labels.indexOf("Research")).toBeLessThan(labels.indexOf("Quarterly review"));
  });

  it("finds part of a name, in any case", () => {
    expect(searchWorld(snapshot, "harv")[0]?.select).toEqual({ kind: "agent", id: "harvey" });
    expect(searchWorld(snapshot, "arve")[0]?.select).toEqual({ kind: "agent", id: "harvey" });
    expect(searchWorld(snapshot, "HARVEY")).toEqual(searchWorld(snapshot, "harvey"));
    expect(searchWorld(snapshot, "fInAnCe")[0]?.select).toEqual({ kind: "room", id: "finance" });
  });

  it("finds several kinds of thing at once and says which each is", () => {
    // A room and a result starting with it, a mission with a word starting
    // with it, and the agent working on that mission.
    expect(searchWorld(snapshot, "re").map((hit) => [hit.kind, hit.label])).toEqual([
      ["room", "Research"],
      ["result", "Receipts summary"],
      ["mission", "Quarterly review"],
      ["agent", "Harvey"],
    ]);
  });

  it("finds whoever is working on a mission, after the mission itself", () => {
    expect(searchWorld(snapshot, "quarterly review").map((hit) => hit.select)).toEqual([
      { kind: "mission", id: "q3" },
      { kind: "agent", id: "harvey" },
    ]);
  });

  it("calls work that changed hands a result only when one was stored", () => {
    const none = { ...snapshot, handoffs: snapshot.handoffs.map((handoff) => ({ ...handoff, delivered: undefined })) };
    const [hit] = searchWorld(none, "receipts");

    expect(hit).toMatchObject({ kind: "handoff", label: "Mike → Harvey", select: { kind: "handoff", key: "q3:1>2" } });
  });

  it("cannot find work the viewer is not shown", () => {
    // Busy on a mission the viewer cannot open: the snapshot names no step.
    const hidden = {
      ...snapshot,
      agents: [...snapshot.agents, agent("tony", { roomId: "research", presence: "working", workingElsewhere: true })],
    };

    expect(searchWorld(hidden, "tony").map((hit) => hit.label)).toEqual(["Tony"]);
    for (const query of ["expense", "quarterly", "receipts"]) {
      expect(searchWorld(hidden, query).map((hit) => hit.label)).not.toContain("Tony");
    }
  });

  it("gives the same hits in the same order every time", () => {
    expect(searchWorld(snapshot, "r")).toEqual(searchWorld(snapshot, "r"));
  });

  it("finds nothing the snapshot does not hold, and nothing for an empty search", () => {
    expect(searchWorld(snapshot, "Dana")).toEqual([]);
    expect(searchWorld(snapshot, "   ")).toEqual([]);
  });
});
