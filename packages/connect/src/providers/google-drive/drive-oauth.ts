import { ConnectorError } from "../../errors.js";
import { providerJson, providerRequest, type Fetch } from "../../http.js";
import { cleanLabel } from "../../sanitize.js";
import type {
  AuthorizationRequest,
  ConnectionCredentials,
  OAuthClientConfig,
  OAuthGrant,
  OAuthProvider,
} from "../oauth.js";

/**
 * Google Drive, read-only.
 *
 * One scope, drive.readonly: list, search, read metadata and read content,
 * with no way to create, change, share or delete anything. Narrower scopes
 * exist but do not fit - drive.metadata.readonly cannot read content, and
 * drive.file only sees files this app created or a person picked one by one.
 *
 * Google access tokens last about an hour; the refresh token obtained with
 * offline access renews them on the server. A refresh Google refuses means
 * the grant was withdrawn, and the connection needs a person.
 */

export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export const DRIVE_SCOPES = [DRIVE_READONLY_SCOPE] as const;

export const DRIVE_API = "https://www.googleapis.com/drive/v3";

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

export class DriveOAuth implements OAuthProvider {
  readonly provider = "google_drive" as const;

  constructor(
    private readonly client: OAuthClientConfig,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  authorizationUrl(request: AuthorizationRequest): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.client.clientId);
    url.searchParams.set("redirect_uri", request.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", request.scopes.join(" "));
    url.searchParams.set("state", request.state);
    url.searchParams.set("code_challenge", request.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("access_type", "offline");
    // Without consent Google omits the refresh token on a second connect.
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthGrant> {
    const body = await this.token(new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      client_id: this.client.clientId,
      client_secret: this.client.clientSecret,
    }), "oauth_exchange_failed");

    const scopes = typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [];

    // Google's consent screen lets a person untick a scope. A connection that
    // cannot read Drive is refused here rather than stored and failing later.
    if (!scopes.includes(DRIVE_READONLY_SCOPE)) {
      throw new ConnectorError("scope_not_granted");
    }

    return { ...this.credentialsFrom(body), scopes };
  }

  async refresh(credentials: ConnectionCredentials): Promise<ConnectionCredentials> {
    if (!credentials.refreshToken) {
      throw new ConnectorError("token_expired");
    }

    const body = await this.token(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: this.client.clientId,
      client_secret: this.client.clientSecret,
    }), "token_revoked");

    return {
      ...this.credentialsFrom(body),
      // Google usually keeps the refresh token the same and omits it.
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : credentials.refreshToken,
    };
  }

  async revoke(credentials: ConnectionCredentials): Promise<void> {
    // Revoking the refresh token ends the whole grant, access tokens included.
    const token = credentials.refreshToken ?? credentials.accessToken;

    try {
      await providerRequest(this.fetchImpl, "https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    } catch (error) {
      // Google answers 400 for a token that is already invalid.
      if (error instanceof ConnectorError && (error.code === "input_invalid" || error.code === "not_found")) {
        return;
      }

      throw error;
    }
  }

  async describeAccount(accessToken: string): Promise<string> {
    const about = await providerJson<{ user?: { emailAddress?: unknown; displayName?: unknown } }>(
      this.fetchImpl,
      `${DRIVE_API}/about?fields=user(emailAddress,displayName)`,
      { headers: { authorization: `Bearer ${accessToken}` }, maxBytes: 64 * 1024 },
    );

    const label = cleanLabel(about?.user?.emailAddress, 320) || cleanLabel(about?.user?.displayName, 200);

    if (!label) {
      throw new ConnectorError("malformed_response");
    }

    return label;
  }

  private async token(form: URLSearchParams, refusal: "oauth_exchange_failed" | "token_revoked"): Promise<TokenResponse> {
    try {
      const body = await providerJson<TokenResponse>(this.fetchImpl, "https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
        maxBytes: 64 * 1024,
      });

      if (!body || typeof body.access_token !== "string" || body.access_token === "") {
        throw new ConnectorError("malformed_response");
      }

      return body;
    } catch (error) {
      if (error instanceof ConnectorError && (error.code === "provider_unavailable" || error.code === "rate_limited")) {
        throw error;
      }

      // invalid_grant, a refused client, a malformed answer: one outcome.
      throw new ConnectorError(refusal);
    }
  }

  private credentialsFrom(body: TokenResponse): ConnectionCredentials {
    const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;

    return {
      accessToken: body.access_token as string,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      expiresAt: this.now() + expiresIn * 1000,
    };
  }
}
