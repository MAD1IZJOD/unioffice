import { ConnectorError } from "./errors.js";

/**
 * How often one connection may be used from this process.
 *
 * A fixed window per connection. Providers enforce their own limits and those
 * are respected as they are reported; this exists so a runaway loop - an agent
 * retrying, a mission fanned out across many steps - stops here, well before
 * it spends the organization's provider quota or gets its account flagged.
 *
 * The window is per process. The API and each worker count separately, which
 * is documented rather than hidden: the provider's own limit is still the
 * one that cannot be exceeded.
 */
export class ConnectionRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limit = 60,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Throws rate_limited when this connection has used its window. */
  take(connectionId: string): void {
    const now = this.now();
    const current = this.windows.get(connectionId);

    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(connectionId, { startedAt: now, count: 1 });
      this.prune(now);
      return;
    }

    if (current.count >= this.limit) {
      throw new ConnectorError("rate_limited", {
        retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + this.windowMs - now) / 1000)),
      });
    }

    current.count += 1;
  }

  private prune(now: number): void {
    if (this.windows.size < 1_000) return;

    for (const [id, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) {
        this.windows.delete(id);
      }
    }
  }
}
