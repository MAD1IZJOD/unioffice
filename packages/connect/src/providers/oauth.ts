import { createHash, randomBytes } from "node:crypto";

import type { ConnectionProvider } from "@unioffice/core";

/**
 * The shape every provider's OAuth takes.
 *
 * Each provider implements the same five steps, so the service that runs the
 * round trip, stores the result and disconnects never branches on who the
 * provider is. Client secrets are held by the provider object on the server;
 * none of these methods returns one.
 */

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

/** What a provider hands back for an account. Sealed before it is stored. */
export interface ConnectionCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. Absent when the provider's tokens do not expire. */
  expiresAt?: number;
}

export interface OAuthGrant extends ConnectionCredentials {
  /** What the provider says it granted, which may be less than was asked. */
  scopes: string[];
}

export interface AuthorizationRequest {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuthProvider {
  readonly provider: ConnectionProvider;

  authorizationUrl(request: AuthorizationRequest): string;

  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthGrant>;

  /** Absent for providers whose tokens do not expire. */
  refresh?(credentials: ConnectionCredentials): Promise<ConnectionCredentials>;

  /** Best effort at the provider. Resolves when the token is already dead. */
  revoke(credentials: ConnectionCredentials): Promise<void>;

  /** A label for the account the token acts as, for people to recognise it. */
  describeAccount(accessToken: string): Promise<string>;
}

/** A value only the server and the browser mid-round-trip ever hold. */
export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored in place of the state. */
export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

export function parseCredentials(json: string): ConnectionCredentials {
  const value = JSON.parse(json) as Partial<ConnectionCredentials>;

  if (typeof value.accessToken !== "string" || value.accessToken === "") {
    throw new Error("Stored credentials are incomplete.");
  }

  return {
    accessToken: value.accessToken,
    refreshToken: typeof value.refreshToken === "string" ? value.refreshToken : undefined,
    expiresAt: typeof value.expiresAt === "number" ? value.expiresAt : undefined,
  };
}

export function serializeCredentials(credentials: ConnectionCredentials): string {
  return JSON.stringify({
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    expiresAt: credentials.expiresAt,
  });
}
