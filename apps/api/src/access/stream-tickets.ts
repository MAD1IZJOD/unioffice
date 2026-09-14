import { createHash, randomBytes } from "node:crypto";

import type { Identity } from "./authenticator.js";

interface Ticket {
  identity: Identity;
  organizationId: string;
  expiresAt: number;
}

/**
 * Short-lived, single-use passes for the live channel.
 *
 * A browser's EventSource cannot send an Authorization header, and putting
 * the access token itself in a URL would leave a long-lived credential in
 * logs and history. So a signed-in request trades its token for a ticket that
 * names one person and one organization, works once, and expires within a
 * minute. Opening the stream still resolves the membership fresh, so a
 * ticket carries no access of its own - only who is asking, and where.
 */
export class StreamTickets {
  private readonly tickets = new Map<string, Ticket>();
  private readonly ttlMs: number;
  private readonly maxTickets: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; maxTickets?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.maxTickets = options.maxTickets ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  issue(identity: Identity, organizationId: string): { ticket: string; expiresAt: string } {
    const now = this.now();
    this.sweep(now);

    if (this.tickets.size >= this.maxTickets) {
      const oldest = this.tickets.keys().next().value;
      if (oldest !== undefined) this.tickets.delete(oldest);
    }

    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = now + this.ttlMs;

    // Stored by hash, so the map never holds a usable ticket.
    this.tickets.set(hash(ticket), { identity, organizationId, expiresAt });

    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** The ticket's holder, once. A second use, an expired or an unknown ticket is null. */
  redeem(ticket: string): { identity: Identity; organizationId: string } | null {
    if (!ticket || ticket.length > 128) return null;

    const key = hash(ticket);
    const entry = this.tickets.get(key);
    if (!entry) return null;

    this.tickets.delete(key);
    if (entry.expiresAt <= this.now()) return null;

    return { identity: entry.identity, organizationId: entry.organizationId };
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.tickets) {
      if (entry.expiresAt <= now) this.tickets.delete(key);
    }
  }
}

function hash(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}
