import type {
  Connection,
  ConnectionId,
  ConnectionProvider,
  OrganizationId,
  UserId,
  WorkspaceId,
} from "@unioffice/core";

import {
  ConnectionConflictError,
  type ConnectionRepository,
  type OAuthStateRecord,
} from "./connection-repository.js";

/**
 * Connections without a database, holding the same lines the migration does:
 * one live connection per provider per scope, credentials present exactly
 * while a connection is not revoked, and a state consumed at most once.
 */
export class InMemoryConnectionRepository implements ConnectionRepository {
  readonly connections = new Map<ConnectionId, Connection>();
  readonly credentials = new Map<ConnectionId, string>();
  readonly states = new Map<string, OAuthStateRecord>();

  async list(organizationId: OrganizationId): Promise<Connection[]> {
    return [...this.connections.values()]
      .filter((entry) => entry.organizationId === organizationId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((entry) => structuredClone(entry));
  }

  async find(organizationId: OrganizationId, connectionId: ConnectionId): Promise<Connection | null> {
    const connection = this.connections.get(connectionId);
    return connection && connection.organizationId === organizationId ? structuredClone(connection) : null;
  }

  async findLive(
    organizationId: OrganizationId,
    provider: ConnectionProvider,
    workspaceId?: WorkspaceId,
  ): Promise<Connection | null> {
    const live = [...this.connections.values()].find((entry) =>
      entry.organizationId === organizationId &&
      entry.provider === provider &&
      entry.workspaceId === workspaceId &&
      entry.status !== "revoked");

    return live ? structuredClone(live) : null;
  }

  async create(connection: Connection, sealedCredentials: string): Promise<Connection> {
    if (await this.findLive(connection.organizationId, connection.provider, connection.workspaceId)) {
      throw new ConnectionConflictError();
    }

    this.connections.set(connection.id, structuredClone(connection));
    this.credentials.set(connection.id, sealedCredentials);
    return structuredClone(connection);
  }

  async update(connection: Connection): Promise<Connection> {
    const current = this.connections.get(connection.id);

    if (!current || current.organizationId !== connection.organizationId) {
      throw new Error(`Connection not found: ${connection.id}`);
    }

    const next: Connection = {
      ...current,
      status: connection.status === "revoked" || current.status === "revoked"
        ? current.status
        : connection.status,
      accountLabel: connection.accountLabel,
      scopes: [...connection.scopes],
      capabilities: [...connection.capabilities],
      lastUsedAt: connection.lastUsedAt,
      lastErrorCode: connection.lastErrorCode,
      updatedAt: connection.updatedAt,
    };

    this.connections.set(connection.id, next);
    return structuredClone(next);
  }

  async readCredentials(organizationId: OrganizationId, connectionId: ConnectionId): Promise<string | null> {
    const connection = this.connections.get(connectionId);

    if (!connection || connection.organizationId !== organizationId || connection.status === "revoked") {
      return null;
    }

    return this.credentials.get(connectionId) ?? null;
  }

  async replaceCredentials(
    organizationId: OrganizationId,
    connectionId: ConnectionId,
    sealedCredentials: string,
    at: Date,
  ): Promise<boolean> {
    const connection = this.connections.get(connectionId);

    if (!connection || connection.organizationId !== organizationId || connection.status === "revoked") {
      return false;
    }

    this.credentials.set(connectionId, sealedCredentials);
    this.connections.set(connectionId, { ...connection, updatedAt: at });
    return true;
  }

  async revoke(
    organizationId: OrganizationId,
    connectionId: ConnectionId,
    revokedBy: UserId | undefined,
    at: Date,
  ): Promise<Connection | null> {
    const connection = this.connections.get(connectionId);

    if (!connection || connection.organizationId !== organizationId || connection.status === "revoked") {
      return null;
    }

    const revoked: Connection = {
      ...connection,
      status: "revoked",
      revokedAt: at,
      revokedBy,
      updatedAt: at,
    };

    this.connections.set(connectionId, revoked);
    this.credentials.delete(connectionId);
    return structuredClone(revoked);
  }

  async markUsed(organizationId: OrganizationId, connectionId: ConnectionId, at: Date): Promise<void> {
    const connection = this.connections.get(connectionId);

    if (connection && connection.organizationId === organizationId) {
      this.connections.set(connectionId, { ...connection, lastUsedAt: at });
    }
  }

  async saveOAuthState(stateHash: string, record: OAuthStateRecord): Promise<void> {
    this.states.set(stateHash, structuredClone(record));
  }

  async consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null> {
    const record = this.states.get(stateHash);
    this.states.delete(stateHash);
    return record ? structuredClone(record) : null;
  }

  async deleteExpiredOAuthStates(before: Date): Promise<void> {
    for (const [hash, record] of this.states) {
      if (record.expiresAt.getTime() <= before.getTime()) {
        this.states.delete(hash);
      }
    }
  }
}
