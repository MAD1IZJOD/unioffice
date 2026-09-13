import type {
  EmbeddingProvider,
  EmbeddingPurpose,
} from "./embedding-provider.js";

export interface OllamaEmbeddingProviderOptions {
  baseUrl?: string;

  model?: string;

  dimensions?: number;

  /**
   * Instruction prefixes the model was trained with. nomic-embed-text expects
   * these; a model that does not can be given empty strings.
   */
  documentPrefix?: string;

  queryPrefix?: string;

  timeoutMs?: number;
}

const MAX_BATCH = 16;

/**
 * An embedding request is bounded on the way in. The model truncates long
 * input itself, but sending it megabytes to truncate is still a cost a caller
 * should not be able to impose.
 */
const MAX_TEXT_CHARS = 6_000;

/**
 * Local embeddings through Ollama.
 *
 * The default model is nomic-embed-text: small enough to run beside the
 * generation model on the same machine, 768 dimensions, and trained for
 * retrieval. Company knowledge stays on the company's hardware.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;

  readonly dimensions: number;

  private readonly baseUrl: string;

  private readonly documentPrefix: string;

  private readonly queryPrefix: string;

  private readonly timeoutMs: number;

  constructor(options: OllamaEmbeddingProviderOptions = {}) {
    try {
      this.baseUrl = new URL(options.baseUrl ?? "http://127.0.0.1:11434")
        .toString()
        .replace(/\/$/, "");
    } catch {
      throw new Error("Ollama baseUrl must be a valid URL.");
    }

    this.model = options.model ?? "nomic-embed-text";
    this.dimensions = options.dimensions ?? 768;
    this.documentPrefix = options.documentPrefix ?? "search_document: ";
    this.queryPrefix = options.queryPrefix ?? "search_query: ";
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async embed(
    texts: string[],
    purpose: EmbeddingPurpose,
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const vectors: number[][] = [];

    for (let start = 0; start < texts.length; start += MAX_BATCH) {
      const batch = texts.slice(start, start + MAX_BATCH);
      vectors.push(...(await this.embedBatch(batch, purpose)));
    }

    return vectors;
  }

  private async embedBatch(
    texts: string[],
    purpose: EmbeddingPurpose,
  ): Promise<number[][]> {
    const prefix = purpose === "query" ? this.queryPrefix : this.documentPrefix;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          input: texts.map((text) => `${prefix}${text.slice(0, MAX_TEXT_CHARS)}`),
          truncate: true,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(
        `Unable to reach the embedding model at ${this.baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // The body can echo input back; only the status is surfaced.
      throw new Error(`Embedding request failed (${response.status}).`);
    }

    const data = (await response.json()) as { embeddings?: unknown };

    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
      throw new Error("The embedding model returned the wrong number of vectors.");
    }

    return data.embeddings.map((vector) => this.validate(vector));
  }

  private validate(vector: unknown): number[] {
    if (
      !Array.isArray(vector) ||
      vector.length !== this.dimensions ||
      !vector.every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      throw new Error(
        `The embedding model returned a vector that is not ${this.dimensions} finite numbers.`,
      );
    }

    return vector as number[];
  }
}
