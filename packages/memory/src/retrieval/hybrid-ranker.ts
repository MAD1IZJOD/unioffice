import type { Memory, WorkspaceId } from "@unioffice/core";

import { freshnessOf } from "./freshness.js";
import { sharedTerms } from "./query-terms.js";

/** One candidate from the store, with the raw signals it was found by. */
export interface KnowledgeCandidate {
  memory: Memory;

  /** Cosine similarity to the query, when both sides have an embedding. */
  semanticSimilarity?: number;

  /** Full-text rank from the store, normalized to 0-1. */
  keywordRank: number;
}

export interface RankingContext {
  /** Query terms, as produced by queryTerms(). */
  terms: string[];

  /** The workspace the work runs in, when it runs in one. */
  workspaceId?: WorkspaceId;

  /** Capabilities of the agent the knowledge is for, when there is one. */
  agentCapabilities?: string[];

  now: Date;
}

export interface RankingSignals {
  semantic: number | null;
  keyword: number;
  importance: number;
  recency: number;
  scopeFit: number;
  sourceQuality: number;
  capabilityAffinity: number;
}

export interface RankedKnowledge {
  memory: Memory;

  /** 0-1 after every adjustment. Comparable within one ranking only. */
  score: number;

  signals: RankingSignals;

  /** Why it was retrieved, most significant first. Shown to people. */
  reasons: string[];

  stale: boolean;

  ageDays: number;
}

/**
 * Where raw cosine similarity starts to mean something for the embedding
 * model in use, and where it saturates. Below the floor two texts are merely
 * in the same language; above the ceiling they are about the same thing.
 *
 * Measured, not guessed: against the live store, nomic-embed-text scored
 * "what did we decide about pricing" at 0.574 against a pricing decision and
 * 0.442 against an unrelated lease note. Its similarities sit in a narrow
 * band, so a ceiling of 0.85 left genuinely relevant knowledge scoring as
 * barely related.
 */
export const SEMANTIC_FLOOR = 0.45;
export const SEMANTIC_CEILING = 0.75;

const WEIGHTS = {
  semantic: 0.45,
  keyword: 0.25,
  importance: 0.12,
  recency: 0.08,
  scopeFit: 0.05,
  sourceQuality: 0.05,
};

/** An unreviewed proposal ranks below equally relevant reviewed knowledge. */
const PROPOSED_FACTOR = 0.75;

/** Stale knowledge still ranks, below current knowledge that says the same. */
const STALE_FACTOR = 0.8;

const CAPABILITY_BONUS = 0.03;

/**
 * The relevance a candidate needs to be retrieved at all. Importance alone
 * never qualifies ordinary knowledge - a pile of important but unrelated rows
 * is the prompt pollution this ranker exists to prevent. Only critical
 * knowledge (importance >= 0.9) is allowed through on weight.
 */
const MIN_SEMANTIC = 0.25;
const MIN_KEYWORD = 0.15;
const CRITICAL_IMPORTANCE = 0.9;

/**
 * Hybrid ranking over a candidate pool.
 *
 * Deterministic by construction: the same candidates, context and clock always
 * give the same order, ties broken by id. Semantic similarity is one signal
 * among six rather than the ranking - a company's memory has to prefer
 * reviewed, current, in-scope knowledge even when an unreviewed or outdated
 * row happens to be a closer paraphrase of the query.
 */
export function rankKnowledge(
  candidates: KnowledgeCandidate[],
  context: RankingContext,
  limit: number,
): RankedKnowledge[] {
  return candidates
    .map((candidate) => score(candidate, context))
    .filter((ranked): ranked is RankedKnowledge => ranked !== null)
    .sort((left, right) =>
      right.score - left.score ||
      left.memory.id.localeCompare(right.memory.id))
    .slice(0, Math.max(0, limit));
}

function score(
  candidate: KnowledgeCandidate,
  context: RankingContext,
): RankedKnowledge | null {
  const { memory } = candidate;
  const freshness = freshnessOf(memory, context.now);

  const semantic =
    candidate.semanticSimilarity === undefined
      ? null
      : clamp(
          (candidate.semanticSimilarity - SEMANTIC_FLOOR) /
            (SEMANTIC_CEILING - SEMANTIC_FLOOR),
        );

  const shared = sharedTerms(context.terms, `${memory.title} ${memory.content}`);
  const overlap = context.terms.length > 0 ? shared.length / context.terms.length : 0;
  const keyword = clamp(Math.max(candidate.keywordRank, overlap));

  const relevant =
    (semantic !== null && semantic >= MIN_SEMANTIC) ||
    keyword >= MIN_KEYWORD ||
    memory.importance >= CRITICAL_IMPORTANCE;

  if (!relevant) {
    return null;
  }

  const scopeFit =
    memory.workspaceId && memory.workspaceId === context.workspaceId ? 1 : 0.6;

  const sourceQuality = sourceQualityOf(memory);

  const sharedCapabilities = capabilitiesOf(memory).filter((capability) =>
    (context.agentCapabilities ?? []).includes(capability),
  );

  const signals: RankingSignals = {
    semantic,
    keyword,
    importance: clamp(memory.importance),
    recency: freshness.recency,
    scopeFit,
    sourceQuality,
    capabilityAffinity: sharedCapabilities.length > 0 ? 1 : 0,
  };

  // When there is no embedding to compare, its weight is shared out rather
  // than scored as zero - otherwise every row indexed before embeddings
  // existed would rank as though it were irrelevant.
  const weights =
    semantic === null
      ? redistribute(WEIGHTS)
      : WEIGHTS;

  let total =
    (semantic ?? 0) * weights.semantic +
    keyword * weights.keyword +
    signals.importance * weights.importance +
    signals.recency * weights.recency +
    scopeFit * weights.scopeFit +
    sourceQuality * weights.sourceQuality;

  if (sharedCapabilities.length > 0) total += CAPABILITY_BONUS;
  if (memory.status === "proposed") total *= PROPOSED_FACTOR;
  if (freshness.stale) total *= STALE_FACTOR;

  return {
    memory,
    score: clamp(total),
    signals,
    reasons: explain({
      memory,
      semantic,
      rawSimilarity: candidate.semanticSimilarity,
      shared,
      scopeFit,
      sharedCapabilities,
      freshness,
    }),
    stale: freshness.stale,
    ageDays: freshness.ageDays,
  };
}

/**
 * How far the source itself can be trusted, before relevance is considered.
 * A person writing or reviewing knowledge is the strongest provenance there
 * is; extraction from an agent's output is the weakest, and it is weaker still
 * while unreviewed.
 */
function sourceQualityOf(memory: Memory): number {
  let base: number;

  if (memory.reviewedAt || memory.sourceType === "user") {
    base = 1;
  } else if (memory.sourceType === "approval") {
    base = 0.9;
  } else if (memory.status === "active") {
    base = 0.7;
  } else {
    base = 0.5;
  }

  return memory.confidence === undefined
    ? base
    : base * (0.5 + 0.5 * clamp(memory.confidence));
}

function capabilitiesOf(memory: Memory): string[] {
  const value = memory.metadata.capabilities;

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function explain(input: {
  memory: Memory;
  semantic: number | null;
  rawSimilarity?: number;
  shared: string[];
  scopeFit: number;
  sharedCapabilities: string[];
  freshness: ReturnType<typeof freshnessOf>;
}): string[] {
  const { memory, semantic, shared, freshness } = input;
  const reasons: Array<{ weight: number; text: string }> = [];

  if (semantic !== null && semantic >= MIN_SEMANTIC && input.rawSimilarity !== undefined) {
    reasons.push({
      weight: semantic * WEIGHTS.semantic,
      text: `Matched the topic of the work (similarity ${input.rawSimilarity.toFixed(2)})`,
    });
  }

  if (shared.length > 0) {
    reasons.push({
      weight: WEIGHTS.keyword,
      text: `Shares the terms ${shared.slice(0, 4).map((term) => `“${term}”`).join(", ")}`,
    });
  }

  if (memory.importance >= CRITICAL_IMPORTANCE) {
    reasons.push({ weight: 0.2, text: "Marked critical to the company" });
  } else if (memory.importance >= 0.7) {
    reasons.push({ weight: 0.1, text: "High importance" });
  }

  if (input.scopeFit === 1) {
    reasons.push({ weight: 0.05, text: "Recorded for this workspace" });
  } else if (!memory.workspaceId) {
    reasons.push({ weight: 0.01, text: "Company-wide knowledge" });
  }

  if (memory.reviewedAt || memory.sourceType === "user") {
    reasons.push({
      weight: 0.04,
      text: memory.reviewedAt ? "Reviewed by a person" : "Written by a person",
    });
  } else if (memory.status === "proposed") {
    reasons.push({ weight: 0.02, text: "Unreviewed proposal — treat as a lead" });
  }

  if (input.sharedCapabilities.length > 0) {
    reasons.push({
      weight: CAPABILITY_BONUS,
      text: `Produced by work needing ${input.sharedCapabilities.slice(0, 2).join(", ")}`,
    });
  }

  if (freshness.stale) {
    reasons.push({
      weight: 0.15,
      text: `May be outdated — last confirmed ${Math.round(freshness.ageDays)} days ago`,
    });
  } else if (freshness.horizonDays !== null && freshness.ageDays <= 7) {
    reasons.push({ weight: 0.03, text: "Recent" });
  }

  return reasons
    .sort((left, right) => right.weight - left.weight)
    .map((reason) => reason.text);
}

function redistribute(weights: typeof WEIGHTS): typeof WEIGHTS {
  const rest = 1 - weights.semantic;

  return {
    semantic: 0,
    keyword: weights.keyword / rest,
    importance: weights.importance / rest,
    recency: weights.recency / rest,
    scopeFit: weights.scopeFit / rest,
    sourceQuality: weights.sourceQuality / rest,
  };
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
