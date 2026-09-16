import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorError } from "./errors.js";
import { ConnectionRateLimiter } from "./rate-limiter.js";

test("a connection is refused past its window and allowed again after it", () => {
  let now = 0;
  const limiter = new ConnectionRateLimiter(3, 60_000, () => now);

  limiter.take("a");
  limiter.take("a");
  limiter.take("a");

  assert.throws(() => limiter.take("a"), (error: unknown) =>
    error instanceof ConnectorError && error.code === "rate_limited" && error.retryAfterSeconds === 60);

  // Another connection has its own window.
  limiter.take("b");

  now = 60_000;
  limiter.take("a");
});
