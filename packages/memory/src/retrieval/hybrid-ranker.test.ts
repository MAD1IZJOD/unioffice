import assert from "node:assert/strict";
import test from "node:test";

import type { Memory, MemoryId, OrganizationId, WorkspaceId } from "@unioffice/core";

import { freshnessOf } from "./freshness.js";
import { rankKnowledge, type KnowledgeCandidate } from "./hybrid-ranker.js";
import { queryTerms, sharedTerms, toTsQueryTerms } from "./query-terms.js";

const now = new Date("2026-09-13T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const organizationId = "11111111-1111-1111-1111-111111111111" as OrganizationId;

let counter = 0;

function knowledge(overrides: Partial<Memory> = {}): Memory {
  counter += 1;
  const at = overrides.createdAt ?? new Date(now.getTime() - DAY);

  return {
    id: `00000000-0000-0000-0000-${String(counter).padStart(12, "0")}` as MemoryId,
    organizationId,
    scope: "company",
    type: "fact",
    status: "active",
    title: "Knowledge",
    content: "",
    sourceType: "user",
    importance: 0.5,
    createdAt: at,
    updatedAt: overrides.updatedAt ?? at,
    metadata: {},
    ...overrides,
  };
}

function candidate(memory: Memory, semanticSimilarity?: number, keywordRank = 0): KnowledgeCandidate {
  return { memory, semanticSimilarity, keywordRank };
}

test("query terms drop stopwords, stem simply and stay injection-free", () => {
  const terms = queryTerms("Create a revised pricing strategy for our decisions!");

  assert.deepEqual(terms, ["revis", "pric", "strategy", "decision"]);
  assert.equal(toTsQueryTerms(terms), "revis | pric | strategy | decision");
  assert.equal(toTsQueryTerms(["price", "x' | !", "tier"]), "price | tier");
  assert.deepEqual(sharedTerms(terms, "Pricing was decided in August"), ["pric"]);
});

test("query terms are bounded so a huge query cannot become a huge tsquery", () => {
  const terms = queryTerms(Array.from({ length: 200 }, (_, index) => `word${index}`).join(" "));

  assert.equal(terms.length, 24);
});

test("a policy never goes stale, an assumption goes stale fastest", () => {
  const old = new Date(now.getTime() - 400 * DAY);

  assert.equal(freshnessOf(knowledge({ type: "policy", createdAt: old }), now).stale, false);
  assert.equal(freshnessOf(knowledge({ type: "policy", createdAt: old }), now).recency, 1);
  assert.equal(freshnessOf(knowledge({ type: "assumption", createdAt: new Date(now.getTime() - 61 * DAY) }), now).stale, true);
  assert.equal(freshnessOf(knowledge({ type: "fact", createdAt: new Date(now.getTime() - 61 * DAY) }), now).stale, false);
});

test("a review re-confirms knowledge, so freshness counts from the review", () => {
  const memory = knowledge({
    type: "assumption",
    createdAt: new Date(now.getTime() - 300 * DAY),
    reviewedAt: new Date(now.getTime() - 2 * DAY),
  });

  assert.equal(freshnessOf(memory, now).stale, false);
});

test("semantic relevance outranks importance alone", () => {
  const relevant = knowledge({ title: "Pricing tiers", content: "Starter is $99 per month." });
  const important = knowledge({ title: "Office lease", content: "The lease renews in March.", importance: 0.85 });

  const ranked = rankKnowledge(
    [candidate(important, 0.5), candidate(relevant, 0.8)],
    { terms: queryTerms("pricing strategy"), now },
    5,
  );

  assert.deepEqual(ranked.map((entry) => entry.memory.id), [relevant.id]);
  assert.match(ranked[0]!.reasons[0]!, /Matched the topic of the work \(similarity 0.80\)/);
});

test("the raw similarity is kept beside the score, and absent when nothing was embedded", () => {
  const restatement = knowledge({ title: "Starter churn peaks in month two", content: "Starter churn is highest in month two." });
  const unembedded = knowledge({ title: "Starter churn note", content: "Starter churn is high." });

  const ranked = rankKnowledge(
    [candidate(restatement, 0.96), candidate(unembedded, undefined, 0.6)],
    { terms: queryTerms("starter churn month two"), now },
    5,
  );

  const byId = new Map(ranked.map((entry) => [entry.memory.id, entry]));

  // The score saturates well below 0.96, so only the raw value can tell a
  // restatement from something merely on the same topic.
  assert.equal(byId.get(restatement.id)!.similarity, 0.96);
  assert.equal(byId.get(restatement.id)!.signals.semantic, 1);
  assert.equal(byId.get(unembedded.id)!.similarity, undefined);
});

test("critical knowledge is retrieved on weight alone, and says so", () => {
  const critical = knowledge({ title: "Legal sign-off", content: "Never launch in the EU without legal sign-off.", importance: 0.95 });

  const ranked = rankKnowledge([candidate(critical, 0.3)], { terms: queryTerms("pricing strategy"), now }, 5);

  assert.equal(ranked.length, 1);
  assert.ok(ranked[0]!.reasons.includes("Marked critical to the company"));
});

test("reviewed knowledge outranks an unreviewed proposal that says the same thing", () => {
  const reviewed = knowledge({ status: "active", sourceType: "task", reviewedAt: new Date(now.getTime() - DAY), title: "Universities convert best", content: "University partnerships converted best." });
  const proposed = knowledge({ status: "proposed", sourceType: "task", title: "Universities convert best", content: "University partnerships converted best." });

  const ranked = rankKnowledge(
    [candidate(proposed, 0.82), candidate(reviewed, 0.8)],
    { terms: queryTerms("launch channel universities"), now },
    5,
  );

  assert.deepEqual(ranked.map((entry) => entry.memory.id), [reviewed.id, proposed.id]);
  assert.ok(ranked[1]!.reasons.includes("Unreviewed proposal — treat as a lead"));
});

test("stale knowledge still ranks, below current knowledge, and is flagged", () => {
  const current = knowledge({ type: "assumption", title: "Customers pay annually", content: "Most customers pay annually." });
  const stale = knowledge({ type: "assumption", title: "Customers pay monthly", content: "Most customers pay monthly.", createdAt: new Date(now.getTime() - 120 * DAY) });

  const ranked = rankKnowledge(
    [candidate(stale, 0.8), candidate(current, 0.8)],
    { terms: queryTerms("how customers pay"), now },
    5,
  );

  assert.deepEqual(ranked.map((entry) => entry.memory.id), [current.id, stale.id]);
  assert.equal(ranked[1]!.stale, true);
  assert.match(ranked[1]!.reasons.join(" "), /May be outdated — last confirmed 120 days ago/);
});

test("knowledge recorded for the work's own workspace ranks above company-wide knowledge", () => {
  const workspaceId = "33333333-3333-3333-3333-333333333333" as WorkspaceId;
  const local = knowledge({ workspaceId, title: "Finance close", content: "Finance closes on the 3rd." });
  const wide = knowledge({ title: "Finance close", content: "Finance closes on the 3rd." });

  const ranked = rankKnowledge(
    [candidate(wide, 0.8), candidate(local, 0.8)],
    { terms: queryTerms("finance close"), workspaceId, now },
    5,
  );

  assert.equal(ranked[0]!.memory.id, local.id);
  assert.ok(ranked[0]!.reasons.includes("Recorded for this workspace"));
});

test("capability affinity comes from the knowledge's recorded provenance, never an agent's name", () => {
  const financial = knowledge({ title: "Margin floor", content: "Gross margin must stay above 70%.", metadata: { capabilities: ["financial_analysis"] } });
  const other = knowledge({ title: "Margin floor", content: "Gross margin must stay above 70%.", metadata: { capabilities: ["communication"] } });

  const ranked = rankKnowledge(
    [candidate(other, 0.8), candidate(financial, 0.8)],
    { terms: queryTerms("margin"), agentCapabilities: ["financial_analysis", "calculation"], now },
    5,
  );

  assert.equal(ranked[0]!.memory.id, financial.id);
  assert.ok(ranked[0]!.reasons.includes("Produced by work needing financial_analysis"));
});

test("without embeddings, keyword relevance still ranks instead of scoring everything as irrelevant", () => {
  const match = knowledge({ title: "Pricing decision", content: "We priced Starter at $99." });
  const miss = knowledge({ title: "Hiring plan", content: "Two engineers in Q4." });

  const ranked = rankKnowledge(
    [candidate(miss), candidate(match)],
    { terms: queryTerms("pricing decision"), now },
    5,
  );

  assert.deepEqual(ranked.map((entry) => entry.memory.id), [match.id]);
  assert.ok(ranked[0]!.score > 0.3);
});

test("ranking is deterministic and respects the limit", () => {
  const items = Array.from({ length: 12 }, () =>
    knowledge({ title: "Roadmap", content: "Roadmap review happens monthly." }));
  const candidates = items.map((item) => candidate(item, 0.7));

  const first = rankKnowledge(candidates, { terms: queryTerms("roadmap"), now }, 4);
  const second = rankKnowledge([...candidates].reverse(), { terms: queryTerms("roadmap"), now }, 4);

  assert.equal(first.length, 4);
  assert.deepEqual(first.map((entry) => entry.memory.id), second.map((entry) => entry.memory.id));
});
