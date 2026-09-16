/**
 * Everything that can go wrong talking to another system, as a fixed set.
 *
 * A provider's own error text is never passed on. It can quote the request
 * back, name private resources, or carry whatever an attacker put in a field,
 * and it would travel from here into tool results, events and the browser. A
 * code and a sentence written here travel instead.
 */
export type ConnectorErrorCode =
  | "not_configured"
  | "not_connected"
  | "capability_disabled"
  | "oauth_denied"
  | "oauth_state_invalid"
  | "oauth_exchange_failed"
  | "scope_not_granted"
  | "token_expired"
  | "token_revoked"
  | "provider_unavailable"
  | "rate_limited"
  | "permission_denied"
  | "not_found"
  | "malformed_response"
  | "unsupported_content"
  | "too_large"
  | "input_invalid";

const MESSAGES: Record<ConnectorErrorCode, string> = {
  not_configured: "This provider is not set up on the server.",
  not_connected: "The organization has no active connection for this provider here.",
  capability_disabled: "The connection does not allow this action. An admin can enable it on the connection.",
  oauth_denied: "Authorization was declined at the provider.",
  oauth_state_invalid: "This authorization link is invalid, expired or was already used. Start again.",
  oauth_exchange_failed: "The provider did not complete the authorization. Start again.",
  scope_not_granted: "The provider did not grant the access this connection needs.",
  token_expired: "The connection's authorization has expired. Reconnect it.",
  token_revoked: "The provider no longer accepts this connection. Reconnect it.",
  provider_unavailable: "The provider could not be reached. Try again later.",
  rate_limited: "The provider's rate limit was reached. Try again later.",
  permission_denied: "The connected account does not have permission for that.",
  not_found: "That was not found, or the connected account cannot see it.",
  malformed_response: "The provider returned a response that could not be read.",
  unsupported_content: "That file's content cannot be read as text.",
  too_large: "That is too large to read.",
  input_invalid: "The request was not valid.",
};

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;

  /** When the provider said how long to wait. */
  readonly retryAfterSeconds?: number;

  constructor(code: ConnectorErrorCode, options: { message?: string; retryAfterSeconds?: number } = {}) {
    super(options.message ?? MESSAGES[code]);
    this.name = "ConnectorError";
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function connectorMessage(code: ConnectorErrorCode): string {
  return MESSAGES[code];
}

/** True for failures that mean the stored credentials are no good any more. */
export function isCredentialFailure(error: unknown): boolean {
  return error instanceof ConnectorError &&
    (error.code === "token_expired" || error.code === "token_revoked");
}
