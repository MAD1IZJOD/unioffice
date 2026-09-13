import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeItem, MissionDebriefItem } from "../../lib/api";
import { json, stubNetwork, type RecordedCall } from "../../test/network";
import { MissionDebrief } from "./MissionDebrief";

/**
 * The debrief with the real API client; only the network answers are scripted.
 * What these check is that each decision sends exactly the request the backend
 * expects, that the page waits for the debrief to be re-read, and that it
 * never offers a decision the backend would refuse.
 */

const now = "2026-09-13T10:00:00.000Z";

function knowledge(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    organizationId: "2f6b579a-f0f8-45a5-868a-21c08bde1314",
    scope: "company",
    type: "fact",
    status: "proposed",
    title: `Knowledge ${id}`,
    content: `Detail of ${id}.`,
    sourceType: "task",
    importance: 0.6,
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

const lessonId = "11111111-1111-4111-8111-111111111111";
const knownId = "22222222-2222-4222-8222-222222222222";
const olderId = "33333333-3333-4333-8333-333333333333";
const narrowId = "44444444-4444-4444-8444-444444444444";

function lesson(overrides: Partial<MissionDebriefItem> = {}): MissionDebriefItem {
  return {
    knowledge: knowledge(lessonId, {
      title: "Most Starter churn happens in the second month",
      content: "Starter customers churn most in their second month.",
    }),
    outcome: "pending",
    evidence: {
      task: { id: "t1", title: "Analyse Starter churn" },
      agent: { id: "a1", name: "Harvey" },
      artifact: { id: "r1", name: "Churn analysis" },
      rationale: "Retention offers should land before month two.",
    },
    related: [
      {
        knowledge: knowledge(knownId, { status: "active", title: "Starter churn peaks in month two" }),
        relation: "restates",
        similarity: 0.96,
        canMerge: true,
      },
      {
        knowledge: knowledge(olderId, { type: "decision", status: "active", title: "Retention offers go out in month three" }),
        relation: "contradicts",
        canMerge: false,
      },
    ],
    ...overrides,
  };
}

function renderDebrief(review: MissionDebriefItem[], options: { live?: boolean; route?: (call: RecordedCall) => Response } = {}) {
  const calls = stubNetwork(options.route ?? ((call) => json(200, { knowledge: knowledge(call.url.pathname.split("/")[2]!) })));
  const onChanged = vi.fn(async () => {});

  render(
    <MemoryRouter>
      <MissionDebrief review={review} live={options.live ?? false} onChanged={onChanged} />
    </MemoryRouter>,
  );

  return { calls, onChanged };
}

const posts = (calls: RecordedCall[]) =>
  calls.filter((call) => call.method === "POST").map((call) => [call.url.pathname, call.body]);

describe("the mission debrief", () => {
  it("shows each lesson with its evidence and how it stands against existing knowledge", () => {
    renderDebrief([lesson()]);

    expect(screen.getByText("1 to decide")).toBeDefined();
    expect(screen.getByRole("link", { name: "Most Starter churn happens in the second month" }).getAttribute("href")).toBe(`/brain/${lessonId}`);
    expect(screen.getByText("from the step “Analyse Starter churn” · by Harvey · in “Churn analysis”")).toBeDefined();
    expect(screen.getByText("Retention offers should land before month two.")).toBeDefined();

    const restates = screen.getByText("Says the same as").closest("li")!;
    expect(within(restates).getByRole("link", { name: "Starter churn peaks in month two" }).getAttribute("href")).toBe(`/brain/${knownId}`);
    expect(screen.getByText("Contradicts").closest("li")).not.toBeNull();

    // No similarity score is shown as a number to a person.
    expect(screen.queryByText(/0\.96/)).toBeNull();
  });

  it("merging sends the restatement and the entry to keep, then re-reads the debrief", async () => {
    const { calls, onChanged } = renderDebrief([lesson()]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Merge into it" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(posts(calls)).toEqual([
      [`/knowledge/${lessonId}/merge`, { organizationId: "2f6b579a-f0f8-45a5-868a-21c08bde1314", intoId: knownId }],
    ]);
  });

  it("a contradiction offers replacement, which retires the older entry", async () => {
    const { calls } = renderDebrief([lesson()]);
    const user = userEvent.setup();

    await user.click(within(screen.getByText("Contradicts").closest("li")!).getByRole("button", { name: "This replaces it" }));

    await waitFor(() => expect(posts(calls)).toEqual([
      [`/knowledge/${lessonId}/supersede`, { organizationId: "2f6b579a-f0f8-45a5-868a-21c08bde1314", replacesId: olderId }],
    ]));
  });

  it("never offers a merge the backend would refuse", () => {
    renderDebrief([lesson({
      related: [{
        knowledge: knowledge(narrowId, { status: "active", workspaceId: "f0000000-0000-0000-0000-00000000000f", title: "Finance churn note" }),
        relation: "restates",
        canMerge: false,
      }],
    })]);

    const merge = screen.getByRole("button", { name: "Merge into it" }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
    expect(merge.title).toMatch(/applies more widely/);
  });

  it("keeping approves it; editing first saves the correction, then approves", async () => {
    const { calls } = renderDebrief([lesson()]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const title = screen.getByLabelText("What the company should know");
    await user.clear(title);
    await user.type(title, "Starter churn is concentrated in month two");
    await user.click(screen.getByRole("button", { name: "Save and keep" }));

    await waitFor(() => expect(posts(calls)).toEqual([
      [`/knowledge/${lessonId}`, {
        organizationId: "2f6b579a-f0f8-45a5-868a-21c08bde1314",
        title: "Starter churn is concentrated in month two",
        content: "Starter customers churn most in their second month.",
      }],
      [`/knowledge/${lessonId}/approve`, { organizationId: "2f6b579a-f0f8-45a5-868a-21c08bde1314" }],
    ]));
  });

  it("keeping without an edit only approves, and discarding archives with a reason", async () => {
    const { calls } = renderDebrief([
      lesson(),
      lesson({ knowledge: knowledge(narrowId, { title: "Onboarding emails went out" }), related: [], evidence: {} }),
    ]);
    const user = userEvent.setup();

    const [first, second] = screen.getAllByRole("article");

    await user.click(within(first!).getByRole("button", { name: "Keep as company knowledge" }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));

    await user.click(within(second!).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(posts(calls)).toHaveLength(2));

    expect(posts(calls)).toEqual([
      [`/knowledge/${lessonId}/approve`, { organizationId: "2f6b579a-f0f8-45a5-868a-21c08bde1314" }],
      [`/knowledge/${narrowId}/archive`, { organizationId: "2f6b579a-f0f8-45a5-868a-21c08bde1314", reason: "Discarded in the mission debrief." }],
    ]);
    expect(within(second!).getByText("No step or artifact is recorded for this.")).toBeDefined();
  });

  it("a refused decision is explained, nothing is re-read, and the choice stays available", async () => {
    const { onChanged } = renderDebrief([lesson()], {
      route: () => json(409, { error: { code: "CONFLICT", message: "Archived knowledge cannot be merged. Restore it first." } }),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Merge into it" }));

    expect(await screen.findByText("That decision was not recorded")).toBeDefined();
    expect(screen.getByText("Archived knowledge cannot be merged. Restore it first.")).toBeDefined();
    expect(onChanged).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Merge into it" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("decided lessons say what became of them, with links to the knowledge involved", () => {
    renderDebrief([
      lesson({ outcome: "merged", related: [], mergedInto: { id: knownId, title: "Starter churn peaks in month two", status: "active" } }),
      lesson({
        knowledge: knowledge(olderId, { type: "decision", status: "active", title: "Retention offers go out in month two" }),
        outcome: "kept",
        related: [],
        replaces: { id: narrowId, title: "Retention offers go out in month three", status: "archived" },
      }),
    ]);

    expect(screen.getByText("Nothing left to decide")).toBeDefined();
    expect(screen.getByText("1 kept")).toBeDefined();
    expect(screen.getByText("1 merged into existing knowledge")).toBeDefined();
    expect(screen.getByRole("link", { name: "“Starter churn peaks in month two”" }).getAttribute("href")).toBe(`/brain/${knownId}`);
    expect(screen.getByRole("link", { name: "“Retention offers go out in month three”" }).getAttribute("href")).toBe(`/brain/${narrowId}`);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("while the mission runs, it says more may still be proposed", () => {
    renderDebrief([lesson()], { live: true });

    expect(screen.getByText(/Proposed as its steps finish/)).toBeDefined();
  });
});
