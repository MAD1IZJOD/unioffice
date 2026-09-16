import type {
  Connection,
  ConnectionId,
  ConnectionProvider,
  OrganizationId,
  UserId,
  WorkspaceId,
} from "@unioffice/core";

/**
 * Connections and the OAuth round trips that create them.
 *
 * Credentials never travel on a Connection. They go in and come out of this
 * repository only as the sealed envelope the API produced, through methods
 * whose names say so, and only the code about to call a provider asks for
 * them. Every lookup is inside one organization: a connection id from another
 * organization reads as absent.
 */

/** Raised when a live connection already exists for that provider and scope. */
export class ConnectionConflictError extends Error {
  constructor() {
    super("This organization already has a live connection for that provider here.");
    this.name = "ConnectionConflictError";
  }
}

export interface OAuthStateRecord {
  organizationId: OrganizationId;

  workspaceId?: WorkspaceId;

  provider: ConnectionProvider;

  /** The signed-in person who started the flow. Only they may finish it. */
  userId: UserId;

  /** Sealed, like credentials. */
  codeVerifier: string;

  requestedScopes: string[];

  expiresAt: Date;

  createdAt: Date;
}

export interface ConnectionRepository {
  /** Newest first, disconnected ones included - they are the history. */
  list(organizationId: OrganizationId): Promise<Connection[]>;

  find(organizationId: OrganizationId, connectionId: ConnectionId): Promise<Connection | null>;

  /**
   * The live connection for a provider in exactly this scope: company-wide
   * when workspaceId is absent, that workspace's own otherwise.
   */
  findLive(
    organizationId: OrganizationId,
    provider: ConnectionProvider,
    workspaceId?: WorkspaceId,
  ): Promise<Connection | null>;

  /** Throws ConnectionConflictError when that scope already has a live one. */
  create(connection: Connection, sealedCredentials: string): Promise<Connection>;

  /**
   * Writes status, capabilities, account, scopes, usage and error fields.
   * Never credentials, never the organization, provider or scope, and never
   * revokes - only revoke() does that.
   */
  update(connection: Connection): Promise<Connection>;

  /** The sealed envelope for a connection that is not revoked. */
  readCredentials(organizationId: OrganizationId, connectionId: ConnectionId): Promise<string | null>;

  /** Replaces the envelope on a connection that is not revoked. */
  replaceCredentials(
    organizationId: OrganizationId,
    connectionId: ConnectionId,
    sealedCredentials: string,
    at: Date,
  ): Promise<boolean>;

  /**
   * Marks it revoked and erases the envelope in the same write. Null when it
   * does not exist here or was already revoked.
   */
  revoke(
    organizationId: OrganizationId,
    connectionId: ConnectionId,
    revokedBy: UserId | undefined,
    at: Date,
  ): Promise<Connection | null>;

  /** Records use. Callers skip it when the last record is recent. */
  markUsed(organizationId: OrganizationId, connectionId: ConnectionId, at: Date): Promise<void>;

  saveOAuthState(stateHash: string, record: OAuthStateRecord): Promise<void>;

  /**
   * Removes and returns the state in one step, so a state completes at most
   * one round trip however many times the callback is hit. Expired states are
   * returned too; deciding what expiry means is the caller's job.
   */
  consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null>;

  deleteExpiredOAuthStates(before: Date): Promise<void>;
}
