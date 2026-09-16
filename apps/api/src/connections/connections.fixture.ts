import { randomBytes } from "node:crypto";

import type {
  ConnectionProvider,
  MemberId,
  OrganizationId,
  OrganizationMember,
  OrganizationRole,
  UserId,
  Workspace,
  WorkspaceAccessLevel,
  WorkspaceId,
} from "@unioffice/core";

import {
  InMemoryConnectionRepository,
  InMemoryMembershipRepository,
} from "@unioffice/database";

import {
  ConnectorError,
  TokenCipher,
  type AuthorizationRequest,
  type ConnectionCredentials,
  type OAuthGrant,
  type OAuthProvider,
} from "@unioffice/connect";

import { DefaultToolRegistry } from "@unioffice/tools";

import type { Access } from "../access/permissions.js";
import type { RecordEventInput } from "../event-recorder.js";

import { ConnectionProviders } from "./connection-providers.js";
import { ConnectionService } from "./connection-service.js";

export const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
export const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
export const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
export const legal = "f0000000-0000-4000-8000-0000000000aa" as WorkspaceId;
export const theirWorkspace = "f0000000-0000-4000-8000-0000000000bb" as WorkspaceId;

/** Real-looking secrets, so a test can prove none of them escapes. */
export const SECRETS = {
  clientSecret: "client-secret-DO-NOT-LEAK",
  accessToken: "gho_ACCESS_TOKEN_DO_NOT_LEAK",
  refreshToken: "1//REFRESH_TOKEN_DO_NOT_LEAK",
  code: "AUTH_CODE_DO_NOT_LEAK",
};

export class FakeOAuth implements OAuthProvider {
  exchanges = 0;
  revoked: ConnectionCredentials[] = [];
  refreshes = 0;
  grantScopes: string[];
  failRevoke = false;
  failRefresh: ConnectorError | null = null;
  tokenCounter = 0;
  refresh?: OAuthProvider["refresh"];

  constructor(readonly provider: ConnectionProvider, options: { refreshable?: boolean; scopes?: string[] } = {}) {
    this.grantScopes = options.scopes ?? (provider === "github" ? ["public_repo"] : ["https://www.googleapis.com/auth/drive.readonly"]);

    if (options.refreshable) {
      this.refresh = async (credentials) => {
        this.refreshes += 1;
        if (this.failRefresh) throw this.failRefresh;
        return { ...credentials, accessToken: `${SECRETS.accessToken}-refreshed-${this.refreshes}`, expiresAt: Date.now() + 3_600_000 };
      };
    }
  }

  authorizationUrl(request: AuthorizationRequest): string {
    const url = new URL(`https://provider.test/${this.provider}/authorize`);
    url.searchParams.set("state", request.state);
    url.searchParams.set("code_challenge", request.codeChallenge);
    url.searchParams.set("scope", request.scopes.join(" "));
    url.searchParams.set("redirect_uri", request.redirectUri);
    return url.toString();
  }

  async exchangeCode(input: { code: string }): Promise<OAuthGrant> {
    this.exchanges += 1;

    if (input.code !== SECRETS.code) {
      throw new ConnectorError("oauth_exchange_failed");
    }

    this.tokenCounter += 1;
    return {
      accessToken: `${SECRETS.accessToken}-${this.tokenCounter}`,
      refreshToken: this.refresh ? SECRETS.refreshToken : undefined,
      expiresAt: this.refresh ? Date.now() + 3_600_000 : undefined,
      scopes: this.grantScopes,
    };
  }

  async revoke(credentials: ConnectionCredentials): Promise<void> {
    if (this.failRevoke) throw new ConnectorError("provider_unavailable");
    this.revoked.push(credentials);
  }

  async describeAccount(): Promise<string> {
    return this.provider === "github" ? "octo-dev" : "person@company.test";
  }
}

let counter = 0;

export async function connectionsSetup(options: { configured?: boolean } = {}) {
  const connections = new InMemoryConnectionRepository();
  const members = new InMemoryMembershipRepository();
  const events: RecordEventInput[] = [];
  const now = { value: new Date("2026-09-16T12:00:00.000Z") };
  const github = new FakeOAuth("github");
  const drive = new FakeOAuth("google_drive", { refreshable: true });
  const cipher = new TokenCipher(randomBytes(32).toString("base64"));
  const configured = options.configured ?? true;

  const providers = new ConnectionProviders(
    configured
      ? new Map<ConnectionProvider, OAuthProvider>([["github", github], ["google_drive", drive]])
      : new Map(),
    configured ? cipher : undefined,
  );

  const workspaces = new Map<WorkspaceId, Workspace>([
    [finance, { id: finance, organizationId: orgA, name: "Finance", status: "active" } as Workspace],
    [legal, { id: legal, organizationId: orgA, name: "Legal", status: "active" } as Workspace],
    [theirWorkspace, { id: theirWorkspace, organizationId: orgB, name: "Theirs", status: "active" } as Workspace],
  ]);

  const recorder = {
    async record(event: RecordEventInput) {
      events.push(structuredClone(event));
      return event as never;
    },
  };

  const service = new ConnectionService({
    connections,
    members,
    workspaces: {
      findById: async (id) => workspaces.get(id) ?? null,
      findByOrganization: async (organizationId) => [...workspaces.values()].filter((entry) => entry.organizationId === organizationId),
    },
    providers,
    toolRegistry: new DefaultToolRegistry(),
    eventRecorder: recorder,
    publicApiUrl: "http://localhost:4000",
    webUrl: "http://localhost:5173",
    now: () => now.value,
  });

  async function person(
    role: OrganizationRole,
    organizationId: OrganizationId = orgA,
    grants: Array<[WorkspaceId, WorkspaceAccessLevel]> = [],
  ): Promise<Access> {
    counter += 1;
    const suffix = String(counter).padStart(12, "0");
    const member: OrganizationMember = await members.createMember({
      id: `00000000-0000-4000-8000-${suffix}` as MemberId,
      organizationId,
      userId: `11111111-0000-4000-8000-${suffix}` as UserId,
      email: `person${counter}@example.test`,
      role,
      status: "active",
      createdAt: now.value,
      updatedAt: now.value,
    });

    return {
      userId: member.userId!,
      email: member.email,
      organizationId,
      memberId: member.id,
      role,
      workspaces: new Map(grants),
    };
  }

  /** Runs a real round trip through the service and returns the redirect. */
  async function connect(
    access: Access,
    provider: ConnectionProvider,
    extra: { workspaceId?: WorkspaceId; repositoryAccess?: string; code?: string } = {},
  ): Promise<string> {
    const { authorizationUrl } = await service.startAuthorization(access, {
      provider,
      workspaceId: extra.workspaceId,
      repositoryAccess: extra.repositoryAccess,
    });

    const state = new URL(authorizationUrl).searchParams.get("state")!;
    return service.completeAuthorization(provider, { code: extra.code ?? SECRETS.code, state });
  }

  return { service, connections, members, events, now, github, drive, cipher, providers, recorder, person, connect };
}

export function connectionIdFrom(redirect: string): string {
  const match = /\/settings\/connections\/([0-9a-f-]{36})\?connected=1$/.exec(redirect);
  if (!match) throw new Error(`Not a successful redirect: ${redirect}`);
  return match[1]!;
}
