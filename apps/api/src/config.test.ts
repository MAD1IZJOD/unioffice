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

test("stale-run window defaults to 15 minutes", () => {
  const config = loadApiConfig(environment());

  assert.equal(config.staleRunAfterMs, 15 * 60_000);
});

test("stale-run window can be shortened for operators", () => {
  const config = loadApiConfig({
    ...environment(),
    EXECUTION_STALE_AFTER_MINUTES: "2",
  });

  assert.equal(config.staleRunAfterMs, 2 * 60_000);
});

test("rejects a stale-run window that is not a positive number", () => {
  assert.throws(
    () => loadApiConfig({ ...environment(), EXECUTION_STALE_AFTER_MINUTES: "0" }),
    /EXECUTION_STALE_AFTER_MINUTES must be a positive number/,
  );

  assert.throws(
    () => loadApiConfig({ ...environment(), EXECUTION_STALE_AFTER_MINUTES: "soon" }),
    /EXECUTION_STALE_AFTER_MINUTES must be a positive number/,
  );
});

test("connections are off until a provider is configured", () => {
  const config = loadApiConfig(environment());

  assert.equal(config.connect.github, undefined);
  assert.equal(config.connect.googleDrive, undefined);
  assert.equal(config.connect.webUrl, "http://localhost:5173");
});

test("a connection provider needs the encryption key", () => {
  assert.throws(
    () => loadApiConfig(environment({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" })),
    /CONNECT_ENCRYPTION_KEY is required/,
  );

  const config = loadApiConfig(environment({
    GITHUB_CLIENT_ID: "id",
    GITHUB_CLIENT_SECRET: "secret",
    CONNECT_ENCRYPTION_KEY: "a2V5",
    API_URL: "http://localhost:4000/",
  }));

  assert.deepEqual(config.connect.github, { clientId: "id", clientSecret: "secret" });
  assert.equal(config.connect.publicApiUrl, "http://localhost:4000");
});

test("a provider's client id and secret must come together, and the error names neither value", () => {
  assert.throws(
    () => loadApiConfig(environment({ GOOGLE_DRIVE_CLIENT_SECRET: "do-not-print", CONNECT_ENCRYPTION_KEY: "a2V5" })),
    (error: Error) => /must be set together/.test(error.message) && !error.message.includes("do-not-print"),
  );
});
