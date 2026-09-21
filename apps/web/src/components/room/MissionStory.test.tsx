import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type {
  ArtifactItem,
  Handoff,
  MissionResult,
  TimelineEntry,
} from "../../lib/api";

import { MissionHandoffs, MissionResultBrief, MissionTimeline } from "./MissionStory";

/**
 * The three readings a person actually watches, rendered from the server's
 * answer and nothing else.
 *
 * The thing worth defending is what is NOT shown: a handoff card cannot
 * appear without the server sending a handoff, a confidence cannot appear
 * without the server setting one, and a mission that finished with something
 * limiting it must never read as a plain success.
 */

const at = (minutes: number) =>
  new Date(Date.UTC(2026, 8, 21, 9, minutes)).toISOString();

function mount(node: React.ReactNode) {
  const router = createMemoryRouter(
    [
      { path: "/", element: node },
      { path: "*", element: <p>Somewhere else</p> },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
}

function entry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    at: at(0),
    state: "running",
    sentence: "Nova started “Research the requirements”",
    agent: { id: "agent-nova", name: "Nova" },
    step: 1,
    ...overrides,
  };
}

function handoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    from: { id: "agent-nova", name: "Nova" },
    to: { id: "agent-tony", name: "Tony" },
    fromStep: { number: 1, title: "Research the requirements" },
    toStep: { number: 2, title: "Assess engineering impact" },
    delivered: { artifactId: "artifact-1", name: "Research findings" },
    state: "in_progress",
    sentence: "Nova finished “Research the requirements”. Tony is working from it now.",
    at: at(5),
    ...overrides,
  };
}

function outcome(overrides: Partial<MissionResult> = {}): MissionResult {
  return {
    status: "completed",
    label: "Finished",
    summary: "The mission did what it set out to do.",
    confidence: "high",
    confidenceReason: "Every step did what it was meant to, with what it was meant to use.",
    limitations: [],
    unfinished: [],
    finishedAt: at(30),
    ...overrides,
  };
}

const artifact: ArtifactItem = {
  id: "artifact-1",
  organizationId: "org",
  name: "Research findings",
  type: "analysis",
  version: 1,
  createdAt: at(5),
  updatedAt: at(5),
  metadata: {},
} as ArtifactItem;

/* --------------------------------------------------------------------------
   Timeline
   -------------------------------------------------------------------------- */

describe("the mission timeline", () => {
  it("says nothing has happened rather than showing an empty frame", () => {
    mount(<MissionTimeline entries={[]} />);

    expect(screen.getByText(/Nothing has happened yet/)).toBeDefined();
  });

  it("puts what is going on now first, and names the state of each moment", () => {
    mount(<MissionTimeline entries={[
      entry({ at: at(0), state: "queued", sentence: "The mission was opened", agent: undefined, step: undefined }),
      entry({ at: at(3), state: "running", sentence: "Nova started “Research”" }),
      entry({ at: at(9), state: "waiting", sentence: "Asked for a decision on “Send it”", step: 2 }),
    ]} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    // Newest first: the thing being looked for is what is happening now.
    expect(within(rows[0]!).getByText("Asked for a decision on “Send it”")).toBeDefined();
    expect(within(rows[0]!).getByText("Waiting for you")).toBeDefined();
    expect(within(rows[2]!).getByText("Queued")).toBeDefined();
  });

  it("keeps each of the nine states distinct rather than flattening them", () => {
    const states = ["queued", "planning", "running", "waiting", "resumed", "completed", "failed", "cancelled", "blocked"] as const;

    mount(<MissionTimeline entries={states.map((state, index) =>
      entry({ at: at(index), state, sentence: `Moment ${index}` }))} />);

    for (const label of ["Queued", "Planning", "Working", "Waiting for you", "Resumed", "Done", "Stopped", "Cancelled", "Blocked"]) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("links a moment to the agent it was about, and names the step by number", () => {
    mount(<MissionTimeline entries={[entry()]} />);

    expect(screen.getByRole("link", { name: "Nova" }).getAttribute("href")).toBe("/workforce/agent-nova");
    expect(screen.getByText("Step 1")).toBeDefined();
  });

  it("holds a long mission back to a readable length until asked for more", async () => {
    mount(<MissionTimeline entries={Array.from({ length: 20 }, (_, index) =>
      entry({ at: at(index), sentence: `Moment ${index}` }))} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(12);

    await userEvent.setup().click(screen.getByRole("button", { name: /Show 8 earlier moments/ }));

    expect(screen.getAllByRole("listitem")).toHaveLength(20);
  });
});

/* --------------------------------------------------------------------------
   Handoffs
   -------------------------------------------------------------------------- */

describe("agent handoffs", () => {
  it("says nothing has changed hands rather than inventing a transition", () => {
    mount(<MissionHandoffs handoffs={[]} artifacts={[]} onOpenArtifact={() => {}} />);

    expect(screen.getByText(/Nothing has changed hands yet/)).toBeDefined();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("names both specialists, the transition and which steps it joined", () => {
    mount(<MissionHandoffs handoffs={[handoff()]} artifacts={[artifact]} onOpenArtifact={() => {}} />);

    expect(screen.getByRole("link", { name: "Nova" }).getAttribute("href")).toBe("/workforce/agent-nova");
    expect(screen.getByRole("link", { name: "Tony" }).getAttribute("href")).toBe("/workforce/agent-tony");
    expect(screen.getByText("Nova finished “Research the requirements”. Tony is working from it now.")).toBeDefined();
    expect(screen.getByText("Step 1 → step 2")).toBeDefined();
    expect(screen.getByText("In hand")).toBeDefined();
  });

  it("opens the real artifact that was delivered, not a paraphrase of it", async () => {
    const opened = vi.fn();
    mount(<MissionHandoffs handoffs={[handoff()]} artifacts={[artifact]} onOpenArtifact={opened} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /View Research findings/ }));

    expect(opened).toHaveBeenCalledWith(artifact);
  });

  it("names what was delivered without offering to open an artifact it does not have", () => {
    mount(<MissionHandoffs handoffs={[handoff()]} artifacts={[]} onOpenArtifact={() => {}} />);

    expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
    expect(screen.getByText("Research findings")).toBeDefined();
  });

  it("shows parallel branches as separate handoffs into the step that joins them", () => {
    // Two branches finishing into one joining step: Nova and Tony both hand
    // to Harvey, which is the shape a parallel plan actually produces.
    const join = { id: "agent-harvey", name: "Harvey" };

    mount(<MissionHandoffs
      handoffs={[
        handoff({ from: { id: "agent-nova", name: "Nova" }, to: join, fromStep: { number: 1, title: "Quotes" }, toStep: { number: 3, title: "Decide" } }),
        handoff({ from: { id: "agent-tony", name: "Tony" }, to: join, fromStep: { number: 2, title: "Usage" }, toStep: { number: 3, title: "Decide" } }),
      ]}
      artifacts={[]}
      onOpenArtifact={() => {}}
    />);

    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Harvey" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Nova" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Tony" })).toBeDefined();
    expect(screen.getByText("Step 1 → step 3")).toBeDefined();
    expect(screen.getByText("Step 2 → step 3")).toBeDefined();
  });

  it("says where the work it fed has got to", () => {
    mount(<MissionHandoffs
      handoffs={[
        handoff({ state: "delivered", toStep: { number: 2, title: "A" } }),
        handoff({ state: "waiting", toStep: { number: 3, title: "B" } }),
        handoff({ state: "stalled", toStep: { number: 4, title: "C" } }),
      ]}
      artifacts={[]}
      onOpenArtifact={() => {}}
    />);

    expect(screen.getByText("Used")).toBeDefined();
    expect(screen.getByText("Held for a decision")).toBeDefined();
    expect(screen.getByText("Not picked up")).toBeDefined();
  });
});

/* --------------------------------------------------------------------------
   The result
   -------------------------------------------------------------------------- */

describe("the mission result", () => {
  it("leads with what the result is worth, then the answer itself", () => {
    mount(<MissionResultBrief
      outcome={outcome()}
      result={{ value: "The total is 74,200.", title: "Work out the cost", at: at(30) }}
      producedBy="Harvey"
      artifacts={[]}
      onOpenArtifact={() => {}}
    />);

    expect(screen.getByText("Finished")).toBeDefined();
    expect(screen.getByText("High confidence")).toBeDefined();
    expect(screen.getByText("The mission did what it set out to do.")).toBeDefined();
    expect(screen.getByText("The total is 74,200.")).toBeDefined();
    expect(screen.getByText("Harvey")).toBeDefined();
  });

  it("does not let a mission with limitations read as a plain success", () => {
    mount(<MissionResultBrief
      outcome={outcome({
        status: "completed_with_limitations",
        label: "Finished with limitations",
        summary: "The mission finished, but 1 thing limits what the result can be used for.",
        confidence: "limited",
        confidenceReason: "Part of this answer was not produced the way it was supposed to be.",
        limitations: [{ kind: "tool_unavailable", steps: [1], detail: "“Work out the cost” was meant to use Calculator and did not." }],
      })}
      artifacts={[]}
      onOpenArtifact={() => {}}
    />);

    expect(screen.getByText("Finished with limitations")).toBeDefined();
    expect(screen.getByText("Limited confidence")).toBeDefined();
    expect(screen.getByText("What limits this result")).toBeDefined();
    expect(screen.getByText(/was meant to use Calculator and did not/)).toBeDefined();
    expect(screen.getByText("Step 1")).toBeDefined();
    expect(screen.queryByText("Finished", { exact: true })).toBeNull();
  });

  it("says one limitation once, naming every step it touched", () => {
    mount(<MissionResultBrief
      outcome={outcome({
        status: "completed_with_limitations",
        label: "Finished with limitations",
        summary: "The mission finished, but 1 thing limits what the result can be used for.",
        confidence: "moderate",
        limitations: [{ kind: "procedure_missing", steps: [1, 2, 3], detail: "No skill matches what these steps ask for." }],
      })}
      artifacts={[]}
      onOpenArtifact={() => {}}
    />);

    expect(screen.getByText("Steps 1, 2, 3")).toBeDefined();
    expect(screen.getAllByText(/No skill matches/)).toHaveLength(1);
  });

  it("shows no confidence at all when the server could not judge one", () => {
    mount(<MissionResultBrief
      outcome={outcome({
        status: "blocked",
        label: "Blocked",
        summary: "The mission is fine and entirely stopped: it is waiting on a person.",
        confidence: "unknown",
        confidenceReason: "This did not reach an answer, so there is nothing to judge.",
        finishedAt: undefined,
      })}
      artifacts={[]}
      onOpenArtifact={() => {}}
    />);

    expect(screen.getByText("Blocked")).toBeDefined();
    expect(screen.queryByText(/confidence$/)).toBeNull();
    expect(screen.queryByText("Unknown confidence")).toBeNull();
  });

  it("names the steps that never ran when something stopped the mission", () => {
    mount(<MissionResultBrief
      outcome={outcome({
        status: "cancelled",
        label: "Cancelled",
        summary: "The mission was cancelled with 1 step unfinished.",
        confidence: "unknown",
        confidenceReason: "This did not reach an answer, so there is nothing to judge.",
        unfinished: ["Write the recommendation"],
        finishedAt: undefined,
      })}
      artifacts={[]}
      onOpenArtifact={() => {}}
    />);

    expect(screen.getByText("1 step never ran")).toBeDefined();
    expect(screen.getByText("Write the recommendation")).toBeDefined();
  });

  it("elevates the artifacts rather than dropping them", async () => {
    const opened = vi.fn();
    mount(<MissionResultBrief outcome={outcome()} artifacts={[artifact]} onOpenArtifact={opened} />);

    expect(screen.getByText("1 thing it left behind")).toBeDefined();

    await userEvent.setup().click(screen.getByRole("button", { name: "Research findings" }));
    expect(opened).toHaveBeenCalledWith(artifact);
  });

  it("stands on its own for a mission that stopped before producing anything", () => {
    mount(<MissionResultBrief
      outcome={outcome({
        status: "failed",
        label: "Stopped",
        summary: "The local model was unavailable when this ran.",
        confidence: "unknown",
        confidenceReason: "This did not reach an answer, so there is nothing to judge.",
        finishedAt: undefined,
      })}
      artifacts={[]}
      onOpenArtifact={() => {}}
    />);

    expect(screen.getByText("Stopped")).toBeDefined();
    expect(screen.getByText("The local model was unavailable when this ran.")).toBeDefined();
    expect(screen.queryByText("What the company produced")).toBeNull();
  });
});
