import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * Seals provider credentials before they are stored.
 *
 * AES-256-GCM, so a stored envelope is both unreadable and tamper-evident: a
 * flipped byte fails to open rather than opening to something else. Every
 * envelope is bound to what it belongs to - a connection, an OAuth state -
 * through the associated data, so an envelope copied from one row onto
 * another does not open there either.
 *
 * The key comes from the server's environment and nowhere else. It is never
 * in source, never in the database beside what it protects, and never logged:
 * nothing in this file includes key material, plaintext or ciphertext in an
 * error.
 */

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCipherError";
  }
}

export class TokenCipher {
  private readonly key: Buffer;

  /** `encodedKey` is 32 random bytes, base64 encoded. */
  constructor(encodedKey: string) {
    const key = decodeKey(encodedKey);

    if (!key) {
      throw new TokenCipherError(
        "CONNECT_ENCRYPTION_KEY must be 32 random bytes, base64 encoded.",
      );
    }

    this.key = key;
  }

  seal(plaintext: string, boundTo: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(`${VERSION}:${boundTo}`, "utf8"));

    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  open(envelope: string, boundTo: string): string {
    const parts = envelope.split(".");

    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new TokenCipherError("Stored credentials are not in a readable format.");
    }

    const iv = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    const ciphertext = Buffer.from(parts[3]!, "base64url");

    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new TokenCipherError("Stored credentials are not in a readable format.");
    }

    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(`${VERSION}:${boundTo}`, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      // Wrong key, wrong row or altered bytes - all the same to a caller, and
      // none of them worth describing further.
      throw new TokenCipherError("Stored credentials could not be opened.");
    }
  }
}

function decodeKey(encodedKey: string): Buffer | null {
  const trimmed = encodedKey.trim();

  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    return null;
  }

  const key = Buffer.from(trimmed, trimmed.includes("-") || trimmed.includes("_") ? "base64url" : "base64");
  return key.length === KEY_BYTES ? key : null;
}
