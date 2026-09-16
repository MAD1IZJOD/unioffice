import {
  createEntityId,
  DEFAULT_CONNECTION_CAPABILITIES,
  isConnectionProvider,
  PROVIDER_CAPABILITIES,
  type Connection,
  type ConnectionCapability,
  type ConnectionId,
  type ConnectionProvider,
  type OrganizationMember,
  type UserId,
  type Workspace,
  type WorkspaceId,
} from "@unioffice/core";

import {
  ConnectionConflictError,
  type ConnectionRepository,
  type MembershipRepository,
  type OAuthStateRecord,
} from "@unioffice/database";

import {
  ConnectorError,
  connectorMessage,
  createOAuthState,
  createPkcePair,
  hashOAuthState,
  parseCredentials,
  serializeCredentials,
  type ConnectorErrorCode,
  type OAuthGrant,
} from "@unioffice/connect";

import type { ToolRegistry } from "@unioffice/tools";

import { authorize } from "../access/authorize.js";
import { reaches, roleCan, type Access } from "../access/permissions.js";
import type { EventRecorder } from "../event-recorder.js";

import {
  PROVIDER_INFO,
  scopesAllow,
  type ConnectionProviders,
} from "./connection-providers.js";

export class ConnectionNotFoundError extends Error {
  constructor() {
    super("Connection not found.");
    this.name = "ConnectionNotFoundError";
  }
}

export class ConnectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionValidationError";
  }
}

export class ConnectionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionStateError";
  }
}

/**
 * A connection as people see it.
 *
 * Built field by field from the row, never spread from it, so a column added
 * later cannot reach the browser by accident. There is no credential, scope
 * secret or provider response here - only what a person needs to recognise
 * the connection and decide what to do with it.
 */
export interface ConnectionView {
  id: ConnectionId;
  provider: ConnectionProvider;
  providerName: string;
  status: Connection["status"];
  workspace: { id: WorkspaceId; name: string } | null;
  account: string | null;
  scopes: string[];
  capabilities: ConnectionCapability[];
  availableCapabilities: Array<{
    capability: ConnectionCapability;
    label: string;
    access: "read" | "write";
    enabled: boolean;
    /** Whether the scopes the provider granted can carry it at all. */
    grantable: boolean;
  }>;
  connectedBy: string | null;
  connectedAt: string;
  lastUsedAt: string | null;
  problem: string | null;
  revokedAt: string | null;
  tools: Array<{ id: string; name: string; access: "read" | "write" }>;
}

export interface ProviderView {
  provider: ConnectionProvider;
  name: string;
  description: string;
  configured: boolean;
}

const STATE_TTL_MS = 10 * 60_000;

/** Codes a person may see on the connections page after a round trip. */
const CALLBACK_CODES: readonly ConnectorErrorCode[] = [
  "not_configured",
  "oauth_denied",
  "oauth_state_invalid",
  "oauth_exchange_failed",
  "scope_not_granted",
  "provider_unavailable",
  "rate_limited",
];

export interface ConnectionServiceOptions {
  connections: ConnectionRepository;
  members: Pick<MembershipRepository, "findMemberByUser" | "listMembers">;
  workspaces: {
    findById(id: WorkspaceId): Promise<Workspace | null>;
    findByOrganization(organizationId: Access["organizationId"]): Promise<Workspace[]>;
  };
  providers: ConnectionProviders;
  toolRegistry: Pick<ToolRegistry, "list">;
  eventRecorder: Pick<EventRecorder, "record">;
  publicApiUrl: string;
  webUrl: string;
  now?: () => Date;
}

/**
 * Connecting, inspecting and disconnecting external systems.
 *
 * Who may act is decided before anything here runs and again inside it:
 * reading needs only membership and reach, and every change needs
 * connections.manage in the scope being changed. The OAuth callback arrives
 * without a session, so it proves who it belongs to another way - a single-use
 * state tied to the person who started it, whose membership is read again
 * before anything is stored.
 */
export class ConnectionService {
  private readonly now: () => Date;

  constructor(private readonly options: ConnectionServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async overview(access: Access): Promise<{ providers: ProviderView[]; connections: ConnectionView[] }> {
    const connections = (await this.options.connections.list(access.organizationId))
      .filter((connection) => reaches(access, connection.workspaceId));

    return {
      providers: (Object.keys(PROVIDER_INFO) as ConnectionProvider[]).map((provider) => ({
        provider,
        name: PROVIDER_INFO[provider].name,
        description: PROVIDER_INFO[provider].description,
        configured: this.options.providers.configured(provider),
      })),
      connections: await this.views(access, connections),
    };
  }

  async get(access: Access, connectionId: ConnectionId): Promise<ConnectionView> {
    const connection = await this.visible(access, connectionId);
    const [view] = await this.views(access, [connection]);
    return view!;
  }

  async startAuthorization(
    access: Access,
    input: { provider: unknown; workspaceId: unknown; repositoryAccess: unknown },
  ): Promise<{ authorizationUrl: string }> {
    if (!isConnectionProvider(input.provider)) {
      throw new ConnectionValidationError("Unknown provider.");
    }

    const provider = input.provider;
    const workspaceId = await this.workspaceFor(access, input.workspaceId);
    authorize(access, "connections.manage", workspaceId);

    const oauth = this.options.providers.get(provider);
    const cipher = this.options.providers.cipher;

    if (!oauth || !cipher) {
      throw new ConnectionStateError(connectorMessage("not_configured"));
    }

    let repositoryAccess: "public" | "private" = "public";

    if (input.repositoryAccess !== undefined && input.repositoryAccess !== null) {
      if (provider !== "github" || (input.repositoryAccess !== "public" && input.repositoryAccess !== "private")) {
        throw new ConnectionValidationError("repositoryAccess must be public or private, and only for GitHub.");
      }

      repositoryAccess = input.repositoryAccess;
    }

    const now = this.now();
    await this.options.connections.deleteExpiredOAuthStates(now);

    const state = createOAuthState();
    const stateHash = hashOAuthState(state);
    const pkce = createPkcePair();
    const scopes = this.options.providers.scopesFor(provider, repositoryAccess);

    await this.options.connections.saveOAuthState(stateHash, {
      organizationId: access.organizationId,
      workspaceId,
      provider,
      userId: access.userId,
      codeVerifier: cipher.seal(pkce.verifier, `oauth-state:${stateHash}`),
      requestedScopes: scopes,
      expiresAt: new Date(now.getTime() + STATE_TTL_MS),
      createdAt: now,
    });

    return {
      authorizationUrl: oauth.authorizationUrl({
        state,
        codeChallenge: pkce.challenge,
        redirectUri: this.redirectUri(provider),
        scopes,
      }),
    };
  }

  /**
   * Finishes a round trip and says where to send the browser.
   *
   * Never throws: whatever happened, the person lands back on the connections
   * page with at most a fixed error code in the address - never a provider
   * message, and never anything that came in on the callback.
   */
  async completeAuthorization(
    providerParam: string,
    query: { code?: unknown; state?: unknown; error?: unknown },
  ): Promise<string> {
    try {
      const connection = await this.complete(providerParam, query);
      return `${this.options.webUrl}/settings/connections/${connection.id}?connected=1`;
    } catch (error) {
      const code = error instanceof ConnectorError && CALLBACK_CODES.includes(error.code)
        ? error.code
        : "oauth_exchange_failed";

      return `${this.options.webUrl}/settings/connections?error=${code}`;
    }
  }

  async setCapabilities(access: Access, connectionId: ConnectionId, input: unknown): Promise<ConnectionView> {
    const connection = await this.visible(access, connectionId);
    authorize(access, "connections.manage", connection.workspaceId);

    if (connection.status === "revoked") {
      throw new ConnectionStateError("A disconnected connection cannot be changed. Connect again instead.");
    }

    if (!Array.isArray(input) || input.length > 10 || input.some((entry) => typeof entry !== "string")) {
      throw new ConnectionValidationError("capabilities must be a list of capability names.");
    }

    const allowed = PROVIDER_CAPABILITIES[connection.provider];
    const capabilities = [...new Set(input as string[])];

    for (const capability of capabilities) {
      if (!(allowed as readonly string[]).includes(capability)) {
        throw new ConnectionValidationError(`${capability} is not a ${PROVIDER_INFO[connection.provider].name} capability.`);
      }

      if (!scopesAllow(connection.provider, connection.scopes, capability as ConnectionCapability)) {
        throw new ConnectionValidationError(`The access granted by ${PROVIDER_INFO[connection.provider].name} cannot carry ${capability}.`);
      }
    }

    const updated = await this.options.connections.update({
      ...connection,
      capabilities: capabilities as ConnectionCapability[],
      updatedAt: this.now(),
    });

    await this.audit(access.userId, updated, "connection.updated", {
      capabilities: updated.capabilities,
      previousCapabilities: connection.capabilities,
    });

    return this.get(access, connectionId);
  }

  async disconnect(access: Access, connectionId: ConnectionId): Promise<{ connection: ConnectionView; providerRevoked: boolean }> {
    const connection = await this.visible(access, connectionId);
    authorize(access, "connections.manage", connection.workspaceId);

    if (connection.status === "revoked") {
      throw new ConnectionStateError("This connection is already disconnected.");
    }

    const providerRevoked = await this.revokeAtProvider(connection);

    const revoked = await this.options.connections.revoke(
      access.organizationId,
      connection.id,
      access.userId,
      this.now(),
    );

    if (!revoked) {
      throw new ConnectionStateError("This connection is already disconnected.");
    }

    await this.audit(access.userId, revoked, "connection.disconnected", { providerRevoked });

    return { connection: await this.get(access, connectionId), providerRevoked };
  }

  private async complete(
    providerParam: string,
    query: { code?: unknown; state?: unknown; error?: unknown },
  ): Promise<Connection> {
    const state = typeof query.state === "string" && query.state.length >= 20 && query.state.length <= 200
      ? query.state
      : null;

    if (!state || !isConnectionProvider(providerParam)) {
      throw new ConnectorError("oauth_state_invalid");
    }

    const stateHash = hashOAuthState(state);
    // Consumed before anything else is looked at, so a state that fails any
    // later check still cannot be tried again.
    const record = await this.options.connections.consumeOAuthState(stateHash);

    if (!record || record.provider !== providerParam || record.expiresAt.getTime() <= this.now().getTime()) {
      throw new ConnectorError("oauth_state_invalid");
    }

    if (query.error !== undefined) {
      throw new ConnectorError("oauth_denied");
    }

    const code = typeof query.code === "string" && query.code.length > 0 && query.code.length <= 1024
      ? query.code
      : null;

    if (!code) {
      throw new ConnectorError("oauth_exchange_failed");
    }

    await this.confirmStillAllowed(record);

    const oauth = this.options.providers.get(record.provider);
    const cipher = this.options.providers.cipher;

    if (!oauth || !cipher) {
      throw new ConnectorError("not_configured");
    }

    let codeVerifier: string;

    try {
      codeVerifier = cipher.open(record.codeVerifier, `oauth-state:${stateHash}`);
    } catch {
      throw new ConnectorError("oauth_state_invalid");
    }

    const grant = await oauth.exchangeCode({
      code,
      codeVerifier,
      redirectUri: this.redirectUri(record.provider),
    });

    try {
      if (!record.requestedScopes.every((scope) => grantCovers(grant, scope))) {
        throw new ConnectorError("scope_not_granted");
      }

      const account = await oauth.describeAccount(grant.accessToken);
      return await this.store(record, grant, account);
    } catch (error) {
      // Nothing was kept, so the token that was just issued must not outlive
      // this request at the provider either.
      await oauth.revoke(grant).catch(() => undefined);
      throw error;
    }
  }

  private async store(record: OAuthStateRecord, grant: OAuthGrant, account: string): Promise<Connection> {
    const cipher = this.options.providers.cipher!;
    const now = this.now();
    const credentials = { accessToken: grant.accessToken, refreshToken: grant.refreshToken, expiresAt: grant.expiresAt };
    const existing = await this.options.connections.findLive(record.organizationId, record.provider, record.workspaceId);

    if (existing) {
      const previous = await this.openCredentials(existing);

      await this.options.connections.replaceCredentials(
        existing.organizationId,
        existing.id,
        cipher.seal(serializeCredentials(credentials), `connection:${existing.id}`),
        now,
      );

      const updated = await this.options.connections.update({
        ...existing,
        status: "active",
        accountLabel: account,
        scopes: grant.scopes,
        // A narrower grant than before takes away what it can no longer carry.
        capabilities: existing.capabilities.filter((capability) => scopesAllow(existing.provider, grant.scopes, capability)),
        lastErrorCode: undefined,
        updatedAt: now,
      });

      // GitHub revokes one token at a time, so the replaced one is ended. A
      // Google revoke ends the whole grant - including the one just issued -
      // so there the old token is left to lapse.
      if (previous && existing.provider === "github" && previous.accessToken !== grant.accessToken) {
        await this.options.providers.get("github")?.revoke(previous).catch(() => undefined);
      }

      await this.audit(record.userId, updated, "connection.connected", { reconnected: true });
      return updated;
    }

    const id = createEntityId<"ConnectionId">() as ConnectionId;
    let created: Connection;

    try {
      created = await this.options.connections.create({
        id,
        organizationId: record.organizationId,
        workspaceId: record.workspaceId,
        provider: record.provider,
        status: "active",
        accountLabel: account,
        scopes: grant.scopes,
        capabilities: DEFAULT_CONNECTION_CAPABILITIES[record.provider]
          .filter((capability) => scopesAllow(record.provider, grant.scopes, capability)),
        connectedBy: record.userId,
        createdAt: now,
        updatedAt: now,
      }, cipher.seal(serializeCredentials(credentials), `connection:${id}`));
    } catch (error) {
      if (error instanceof ConnectionConflictError) {
        // Two round trips for the same scope finished together; this one lost.
        throw new ConnectorError("oauth_exchange_failed");
      }

      throw error;
    }

    await this.audit(record.userId, created, "connection.connected", { reconnected: false });
    return created;
  }

  /** The person who started the round trip may still connect here, now. */
  private async confirmStillAllowed(record: OAuthStateRecord): Promise<void> {
    const member = await this.options.members.findMemberByUser(record.organizationId, record.userId);

    if (!member || member.status !== "active" || !roleCan(member.role, "connections.manage")) {
      throw new ConnectorError("oauth_state_invalid");
    }

    if (record.workspaceId) {
      const workspace = await this.options.workspaces.findById(record.workspaceId);

      if (!workspace || workspace.organizationId !== record.organizationId || workspace.status !== "active") {
        throw new ConnectorError("oauth_state_invalid");
      }
    }
  }

  private async revokeAtProvider(connection: Connection): Promise<boolean> {
    const oauth = this.options.providers.get(connection.provider);
    const credentials = await this.openCredentials(connection);

    if (!oauth || !credentials) {
      return false;
    }

    try {
      await oauth.revoke(credentials);
      return true;
    } catch {
      // The local credentials are erased regardless. The person is told the
      // provider could not confirm, and can revoke there themselves.
      return false;
    }
  }

  private async openCredentials(connection: Connection) {
    const cipher = this.options.providers.cipher;
    const sealed = await this.options.connections.readCredentials(connection.organizationId, connection.id);

    if (!cipher || !sealed) {
      return null;
    }

    try {
      return parseCredentials(cipher.open(sealed, `connection:${connection.id}`));
    } catch {
      return null;
    }
  }

  private async visible(access: Access, connectionId: ConnectionId): Promise<Connection> {
    const connection = await this.options.connections.find(access.organizationId, connectionId);

    if (!connection || !reaches(access, connection.workspaceId)) {
      throw new ConnectionNotFoundError();
    }

    return connection;
  }

  private async workspaceFor(access: Access, value: unknown): Promise<WorkspaceId | undefined> {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new ConnectionValidationError("workspaceId must be a workspace id.");
    }

    const workspace = await this.options.workspaces.findById(value as WorkspaceId);

    if (!workspace || workspace.organizationId !== access.organizationId || !reaches(access, workspace.id)) {
      throw new ConnectionNotFoundError();
    }

    if (workspace.status !== "active") {
      throw new ConnectionStateError("That workspace is archived.");
    }

    return workspace.id;
  }

  private async views(access: Access, connections: Connection[]): Promise<ConnectionView[]> {
    if (connections.length === 0) {
      return [];
    }

    const [members, workspaces] = await Promise.all([
      this.options.members.listMembers(access.organizationId),
      this.options.workspaces.findByOrganization(access.organizationId),
    ]);

    const emailOf = new Map<string, string>(
      members
        .filter((member): member is OrganizationMember & { userId: UserId } => member.userId !== undefined)
        .map((member) => [member.userId, member.email]),
    );
    const workspaceOf = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    const tools = this.options.toolRegistry.list();

    return connections.map((connection) => {
      const workspace = connection.workspaceId ? workspaceOf.get(connection.workspaceId) : undefined;

      return {
        id: connection.id,
        provider: connection.provider,
        providerName: PROVIDER_INFO[connection.provider].name,
        status: connection.status,
        workspace: connection.workspaceId
          ? { id: connection.workspaceId, name: workspace?.name ?? "Workspace" }
          : null,
        account: connection.accountLabel ?? null,
        scopes: [...connection.scopes],
        capabilities: [...connection.capabilities],
        availableCapabilities: PROVIDER_INFO[connection.provider].capabilities.map((entry) => ({
          capability: entry.capability,
          label: entry.label,
          access: entry.access,
          enabled: connection.capabilities.includes(entry.capability),
          grantable: scopesAllow(connection.provider, connection.scopes, entry.capability),
        })),
        connectedBy: connection.connectedBy ? (emailOf.get(connection.connectedBy) ?? "A former member") : null,
        connectedAt: connection.createdAt.toISOString(),
        lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
        problem: connection.status === "needs_attention"
          ? connectorMessage(isErrorCode(connection.lastErrorCode) ? connection.lastErrorCode : "token_revoked")
          : null,
        revokedAt: connection.revokedAt?.toISOString() ?? null,
        tools: tools
          .filter((tool) => tool.external?.provider === connection.provider)
          .map((tool) => ({ id: tool.id, name: tool.name, access: tool.external!.access })),
      };
    });
  }

  private redirectUri(provider: ConnectionProvider): string {
    return `${this.options.publicApiUrl}/connections/oauth/${provider}/callback`;
  }

  private async audit(
    userId: UserId,
    connection: Connection,
    type: "connection.connected" | "connection.updated" | "connection.disconnected",
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.options.eventRecorder.record({
      organizationId: connection.organizationId,
      type,
      actorType: "user",
      actorId: `user:${userId}`,
      payload: {
        connectionId: connection.id,
        provider: connection.provider,
        workspaceId: connection.workspaceId ?? null,
        account: connection.accountLabel ?? null,
        ...extra,
      },
    });
  }
}

function grantCovers(grant: OAuthGrant, scope: string): boolean {
  // GitHub's repo scope includes public_repo.
  return grant.scopes.includes(scope) || (scope === "public_repo" && grant.scopes.includes("repo"));
}

function isErrorCode(value: string | undefined): value is ConnectorErrorCode {
  return value === "token_expired" || value === "token_revoked" || value === "permission_denied";
}
