import { createHash } from "node:crypto";

import type { UserId } from "@unioffice/core";

/** Who a valid access token belongs to. Nothing else about the caller is trusted. */
export interface Identity {
  userId: UserId;
  email: string;
  /** Only a confirmed address may pick up an invitation sent to it. */
  emailConfirmed: boolean;
}

export interface Authenticator {
  /** The token's owner, or null when the token is missing, expired, forged or revoked. */
  verify(token: string): Promise<Identity | null>;
}

/** The one call this needs from a Supabase client. */
export interface AuthUserLookup {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null };
      error: unknown;
    }>;
  };
}

interface CachedIdentity {
  identity: Identity;
  expiresAt: number;
}

/**
 * Verifies Supabase access tokens with the auth server itself.
 *
 * Asking the auth server rather than only checking a signature means a
 * signed-out or deleted user stops working. A confirmed identity is kept
 * briefly so a page of parallel reads is not a page of auth round trips; the
 * cache is keyed by a hash of the token so no token sits in memory as text,
 * and an entry never outlives the token's own expiry.
 */
export class SupabaseAuthenticator implements Authenticator {
  private readonly cache = new Map<string, CachedIdentity>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    private readonly client: AuthUserLookup,
    options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 1_000;
    this.now = options.now ?? Date.now;
  }

  async verify(token: string): Promise<Identity | null> {
    if (!token || token.length > 8_192) return null;

    const key = createHash("sha256").update(token).digest("hex");
    const now = this.now();
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > now) return cached.identity;
    if (cached) this.cache.delete(key);

    const expiry = tokenExpiry(token);
    if (expiry !== undefined && expiry <= now) return null;

    let result: Awaited<ReturnType<AuthUserLookup["auth"]["getUser"]>>;

    try {
      result = await this.client.auth.getUser(token);
    } catch {
      return null;
    }

    const user = result.data.user;
    if (result.error || !user?.id || !user.email) return null;

    const identity: Identity = {
      userId: user.id as UserId,
      email: user.email.toLowerCase(),
      emailConfirmed: Boolean(user.email_confirmed_at),
    };

    if (this.cache.size >= this.maxEntries) {
      // Oldest first: a Map iterates in insertion order.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }

    this.cache.set(key, {
      identity,
      expiresAt: Math.min(now + this.ttlMs, expiry ?? Number.POSITIVE_INFINITY),
    });

    return identity;
  }
}

/** The bearer token in an Authorization header, or null. */
export function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;

  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

/**
 * The exp claim, read without trusting it. It only ever shortens how long a
 * verified identity is remembered; whether the token is valid is the auth
 * server's answer.
 */
function tokenExpiry(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
