import assert from "node:assert/strict";
import test from "node:test";

import { bearerToken, SupabaseAuthenticator, type AuthUserLookup } from "./authenticator.js";

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode(claims)}.signature`;
}

function lookup(users: Record<string, { id: string; email: string; email_confirmed_at?: string }>) {
  const calls: string[] = [];
  const client: AuthUserLookup = {
    auth: {
      async getUser(token) {
        calls.push(token);
        const user = users[token];
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: "invalid JWT" } };
      },
    },
  };
  return { client, calls };
}

test("a valid token resolves to its user, with the email lowercased", async () => {
  const token = jwt({ exp: 4_000_000_000 });
  const { client } = lookup({ [token]: { id: "user-a", email: "A@Example.test", email_confirmed_at: "2026-01-01" } });

  assert.deepEqual(await new SupabaseAuthenticator(client).verify(token), {
    userId: "user-a",
    email: "a@example.test",
    emailConfirmed: true,
  });
});

test("an unknown, empty or oversized token resolves to nobody", async () => {
  const { client } = lookup({});
  const authenticator = new SupabaseAuthenticator(client);

  assert.equal(await authenticator.verify(jwt({ exp: 4_000_000_000 })), null);
  assert.equal(await authenticator.verify(""), null);
  assert.equal(await authenticator.verify("x".repeat(9_000)), null);
});

test("an expired token is refused without asking the auth server", async () => {
  const token = jwt({ exp: 1_000 });
  const { client, calls } = lookup({ [token]: { id: "user-a", email: "a@example.test" } });

  assert.equal(await new SupabaseAuthenticator(client, { now: () => 2_000_000 }).verify(token), null);
  assert.deepEqual(calls, []);
});

test("a verified identity is remembered briefly, then checked again", async () => {
  let now = 1_000_000;
  const token = jwt({ exp: 4_000_000_000 });
  const users = { [token]: { id: "user-a", email: "a@example.test" } };
  const { client, calls } = lookup(users);
  const authenticator = new SupabaseAuthenticator(client, { ttlMs: 30_000, now: () => now });

  await authenticator.verify(token);
  await authenticator.verify(token);
  assert.equal(calls.length, 1);

  // Signed out on the auth server: once the short window passes, it stops working.
  delete users[token];
  now += 30_001;
  assert.equal(await authenticator.verify(token), null);
  assert.equal(calls.length, 2);
});

test("a failed lookup is not remembered", async () => {
  const token = jwt({ exp: 4_000_000_000 });
  const users: Record<string, { id: string; email: string }> = {};
  const { client, calls } = lookup(users);
  const authenticator = new SupabaseAuthenticator(client);

  assert.equal(await authenticator.verify(token), null);
  users[token] = { id: "user-a", email: "a@example.test" };
  assert.equal((await authenticator.verify(token))?.userId, "user-a");
  assert.equal(calls.length, 2);
});

test("only a well-formed bearer header yields a token", () => {
  assert.equal(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(bearerToken("bearer abc"), "abc");
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken("Bearer abc def"), null);
  assert.equal(bearerToken(undefined), null);
  assert.equal(bearerToken(["Bearer a", "Bearer b"]), null);
});
