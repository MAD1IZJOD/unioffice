import { queryTerms } from "../retrieval/query-terms.js";

/**
 * Whether two pieces of knowledge disagree.
 *
 * Deterministic on purpose. A model asked "do these contradict?" would give a
 * different answer on a different day, and a conflict the system raised is
 * something a person is asked to spend time on - it has to be reproducible
 * and it has to be able to say exactly why.
 *
 * Two conditions, both required:
 *
 * 1. Same subject. Either the embeddings say they are about the same thing, or
 *    their titles share most of their words once figures are set aside.
 * 2. Evidence of disagreement. They state different amounts or percentages for
 *    that subject, or one asserts what the other negates.
 *
 * It errs towards silence. A missed conflict is still visible to a person
 * reading both entries; a spurious one teaches people to ignore the warning.
 */

export interface ConflictSubject {
  title: string;
  content: string;
}

export interface DetectedConflict {
  reason: string;
  signals: Record<string, unknown>;
}

/** Cosine similarity at which two entries are taken to share a subject. */
export const SAME_SUBJECT_SIMILARITY = 0.8;

/** Title-term overlap at which two entries are taken to share a subject. */
export const SAME_SUBJECT_OVERLAP = 0.6;

export function detectConflict(
  left: ConflictSubject,
  right: ConflictSubject,
  semanticSimilarity?: number,
): DetectedConflict | null {
  const overlap = subjectOverlap(left, right);

  const sameSubject =
    (semanticSimilarity !== undefined && semanticSimilarity >= SAME_SUBJECT_SIMILARITY) ||
    overlap >= SAME_SUBJECT_OVERLAP;

  if (!sameSubject) {
    return null;
  }

  const leftText = `${left.title} ${left.content}`;
  const rightText = `${right.title} ${right.content}`;

  const leftAmounts = amounts(leftText);
  const rightAmounts = amounts(rightText);

  if (
    leftAmounts.length > 0 &&
    rightAmounts.length > 0 &&
    !leftAmounts.some((value) => rightAmounts.includes(value))
  ) {
    return {
      reason: `They state different amounts for the same subject (${leftAmounts.join(", ")} vs ${rightAmounts.join(", ")}).`,
      signals: {
        kind: "amount",
        left: leftAmounts,
        right: rightAmounts,
        semanticSimilarity,
        subjectOverlap: round(overlap),
      },
    };
  }

  const leftPercents = percentages(leftText);
  const rightPercents = percentages(rightText);

  if (
    leftPercents.length > 0 &&
    rightPercents.length > 0 &&
    !leftPercents.some((value) => rightPercents.includes(value))
  ) {
    return {
      reason: `They state different percentages for the same subject (${leftPercents.join(", ")} vs ${rightPercents.join(", ")}).`,
      signals: {
        kind: "percentage",
        left: leftPercents,
        right: rightPercents,
        semanticSimilarity,
        subjectOverlap: round(overlap),
      },
    };
  }

  const leftNegated = negates(leftText);
  const rightNegated = negates(rightText);

  // Polarity alone is weaker evidence than a differing figure, so it needs the
  // stronger form of the same-subject test as well.
  if (
    leftNegated !== rightNegated &&
    (overlap >= SAME_SUBJECT_OVERLAP ||
      (semanticSimilarity !== undefined && semanticSimilarity >= 0.88))
  ) {
    return {
      reason: "One asserts what the other negates about the same subject.",
      signals: {
        kind: "polarity",
        negatedSide: leftNegated ? "left" : "right",
        semanticSimilarity,
        subjectOverlap: round(overlap),
      },
    };
  }

  return null;
}

/** Jaccard overlap of the two titles' terms, with figures removed. */
export function subjectOverlap(left: ConflictSubject, right: ConflictSubject): number {
  const leftTerms = new Set(subjectTerms(left.title));
  const rightTerms = new Set(subjectTerms(right.title));

  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }

  const shared = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  return shared / new Set([...leftTerms, ...rightTerms]).size;
}

function subjectTerms(text: string): string[] {
  return queryTerms(text).filter((term) => !/^\d/.test(term) && !NEGATIONS.has(term));
}

const NEGATIONS = new Set(["not", "never", "no", "none", "nor", "cannot", "without", "avoid", "stop", "longer"]);

const NEGATION_PATTERN =
  /\b(not|never|no longer|cannot|can't|won't|don't|doesn't|isn't|aren't|shouldn't|mustn't|avoid|stop(?:ped)?)\b/i;

function negates(text: string): boolean {
  return NEGATION_PATTERN.test(text);
}

const CURRENCY_SYMBOL = /[$€£₹]\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m)?\b/gi;
const CURRENCY_WORD = /\b(\d[\d,]*(?:\.\d+)?)\s?(k|m)?\s?(usd|eur|gbp|inr|dollars?|euros?|rupees?)\b/gi;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;

/** Every monetary amount in the text, normalized to a plain number. */
export function amounts(text: string): number[] {
  const found = new Set<number>();

  for (const pattern of [CURRENCY_SYMBOL, CURRENCY_WORD]) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]!.replace(/,/g, ""));
      const scale = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : 1;

      if (Number.isFinite(value)) found.add(value * scale);
    }
  }

  return [...found].sort((left, right) => left - right);
}

export function percentages(text: string): number[] {
  const found = new Set<number>();

  for (const match of text.matchAll(PERCENT)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) found.add(value);
  }

  return [...found].sort((left, right) => left - right);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
