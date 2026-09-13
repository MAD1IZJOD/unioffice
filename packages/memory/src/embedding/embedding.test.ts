import assert from "node:assert/strict";
import test from "node:test";

import { cosineSimilarity, knowledgeEmbeddingText } from "./embedding-provider.js";
import { OllamaEmbeddingProvider } from "./ollama-embedding-provider.js";

test("cosine similarity is 1 for identical direction and 0 for orthogonal vectors", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [2, 4, 6]).toFixed(6), "1.000000");
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosine similarity refuses to produce NaN from malformed vectors", () => {
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test("knowledge is embedded as its title followed by its content", () => {
  assert.equal(
    knowledgeEmbeddingText({ title: "Pricing starts at $99", content: "Set in the August review." }),
    "Pricing starts at $99\n\nSet in the August review.",
  );
});

function withFetch(
  handler: (url: string, body: Record<string, unknown>) => Response,
  run: (calls: Array<Record<string, unknown>>) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push(body);
    return handler(String(input), body);
  }) as typeof fetch;

  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

function vectors(count: number, dimensions: number): number[][] {
  return Array.from({ length: count }, (_, index) =>
    Array.from({ length: dimensions }, (__, position) => (index + 1) * (position + 1)));
}

test("prefixes documents and queries differently, as retrieval models expect", async () => {
  await withFetch(
    (_url, body) => new Response(JSON.stringify({ embeddings: vectors((body.input as string[]).length, 4) })),
    async (calls) => {
      const provider = new OllamaEmbeddingProvider({ dimensions: 4 });

      await provider.embed(["pricing history"], "document");
      await provider.embed(["pricing history"], "query");

      assert.deepEqual(calls[0]?.input, ["search_document: pricing history"]);
      assert.deepEqual(calls[1]?.input, ["search_query: pricing history"]);
      assert.equal(calls[0]?.model, "nomic-embed-text");
    },
  );
});

test("splits large requests into bounded batches and keeps the order", async () => {
  await withFetch(
    (_url, body) => {
      const input = body.input as string[];
      // Each vector's first component carries the text's own number back.
      return new Response(JSON.stringify({
        embeddings: input.map((text) => [Number(text.split(" ").pop()), 0, 0, 1]),
      }));
    },
    async (calls) => {
      const provider = new OllamaEmbeddingProvider({ dimensions: 4 });
      const texts = Array.from({ length: 35 }, (_, index) => `item ${index}`);

      const result = await provider.embed(texts, "document");

      assert.equal(calls.length, 3);
      assert.ok(calls.every((call) => (call.input as string[]).length <= 16));
      assert.deepEqual(result.map((vector) => vector[0]), texts.map((_, index) => index));
    },
  );
});

test("bounds each text before it leaves the process", async () => {
  await withFetch(
    (_url, body) => new Response(JSON.stringify({ embeddings: vectors((body.input as string[]).length, 4) })),
    async (calls) => {
      const provider = new OllamaEmbeddingProvider({ dimensions: 4, documentPrefix: "" });

      await provider.embed(["x".repeat(50_000)], "document");

      assert.equal((calls[0]?.input as string[])[0]?.length, 6_000);
    },
  );
});

test("rejects vectors of the wrong size instead of storing them", async () => {
  await withFetch(
    () => new Response(JSON.stringify({ embeddings: vectors(1, 3) })),
    async () => {
      const provider = new OllamaEmbeddingProvider({ dimensions: 768 });

      await assert.rejects(
        provider.embed(["anything"], "query"),
        /not 768 finite numbers/,
      );
    },
  );
});

test("does not surface the model's error body, which can echo the input", async () => {
  await withFetch(
    () => new Response("secret company text echoed back", { status: 500 }),
    async () => {
      const provider = new OllamaEmbeddingProvider();

      await assert.rejects(provider.embed(["secret company text"], "document"), (error: Error) => {
        assert.match(error.message, /Embedding request failed \(500\)/);
        assert.doesNotMatch(error.message, /secret/);
        return true;
      });
    },
  );
});
