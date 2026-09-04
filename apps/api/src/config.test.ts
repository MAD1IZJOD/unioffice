import assert from "node:assert/strict";
import test from "node:test";

import { loadApiConfig } from "./config.js";

function environment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    ...overrides,
  };
}

test("uses explicit local development CORS origins by default", () => {
  const config = loadApiConfig(environment());

  assert.deepEqual(config.corsOrigins, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
});

test("rejects CORS entries with a path", () => {
  assert.throws(
    () => loadApiConfig(environment({
      API_CORS_ORIGINS: "https://app.example.com/control-plane",
    })),
    /without paths/,
  );
});
