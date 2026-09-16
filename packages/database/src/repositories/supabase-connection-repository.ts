import type {
  Connection,
  ConnectionCapability,
  ConnectionId,
  ConnectionProvider,
  OrganizationId,
  UserId,
  WorkspaceId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ConnectionConflictError,
  type ConnectionRepository,
  type OAuthStateRecord,
} from "./connection-repository.js";

interface ConnectionRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  provider: ConnectionProvider;
  status: Connection["status"];
  account_label: string | null;
  scopes: string[] | null;
  capabilities: string[] | null;
  connected_by: string | null;
  last_used_at: string | null;
  last_error_code: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
  updated_at: string;
}

interface StateRow {
  organization_id: string;
  workspace_id: string | null;
  provider: ConnectionProvider;
  user_id: string;
  code_verifier: string;
  requested_scopes: string[] | null;
  expires_at: string;
  created_at: string;
}

// `credentials` is deliberately absent. Only readCredentials selects it, so no
// ordinary read of a connection can carry it anywhere.
const CONNECTION_COLUMNS =
  "id,organization_id,workspace_id,provider,status,account_label,scopes,capabilities,connected_by,last_used_at,last_error_code,revoked_at,revoked_by,created_at,updated_at";

const STATE_COLUMNS =
  "organization_id,workspace_id,provider,user_id,code_verifier,requested_scopes,expires_at,created_at";

export class SupabaseConnectionRepository implements ConnectionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(organizationId: OrganizationId): Promise<Connection[]> {
    const { data, error } = await this.client
      .from("connections")
      .select(CONNECTION_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(`Failed to list connections: ${error.message}`);
    return ((data ?? []) as ConnectionRow[]).map(toConnection);
  }

  async find(organizationId: OrganizationId, connectionId: ConnectionId): Promise<Connection | null> {
    const { data, error } = await this.client
      .from("connections")
      .select(CONNECTION_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", connectionId)
      .maybeSingle();

    if (error) throw new Error(`Failed to find connection: ${error.message}`);
    return data ? toConnection(data as ConnectionRow) : null;
  }

  async findLive(
    organizationId: OrganizationId,
    provider: ConnectionProvider,
    workspaceId?: WorkspaceId,
  ): Promise<Connection | null> {
    let query = this.client
      .from("connections")
      .select(CONNECTION_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("provider", provider)
      .neq("status", "revoked");

    query = workspaceId ? query.eq("workspace_id", workspaceId) : query.is("workspace_id", null);

    const { data, error } = await query.maybeSingle();

    if (error) throw new Error(`Failed to find connection: ${error.message}`);
    return data ? toConnection(data as ConnectionRow) : null;
  }

  async create(connection: Connection, sealedCredentials: string): Promise<Connection> {
    const { data, error } = await this.client
      .from("connections")
      .insert({
        id: connection.id,
        organization_id: connection.organizationId,
        workspace_id: connection.workspaceId ?? null,
        provider: connection.provider,
        status: connection.status,
        account_label: connection.accountLabel ?? null,
        scopes: connection.scopes,
        capabilities: connection.capabilities,
        credentials: sealedCredentials,
        connected_by: connection.connectedBy ?? null,
        last_used_at: connection.lastUsedAt?.toISOString() ?? null,
        last_error_code: connection.lastErrorCode ?? null,
        created_at: connection.createdAt.toISOString(),
        updated_at: connection.updatedAt.toISOString(),
      })
      .select(CONNECTION_COLUMNS)
      .single();

    if (error) {
      if (error.code === "23505") throw new ConnectionConflictError();
      throw new Error(`Failed to create connection: ${error.message}`);
    }

    return toConnection(data as ConnectionRow);
  }

  async update(connection: Connection): Promise<Connection> {
    // A revoked row is only ever produced by revoke(), which clears the
    // credentials in the same statement. Nothing here can revoke or revive.
    const { data, error } = await this.client
      .from("connections")
      .update({
        ...(connection.status === "revoked" ? {} : { status: connection.status }),
        account_label: connection.accountLabel ?? null,
        scopes: connection.scopes,
        capabilities: connection.capabilities,
        last_used_at: connection.lastUsedAt?.toISOString() ?? null,
        last_error_code: connection.lastErrorCode ?? null,
        updated_at: connection.updatedAt.toISOString(),
      })
      .eq("organization_id", connection.organizationId)
      .eq("id", connection.id)
      .select(CONNECTION_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to update connection: ${error.message}`);
    return toConnection(data as ConnectionRow);
  }

  async readCredentials(organizationId: OrganizationId, connectionId: ConnectionId): Promise<string | null> {
    const { data, error } = await this.client
      .from("connections")
      .select("credentials")
      .eq("organization_id", organizationId)
      .eq("id", connectionId)
      .neq("status", "revoked")
      .maybeSingle();

    // The database message is not repeated: nothing about this read should
    // end up in a log line beside the column it names.
    if (error) throw new Error("Failed to read connection credentials.");
    const sealed = (data as { credentials: string | null } | null)?.credentials;
    return typeof sealed === "string" ? sealed : null;
  }

  async replaceCredentials(
    organizationId: OrganizationId,
    connectionId: ConnectionId,
    sealedCredentials: string,
    at: Date,
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from("connections")
      .update({ credentials: sealedCredentials, updated_at: at.toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", connectionId)
      .neq("status", "revoked")
      .select("id");

    if (error) throw new Error("Failed to store connection credentials.");
    return (data ?? []).length > 0;
  }

  async revoke(
    organizationId: OrganizationId,
    connectionId: ConnectionId,
    revokedBy: UserId | undefined,
    at: Date,
  ): Promise<Connection | null> {
    const { data, error } = await this.client
      .from("connections")
      .update({
        status: "revoked",
        credentials: null,
        revoked_at: at.toISOString(),
        revoked_by: revokedBy ?? null,
        updated_at: at.toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("id", connectionId)
      .neq("status", "revoked")
      .select(CONNECTION_COLUMNS);

    if (error) throw new Error(`Failed to disconnect: ${error.message}`);
    const row = ((data ?? []) as ConnectionRow[])[0];
    return row ? toConnection(row) : null;
  }

  async markUsed(organizationId: OrganizationId, connectionId: ConnectionId, at: Date): Promise<void> {
    const { error } = await this.client
      .from("connections")
      .update({ last_used_at: at.toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", connectionId);

    if (error) throw new Error(`Failed to record connection use: ${error.message}`);
  }

  async saveOAuthState(stateHash: string, record: OAuthStateRecord): Promise<void> {
    const { error } = await this.client
      .from("connection_oauth_states")
      .insert({
        state_hash: stateHash,
        organization_id: record.organizationId,
        workspace_id: record.workspaceId ?? null,
        provider: record.provider,
        user_id: record.userId,
        code_verifier: record.codeVerifier,
        requested_scopes: record.requestedScopes,
        expires_at: record.expiresAt.toISOString(),
        created_at: record.createdAt.toISOString(),
      });

    if (error) throw new Error(`Failed to start authorization: ${error.message}`);
  }

  async consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null> {
    // Delete-returning is the single-use guarantee: of two callbacks racing
    // with the same state, exactly one gets the row back.
    const { data, error } = await this.client
      .from("connection_oauth_states")
      .delete()
      .eq("state_hash", stateHash)
      .select(STATE_COLUMNS);

    if (error) throw new Error("Failed to read authorization state.");
    const row = ((data ?? []) as StateRow[])[0];

    return row
      ? {
          organizationId: row.organization_id as OrganizationId,
          workspaceId: (row.workspace_id ?? undefined) as WorkspaceId | undefined,
          provider: row.provider,
          userId: row.user_id as UserId,
          codeVerifier: row.code_verifier,
          requestedScopes: row.requested_scopes ?? [],
          expiresAt: new Date(row.expires_at),
          createdAt: new Date(row.created_at),
        }
      : null;
  }

  async deleteExpiredOAuthStates(before: Date): Promise<void> {
    const { error } = await this.client
      .from("connection_oauth_states")
      .delete()
      .lte("expires_at", before.toISOString());

    if (error) throw new Error(`Failed to clear expired authorization states: ${error.message}`);
  }
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id as ConnectionId,
    organizationId: row.organization_id as OrganizationId,
    workspaceId: (row.workspace_id ?? undefined) as WorkspaceId | undefined,
    provider: row.provider,
    status: row.status,
    accountLabel: row.account_label ?? undefined,
    scopes: row.scopes ?? [],
    capabilities: (row.capabilities ?? []) as ConnectionCapability[],
    connectedBy: (row.connected_by ?? undefined) as UserId | undefined,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : undefined,
    revokedBy: (row.revoked_by ?? undefined) as UserId | undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
