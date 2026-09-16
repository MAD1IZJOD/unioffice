import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorError } from "./errors.js";
import { providerJson, providerRequest, type Fetch } from "./http.js";

function respond(status: number, body: string, headers: Record<string, string> = {}): Fetch {
  return (async () => new Response(status === 204 ? null : body, { status, headers })) as Fetch;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "none";
  } catch (error) {
    assert.ok(error instanceof ConnectorError);
    return error.code;
  }
}

test("provider failures become fixed codes and never carry the provider's text", async () => {
  const leaky = "token gho_abc123 is invalid for private/repo";

  const cases: Array<[number, Record<string, string>, string]> = [
    [401, {}, "token_revoked"],
    [403, {}, "permission_denied"],
    [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60) }, "rate_limited"],
    [404, {}, "not_found"],
    [422, {}, "input_invalid"],
    [429, { "retry-after": "30" }, "rate_limited"],
    [500, {}, "provider_unavailable"],
    [503, {}, "provider_unavailable"],
  ];

  for (const [status, headers, code] of cases) {
    try {
      await providerRequest(respond(status, leaky, headers), "https://provider.test/x");
      assert.fail(`status ${status} should throw`);
    } catch (error) {
      assert.ok(error instanceof ConnectorError);
      assert.equal(error.code, code, `status ${status}`);
      assert.doesNotMatch(error.message, /gho_abc123|private\/repo/);
    }
  }
});

test("a rate limit says how long to wait, capped", async () => {
  try {
    await providerRequest(respond(429, "", { "retry-after": "99999" }), "https://provider.test/x");
  } catch (error) {
    assert.equal((error as ConnectorError).retryAfterSeconds, 3600);
  }
});

test("a network failure or timeout reads as the provider being unavailable", async () => {
  const failing = (async () => {
    throw new TypeError("getaddrinfo ENOTFOUND api.github.com");
  }) as Fetch;

  assert.equal(await codeOf(providerRequest(failing, "https://provider.test/x")), "provider_unavailable");

  const hanging = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as Fetch;

  assert.equal(await codeOf(providerRequest(hanging, "https://provider.test/x", { timeoutMs: 20 })), "provider_unavailable");
});

test("a body past the byte ceiling is cut in the stream", async () => {
  const big = "x".repeat(10_000);
  const response = await providerRequest(respond(200, big), "https://provider.test/x", { maxBytes: 100 });

  assert.equal(response.text.length, 100);
  assert.equal(response.truncated, true);

  assert.equal(await codeOf(providerJson(respond(200, `"${big}"`), "https://provider.test/x", { maxBytes: 100 })), "too_large");
});

test("JSON that does not parse is malformed, and an empty success is fine", async () => {
  assert.equal(await codeOf(providerJson(respond(200, "<html>oops"), "https://provider.test/x")), "malformed_response");
  assert.equal(await providerJson(respond(204, ""), "https://provider.test/x"), undefined);
  assert.deepEqual(await providerJson(respond(200, '{"a":1}'), "https://provider.test/x"), { a: 1 });
});

test("a failed request is made exactly once", async () => {
  let calls = 0;
  const flaky = (async () => {
    calls += 1;
    return new Response("", { status: 503 });
  }) as Fetch;

  await codeOf(providerRequest(flaky, "https://provider.test/x"));
  assert.equal(calls, 1);
});
