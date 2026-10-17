import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { OllamaModelProvider } from "./ollama-model-provider.js";

test("aborts an Ollama generation that exceeds its timeout", async () => {
  const server = createServer(() => {
    // Keep the connection open until the provider aborts it.
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const provider = new OllamaModelProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    timeoutMs: 50,
  });

  try {
    await assert.rejects(
      provider.generate({
        model: "qwen3:8b",
        messages: [{ role: "user", content: "Hello" }],
      }),
      /Ollama generation timed out after 50ms/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});
