import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { TokenCipher, TokenCipherError } from "./token-cipher.js";

const key = randomBytes(32).toString("base64");

test("sealed credentials open only with the same key and binding", () => {
  const cipher = new TokenCipher(key);
  const envelope = cipher.seal('{"accessToken":"gho_secret"}', "connection:1");

  assert.doesNotMatch(envelope, /gho_secret/);
  assert.equal(cipher.open(envelope, "connection:1"), '{"accessToken":"gho_secret"}');

  assert.throws(() => cipher.open(envelope, "connection:2"), TokenCipherError);
  assert.throws(() => new TokenCipher(randomBytes(32).toString("base64")).open(envelope, "connection:1"), TokenCipherError);
});

test("the same secret never seals to the same envelope twice", () => {
  const cipher = new TokenCipher(key);
  assert.notEqual(cipher.seal("token", "a"), cipher.seal("token", "a"));
});

test("an altered envelope does not open", () => {
  const cipher = new TokenCipher(key);
  const [version, iv, tag, body] = cipher.seal("token", "a").split(".");
  const flipped = Buffer.from(body!, "base64url");
  flipped[0] = flipped[0]! ^ 1;

  assert.throws(() => cipher.open([version, iv, tag, flipped.toString("base64url")].join("."), "a"), TokenCipherError);
  assert.throws(() => cipher.open("not an envelope", "a"), TokenCipherError);
});

test("a key that is not 32 bytes is refused, and the error never repeats it", () => {
  const short = randomBytes(16).toString("base64");

  assert.throws(() => new TokenCipher(short), (error: Error) => !error.message.includes(short));
  assert.throws(() => new TokenCipher(""), TokenCipherError);
  assert.throws(() => new TokenCipher("not base64 at all!"), TokenCipherError);
});

test("errors from opening say nothing about the envelope or the key", () => {
  const cipher = new TokenCipher(key);
  const envelope = cipher.seal("super-secret-token", "a");

  try {
    cipher.open(envelope, "b");
    assert.fail("should not open");
  } catch (error) {
    const message = (error as Error).message;
    assert.doesNotMatch(message, /super-secret-token/);
    assert.equal(message.includes(envelope), false);
    assert.equal(message.includes(key), false);
  }
});
