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
 * GitHub, through an OAuth App.
 *
 * OAuth App scopes are coarse, and the choice here is between two of them:
 *
 *   public_repo - public repositories only, read and write
 *   repo        - public and private repositories, read and write
 *
 * GitHub offers no read-only repository scope for OAuth Apps. What agents may
 * actually do is therefore narrowed on this side: a connection starts with
 * reads only, writes are a capability an admin turns on, and every write still
 * needs a person's approval of the step. GitHub's user access tokens for OAuth
 * Apps do not expire; they end when revoked here, by the user on GitHub, or by
 * GitHub itself.
 */

export const GITHUB_SCOPES = {
  public: ["public_repo"],
  private: ["repo"],
} as const;

export type GitHubRepositoryAccess = keyof typeof GITHUB_SCOPES;

export const GITHUB_API = "https://api.github.com";

export function githubHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "UniOffice-Connect",
  };
}

export class GitHubOAuth implements OAuthProvider {
  readonly provider = "github" as const;

  constructor(
    private readonly client: OAuthClientConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  authorizationUrl(request: AuthorizationRequest): string {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.client.clientId);
    url.searchParams.set("redirect_uri", request.redirectUri);
    url.searchParams.set("scope", request.scopes.join(" "));
    url.searchParams.set("state", request.state);
    url.searchParams.set("code_challenge", request.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("allow_signup", "false");
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthGrant> {
    let body: { access_token?: unknown; scope?: unknown; error?: unknown };

    try {
      body = await providerJson(this.fetchImpl, "https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.client.clientId,
          client_secret: this.client.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
          code_verifier: input.codeVerifier,
        }),
      });
    } catch (error) {
      throw error instanceof ConnectorError && error.code === "provider_unavailable"
        ? error
        : new ConnectorError("oauth_exchange_failed");
    }

    // GitHub answers a bad code with a 200 and an error field.
    if (!body || typeof body.access_token !== "string" || body.access_token === "" || body.error) {
      throw new ConnectorError("oauth_exchange_failed");
    }

    const scopes = typeof body.scope === "string"
      ? body.scope.split(/[,\s]+/).filter(Boolean)
      : [];

    return { accessToken: body.access_token, scopes };
  }

  async revoke(credentials: ConnectionCredentials): Promise<void> {
    const basic = Buffer.from(`${this.client.clientId}:${this.client.clientSecret}`).toString("base64");

    try {
      await providerRequest(
        this.fetchImpl,
        `${GITHUB_API}/applications/${encodeURIComponent(this.client.clientId)}/token`,
        {
          method: "DELETE",
          headers: {
            ...githubHeaders(credentials.accessToken),
            authorization: `Basic ${basic}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ access_token: credentials.accessToken }),
        },
      );
    } catch (error) {
      // Already revoked or unknown to GitHub: the outcome wanted is reached.
      if (error instanceof ConnectorError && (error.code === "not_found" || error.code === "input_invalid")) {
        return;
      }

      throw error;
    }
  }

  async describeAccount(accessToken: string): Promise<string> {
    const user = await providerJson<{ login?: unknown }>(this.fetchImpl, `${GITHUB_API}/user`, {
      headers: githubHeaders(accessToken),
      maxBytes: 64 * 1024,
    });

    const login = cleanLabel(user?.login, 100);

    if (!login) {
      throw new ConnectorError("malformed_response");
    }

    return login;
  }
}
