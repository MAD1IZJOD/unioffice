import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { KnowledgeItem } from "../../lib/api";
import { KnowledgeRow } from "./KnowledgeRow";

/**
 * One row of company knowledge.
 *
 * What these are about is that a person can tell, without leaving the list,
 * how far to trust what they are reading: whether anyone has vouched for it,
 * whether it has gone stale, and whether the company holds something that
 * disagrees with it.
 */

function knowledge(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: "k1",
    organizationId: "2f6b579a-f0f8-45a5-868a-21c08bde1314",
    scope: "company",
    type: "fact",
    status: "active",
    title: "Enterprise pricing is a hundred thousand a year.",
    content: "The pricing review set enterprise pricing for the year.",
    sourceType: "task",
    importance: 0.6,
    createdAt: new Date("2026-09-12T10:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-09-12T10:00:00.000Z").toISOString(),
    metadata: {},
    ...overrides,
  } as KnowledgeItem;
}

function show(result?: Parameters<typeof KnowledgeRow>[0]["result"]) {
  render(
    <MemoryRouter>
      <KnowledgeRow item={knowledge()} result={result} />
    </MemoryRouter>,
  );
}

describe("a row of company knowledge", () => {
  it("marks knowledge the company is still arguing about", () => {
    show({ reasons: [], stale: false, flagged: false, disputed: true });

    expect(screen.getByText("disputed")).toBeDefined();
  });

  it("leaves settled knowledge unmarked", () => {
    show({ reasons: [], stale: false, flagged: false, disputed: false });

    expect(screen.queryByText("disputed")).toBeNull();
  });

  it("does not claim a disagreement when an older API did not say", () => {
    show({ reasons: [], stale: false, flagged: false });

    expect(screen.queryByText("disputed")).toBeNull();
  });

  it("says nothing about disagreements when the row is shown without a search result", () => {
    show();

    expect(screen.queryByText("disputed")).toBeNull();
    expect(screen.getByText(/Enterprise pricing/)).toBeDefined();
  });
});
