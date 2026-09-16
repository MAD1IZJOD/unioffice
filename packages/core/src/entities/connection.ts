import type {
  ConnectionId,
  OrganizationId,
  UserId,
  WorkspaceId,
} from "../types/ids.js";

/**
 * An external system the organization has connected.
 *
 * A connection belongs to the organization, not to the person who made it and
 * not to any agent. It is the company saying "we have authorized this
 * account", which is necessary for an agent to reach the system but never
 * sufficient: the agent still has to hold the tool, the connection has to
 * allow what the tool does, and governance still decides each call.
 *
 * The credentials behind a connection are deliberately not on this shape.
 * They live encrypted beside the row and are only ever opened by the code
 * that is about to call the provider, so nothing that serializes a connection
 * can carry a token with it.
 */

export type ConnectionProvider = "github" | "google_drive";

export const CONNECTION_PROVIDERS: readonly ConnectionProvider[] = [
  "github",
  "google_drive",
];

/**
 * active          - usable, as far as anything here knows
 * needs_attention - the provider refused the credentials (expired, revoked
 *                   from the provider's side); someone has to reconnect
 * revoked         - disconnected here; the credentials are gone
 */
export type ConnectionStatus = "active" | "needs_attention" | "revoked";

/**
 * What the company lets agents do through a connection. Separate from the
 * OAuth scopes the provider granted: a scope is what the token could do, a
 * capability is what this organization has decided agents may use it for.
 */
export type ConnectionCapability =
  | "github.read"
  | "github.write"
  | "drive.read";

export const PROVIDER_CAPABILITIES: Readonly<
  Record<ConnectionProvider, readonly ConnectionCapability[]>
> = {
  github: ["github.read", "github.write"],
  google_drive: ["drive.read"],
};

/** What a new connection allows until an admin decides otherwise. Reads only. */
export const DEFAULT_CONNECTION_CAPABILITIES: Readonly<
  Record<ConnectionProvider, readonly ConnectionCapability[]>
> = {
  github: ["github.read"],
  google_drive: ["drive.read"],
};

export function isConnectionProvider(value: unknown): value is ConnectionProvider {
  return typeof value === "string" &&
    (CONNECTION_PROVIDERS as readonly string[]).includes(value);
}

export interface Connection {
  id: ConnectionId;

  organizationId: OrganizationId;

  /** Absent for a company-wide connection. */
  workspaceId?: WorkspaceId;

  provider: ConnectionProvider;

  status: ConnectionStatus;

  /** The provider account it acts as - a GitHub login, a Google address. */
  accountLabel?: string;

  /** Scopes the provider actually granted, as it reported them. */
  scopes: string[];

  capabilities: ConnectionCapability[];

  connectedBy?: UserId;

  lastUsedAt?: Date;

  /** A safe, enumerated reason, never provider response text. */
  lastErrorCode?: string;

  revokedAt?: Date;

  revokedBy?: UserId;

  createdAt: Date;

  updatedAt: Date;
}
