import type { ConnectionItem } from "./api";
import type { Tone } from "./tone";

/**
 * What the connections pages say, in one place.
 *
 * The browser never holds a token, a client secret or anything a provider
 * sent back. What it does hold is where to send a person to authorize, and a
 * fixed code when a round trip ends badly - and it only ever turns that code
 * into one of the sentences below, never into text taken from the address.
 */

export const CONNECTION_STATUS: Record<ConnectionItem["status"], { label: string; tone: Tone }> = {
  active: { label: "Connected", tone: "live" },
  needs_attention: { label: "Needs reconnecting", tone: "warning" },
  revoked: { label: "Disconnected", tone: "idle" },
};

const CALLBACK_MESSAGES: Record<string, string> = {
  not_configured: "This provider is not set up on the server.",
  oauth_denied: "Authorization was declined, so nothing was connected.",
  oauth_state_invalid: "That authorization link was invalid, expired or already used. Start again from here.",
  oauth_exchange_failed: "The provider did not complete the authorization. Nothing was connected; try again.",
  scope_not_granted: "The provider did not grant the access the connection needs. Nothing was connected.",
  provider_unavailable: "The provider could not be reached. Try again later.",
  rate_limited: "The provider asked us to slow down. Try again in a few minutes.",
};

/** A sentence for a callback's error code. Unknown codes get a generic one, never the code's text. */
export function callbackMessage(code: string | null): string | undefined {
  if (!code) return undefined;
  return CALLBACK_MESSAGES[code] ?? "The connection was not completed.";
}

/** Where a provider's consent screen may live. Anything else is refused. */
const AUTHORIZATION_HOSTS = new Set(["github.com", "accounts.google.com"]);

export function isAuthorizationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && AUTHORIZATION_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Sends the person to the provider to authorize. The API chose the address;
 * this still refuses one that is not a provider's own https consent page, so
 * a compromised or mistaken response cannot send anyone somewhere else.
 */
export function leaveForAuthorization(url: string): void {
  if (!isAuthorizationUrl(url)) {
    throw new Error("The server returned an authorization address that is not a known provider.");
  }

  window.location.assign(url);
}

export const SCOPE_LABEL: Record<string, string> = {
  public_repo: "Public repositories (read and write)",
  repo: "Public and private repositories (read and write)",
  "https://www.googleapis.com/auth/drive.readonly": "Drive, read-only",
};
