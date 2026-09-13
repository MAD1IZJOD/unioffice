import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { KnowledgeDetail, KnowledgeItem } from "../lib/api";
import { json, stubNetwork } from "../test/network";
import KnowledgeEntry from "./KnowledgeEntry";

/**
 * One piece of knowledge, opened, with the real API client and only the
 * network scripted: where it came from, which later missions confirmed it,
 * and what it was merged into - each a real link, never an invented one.
 */

const knownId = "22222222-2222-4222-8222-222222222222";
const lessonId = "11111111-1111-4111-8111-111111111111";
const missionId = "c0000000-0000-4000-8000-000000000001";
const laterMissionId = "d0000000-0000-4000-8000-000000000001";
const now = new Date(Date.now() - 60_000).toISOString();

function item(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    organizationId: "2f6b579a-f0f8-45a5-868a-21c08bde1314",
    scope: "company",
    type: "fact",
    status: "active",
    title: "Starter churn peaks in month two",
    content: "Churn on Starter is highest in month two.",
    sourceType: "task",
    importance: 0.6,
    reviewedAt: now,
    reviewedBy: "user:reviewer",
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function detail(overrides: Partial<KnowledgeDetail> = {}): KnowledgeDetail {
  return {
    knowledge: item(knownId),
    freshness: { ageDays: 0, stale: false, horizonDays: 180 },
    flags: [],
    provenance: {
      sourceType: "task",
      mission: { id: missionId, objective: "Revise the Starter pricing.", status: "completed", createdAt: now },
      task: { id: "t1", title: "Analyse Starter churn", status: "completed" },
      agent: { id: "harvey", name: "Harvey", capabilities: ["financial_analysis"] },
      artifact: { id: "r1", name: "Churn analysis", type: "analysis" },
    },
    related: { sameMission: [], sameArtifact: [], similar: [] },
    confirmations: [],
    usage: { recallCount: 0, missions: [] },
    conflicts: [],
    ...overrides,
  };
}

function open(id: string, body: KnowledgeDetail | (() => Response)) {
  stubNetwork((call) => {
    if (call.url.pathname === "/workspaces") return json(200, { workspaces: [] });
    if (call.url.pathname === `/knowledge/${id}`) return typeof body === "function" ? body() : json(200, body);
    return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
  });

  const router = createMemoryRouter(
    [{ path: "/brain/:knowledgeId", element: <KnowledgeEntry /> }],
    { initialEntries: [`/brain/${id}`] },
  );

  render(<RouterProvider router={router} />);
}

describe("a piece of knowledge, opened", () => {
  it("traces where it came from, with the mission and agent as links", async () => {
    open(knownId, detail());

    const trail = await screen.findByRole("list", { name: "Where this knowledge came from" });

    expect(within(trail).getByRole("link", { name: "Revise the Starter pricing." }).getAttribute("href")).toBe(`/missions/${missionId}`);
    expect(within(trail).getByRole("link", { name: "Harvey" }).getAttribute("href")).toBe("/agents/harvey");
    expect(within(trail).getByText("Analyse Starter churn")).toBeDefined();
    expect(within(trail).getByText("Churn analysis")).toBeDefined();
  });

  it("says plainly when no other mission has confirmed it", async () => {
    open(knownId, detail());

    expect(await screen.findByText("Not yet by another mission")).toBeDefined();
    expect(screen.queryByText("Confirmed again by")).toBeNull();
  });

  it("lists the later missions that arrived at it, in their own words", async () => {
    open(knownId, detail({
      confirmations: [
        { mission: { id: laterMissionId, objective: "Plan a Starter retention campaign." }, wording: "Most Starter churn happens in the second month", mergedAt: now },
        { wording: "Starter customers leave in month two", mergedAt: now },
      ],
    }));

    expect(await screen.findByText("Again by 2 later missions")).toBeDefined();
    expect(screen.getByRole("link", { name: "Plan a Starter retention campaign." }).getAttribute("href")).toBe(`/missions/${laterMissionId}`);
    expect(screen.getByText("in its words: “Most Starter churn happens in the second month”")).toBeDefined();
    expect(screen.getByText("A mission that is no longer available")).toBeDefined();
  });

  it("an entry that was merged away points at the knowledge that says the same", async () => {
    open(lessonId, detail({
      knowledge: item(lessonId, { status: "archived", title: "Most Starter churn happens in the second month" }),
      related: { sameMission: [], sameArtifact: [], similar: [], mergedInto: item(knownId) },
    }));

    const history = (await screen.findByText("History")).closest("section")!;

    expect(within(history).getByRole("link", { name: "Starter churn peaks in month two" }).getAttribute("href")).toBe(`/brain/${knownId}`);
    expect(within(history).getByText(/which says the same thing/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Restore as a proposal" })).toBeDefined();
  });

  it("shows the API's message when the knowledge cannot be opened", async () => {
    open(knownId, () => json(404, { error: { code: "NOT_FOUND", message: "Knowledge not found." } }));

    expect(await screen.findByText("This knowledge could not be opened")).toBeDefined();
    expect(screen.getByText("Knowledge not found.")).toBeDefined();
  });
});
