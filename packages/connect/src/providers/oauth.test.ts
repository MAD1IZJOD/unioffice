import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ConnectorError } from "../errors.js";
import type { Fetch } from "../http.js";
import { GitHubOAuth } from "./github/github-oauth.js";
import { DRIVE_READONLY_SCOPE, DriveOAuth } from "./google-drive/drive-oauth.js";
import {
  createOAuthState,
  createPkcePair,
  hashOAuthState,
  parseCredentials,
  serializeCredentials,
} from "./oauth.js";

const client = { clientId: "client-id", clientSecret: "client-secret-value" };

interface Seen {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

function fakeFetch(answer: (seen: Seen) => Response): { fetch: Fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: (async (url: string | URL, init?: RequestInit) => {
      const entry = {
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? String(init.body) : "",
        headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      };
      seen.push(entry);
      return answer(entry);
    }) as Fetch,
  };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "none";
  } catch (error) {
    assert.ok(error instanceof ConnectorError, String(error));
    return error.code;
  }
}

test("states are unguessable and stored only as a hash; PKCE uses S256", () => {
  const state = createOAuthState();

  assert.ok(state.length >= 43);
  assert.notEqual(createOAuthState(), state);
  assert.match(hashOAuthState(state), /^[0-9a-f]{64}$/);
  assert.notEqual(hashOAuthState(state), state);

  const { verifier, challenge } = createPkcePair();
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
});

test("credentials round-trip and incomplete ones are refused", () => {
  const credentials = { accessToken: "a", refreshToken: "r", expiresAt: 5 };
  assert.deepEqual(parseCredentials(serializeCredentials(credentials)), credentials);
  assert.throws(() => parseCredentials("{}"));
});

test("the GitHub authorization URL carries state, PKCE and the scope, never the secret", () => {
  const url = new URL(new GitHubOAuth(client).authorizationUrl({
    state: "state-value",
    codeChallenge: "challenge",
    redirectUri: "http://127.0.0.1:4000/connections/oauth/github/callback",
    scopes: ["public_repo"],
  }));

  assert.equal(url.origin, "https://github.com");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "public_repo");
  assert.doesNotMatch(url.toString(), /client-secret-value/);
});

test("GitHub exchanges a code with the verifier and reports granted scopes", async () => {
  const { fetch, seen } = fakeFetch(() => json({ access_token: "gho_token", scope: "public_repo", token_type: "bearer" }));

  const grant = await new GitHubOAuth(client, fetch).exchangeCode({ code: "code", codeVerifier: "verifier", redirectUri: "http://x/cb" });

  assert.deepEqual(grant, { accessToken: "gho_token", scopes: ["public_repo"] });
  assert.match(seen[0]!.body, /code_verifier=verifier/);
});

test("GitHub's 200-with-error answer to a bad code is a failed exchange", async () => {
  const { fetch } = fakeFetch(() => json({ error: "bad_verification_code", error_description: "gho_leak" }));
  assert.equal(await codeOf(new GitHubOAuth(client, fetch).exchangeCode({ code: "x", codeVerifier: "v", redirectUri: "r" })), "oauth_exchange_failed");
});

test("revoking a GitHub token that is already gone still succeeds", async () => {
  const gone = fakeFetch(() => new Response("", { status: 404 }));
  await new GitHubOAuth(client, gone.fetch).revoke({ accessToken: "gho_token" });
  assert.equal(gone.seen[0]!.method, "DELETE");
  assert.match(gone.seen[0]!.url, /\/applications\/client-id\/token$/);

  const down = fakeFetch(() => new Response("", { status: 503 }));
  assert.equal(await codeOf(new GitHubOAuth(client, down.fetch).revoke({ accessToken: "gho_token" })), "provider_unavailable");
});

test("Drive asks for read-only offline access", () => {
  const url = new URL(new DriveOAuth(client).authorizationUrl({
    state: "s",
    codeChallenge: "c",
    redirectUri: "http://x/cb",
    scopes: [DRIVE_READONLY_SCOPE],
  }));

  assert.equal(url.searchParams.get("scope"), DRIVE_READONLY_SCOPE);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.doesNotMatch(url.toString(), /client-secret-value/);
});

test("Drive refuses a grant where the person unticked Drive access", async () => {
  const { fetch } = fakeFetch(() => json({ access_token: "ya29", refresh_token: "1//r", expires_in: 3599, scope: "openid" }));
  assert.equal(await codeOf(new DriveOAuth(client, fetch).exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r" })), "scope_not_granted");
});

test("Drive exchange records expiry and a refused refresh means the grant is gone", async () => {
  const now = 1_000_000;
  const ok = fakeFetch(() => json({ access_token: "ya29", refresh_token: "1//r", expires_in: 3599, scope: DRIVE_READONLY_SCOPE }));
  const grant = await new DriveOAuth(client, ok.fetch, () => now).exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r" });

  assert.equal(grant.expiresAt, now + 3_599_000);
  assert.equal(grant.refreshToken, "1//r");

  const refreshed = fakeFetch(() => json({ access_token: "ya29-new", expires_in: 3599 }));
  const renewed = await new DriveOAuth(client, refreshed.fetch, () => now).refresh!(grant);
  assert.equal(renewed.accessToken, "ya29-new");
  assert.equal(renewed.refreshToken, "1//r", "the refresh token is kept when Google omits it");

  const refused = fakeFetch(() => json({ error: "invalid_grant" }, 400));
  assert.equal(await codeOf(new DriveOAuth(client, refused.fetch).refresh!(grant)), "token_revoked");

  assert.equal(await codeOf(new DriveOAuth(client, refused.fetch).refresh!({ accessToken: "ya29" })), "token_expired");
});

test("Drive revokes the refresh token in the body, never the URL", async () => {
  const { fetch, seen } = fakeFetch(() => new Response("", { status: 200 }));
  await new DriveOAuth(client, fetch).revoke({ accessToken: "ya29", refreshToken: "1//refresh" });

  assert.equal(seen[0]!.url, "https://oauth2.googleapis.com/revoke");
  assert.match(seen[0]!.body, /token=1%2F%2Frefresh/);
});
