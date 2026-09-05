import type { Memory } from "@unioffice/core";

import type { MemoryRepository } from "@unioffice/database";

import type {
  MemoryRetrievalContext,
  MemoryRetriever,
} from "./memory-retriever.js";

const DEFAULT_LIMIT = 5;
const CANDIDATE_POOL_SIZE = 100;
const RECENCY_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const CRITICAL_IMPORTANCE = 0.9;

/**
 * Deterministic keyword-overlap + recency + importance ranking over a
 * candidate pool. No embeddings or an LLM call — relevance has to be cheap
 * and reproducible since this runs on every task execution.
 */
export class DefaultMemoryRetriever implements MemoryRetriever {
  constructor(
    private readonly repository: MemoryRepository,
  ) {}

  async retrieve(
    context: MemoryRetrievalContext,
  ): Promise<Memory[]> {
    const candidates = await this.repository.query({
      organizationId: context.organizationId,
      limit: CANDIDATE_POOL_SIZE,
    });

    const queryTerms = tokenize(context.query);
    const now = Date.now();

    return candidates
      .filter((memory) =>
        memory.scope === "company" ||
        memory.agentId === context.agentId,
      )
      .map((memory) => ({
        memory,
        score: relevanceScore(memory, queryTerms, now),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, context.limit ?? DEFAULT_LIMIT)
      .map((entry) => entry.memory);
  }
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function relevanceScore(
  memory: Memory,
  queryTerms: Set<string>,
  now: number,
): number {
  const memoryTerms = tokenize(memory.content);
  const overlap = [...queryTerms].filter((term) => memoryTerms.has(term)).length;

  if (overlap === 0 && memory.importance < CRITICAL_IMPORTANCE) {
    return 0;
  }

  const overlapRatio = queryTerms.size > 0 ? overlap / queryTerms.size : 0;
  const ageMs = Math.max(0, now - memory.createdAt.getTime());
  const recencyWeight = Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);

  return overlapRatio * 2 + memory.importance * 0.5 + recencyWeight * 0.3;
}
