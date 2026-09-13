/**
 * Turns text into a vector for semantic retrieval.
 *
 * The contract is deliberately small so the provider can be swapped without
 * touching retrieval: today it is a model running locally in Ollama, which
 * means company knowledge is embedded on the company's own machine and never
 * sent to a third party. Anything that implements this - a hosted model, a
 * test double - works the same way.
 */
export interface EmbeddingProvider {
  /** Recorded on each row, so a change of model is detectable later. */
  readonly model: string;

  /** Must match the column the vectors are stored in. */
  readonly dimensions: number;

  /**
   * Embeds a batch. `purpose` exists because retrieval models embed a stored
   * document and a search query differently, and mixing the two quietly
   * degrades relevance.
   */
  embed(
    texts: string[],
    purpose: EmbeddingPurpose,
  ): Promise<number[][]>;
}

export type EmbeddingPurpose = "document" | "query";

/**
 * Cosine similarity in [-1, 1]. Returns 0 for mismatched or zero vectors
 * rather than NaN, so one malformed vector cannot poison a whole ranking.
 */
export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/** The text a piece of knowledge is embedded as: its title, then its body. */
export function knowledgeEmbeddingText(knowledge: {
  title: string;
  content: string;
}): string {
  return `${knowledge.title}\n\n${knowledge.content}`;
}
