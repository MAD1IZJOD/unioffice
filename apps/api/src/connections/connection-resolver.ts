import type {
  AgentId,
  Connection,
  OrganizationId,
  TaskId,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

import type { ConnectionRepository } from "@unioffice/database";

import {
  ConnectionRateLimiter,
  ConnectorError,
  isCredentialFailure,
  parseCredentials,
  serializeCredentials,
  type ConnectionAccess,
  type ConnectionCredentials,
  type ConnectionNeed,
  type ConnectionSession,
} from "@unioffice/connect";

import type { ToolExecutionContext } from "@unioffice/tools";

import type { EventRecorder } from "../event-recorder.js";

import type { ConnectionProviders } from "./connection-providers.js";

/** Refresh a little before expiry, so a token does not lapse mid-request. */
const REFRESH_MARGIN_MS = 60_000;

/** Last-used is a coarse fact; writing it on every call would be a write per read. */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Connections, at the moment a tool needs one.
 *
 * Everything is decided from the execution context the server built - the
 * mission's organization and workspace - and from the connection row as it is
 * now, so a disconnect or a capability turned off applies to the very next
 * call, including one already queued. In order:
 *
 *   1. the provider is set up on this server
 *   2. a live connection reaches this mission: the workspace's own first,
 *      then the company-wide one; another organization's is never looked at
 *   3. it is active - one the provider has refused waits for a person
 *   4. it allows the capability the tool needs
 *   5. this process has not used it too often in the last minute
 *   6. its credentials open, and are refreshed if about to expire
 *
 * A token the provider refuses is refreshed and the call tried once more
 * where the provider supports refresh. Otherwise the connection is marked as
 * needing attention and the call fails; nothing is retried beyond that.
 */
export class ConnectionResolver implements ConnectionAccess {
  private readonly refreshing = new Map<string, Promise<ConnectionCredentials>>();

  constructor(
    private readonly connections: ConnectionRepository,
    private readonly providers: ConnectionProviders,
    private readonly eventRecorder: Pick<EventRecorder, "record">,
    private readonly limiter = new ConnectionRateLimiter(),
    private readonly now: () => number = Date.now,
  ) {}

  async use<T>(
    context: ToolExecutionContext,
    need: ConnectionNeed,
    run: (session: ConnectionSession) => Promise<T>,
  ): Promise<T> {
    const oauth = this.providers.get(need.provider);

    if (!oauth || !this.providers.cipher) {
      throw new ConnectorError("not_configured");
    }

    const connection = await this.resolve(context, need);

    if (connection.status !== "active") {
      throw new ConnectorError(connection.lastErrorCode === "token_expired" ? "token_expired" : "token_revoked");
    }

    if (!connection.capabilities.includes(need.capability)) {
      throw new ConnectorError("capability_disabled");
    }

    this.limiter.take(connection.id);

    let credentials = await this.credentials(connection);
    let refreshed = false;

    if (oauth.refresh && credentials.expiresAt !== undefined && credentials.expiresAt - this.now() < REFRESH_MARGIN_MS) {
      credentials = await this.refresh(context, connection, credentials);
      refreshed = true;
    }

    let result: T;

    try {
      result = await run({ accessToken: credentials.accessToken });
    } catch (error) {
      if (!isCredentialFailure(error)) {
        throw error;
      }

      if (!oauth.refresh || refreshed) {
        await this.needsAttention(context, connection, (error as ConnectorError).code);
        throw error;
      }

      credentials = await this.refresh(context, connection, credentials);

      try {
        result = await run({ accessToken: credentials.accessToken });
      } catch (retryError) {
        if (isCredentialFailure(retryError)) {
          await this.needsAttention(context, connection, (retryError as ConnectorError).code);
        }

        throw retryError;
      }
    }

    await this.touch(connection);
    return result;
  }

  private async resolve(context: ToolExecutionContext, need: ConnectionNeed): Promise<Connection> {
    const organizationId = context.organizationId as OrganizationId;
    const workspaceId = typeof context.metadata.workspaceId === "string" && context.metadata.workspaceId
      ? (context.metadata.workspaceId as WorkspaceId)
      : undefined;

    const connection =
      (workspaceId ? await this.connections.findLive(organizationId, need.provider, workspaceId) : null) ??
      (await this.connections.findLive(organizationId, need.provider));

    // Belt and braces: the repository already scopes by organization.
    if (!connection || connection.organizationId !== organizationId) {
      throw new ConnectorError("not_connected");
    }

    return connection;
  }

  private async credentials(connection: Connection): Promise<ConnectionCredentials> {
    const sealed = await this.connections.readCredentials(connection.organizationId, connection.id);

    if (!sealed) {
      // Disconnected between the lookup and now.
      throw new ConnectorError("not_connected");
    }

    try {
      return parseCredentials(this.providers.cipher!.open(sealed, `connection:${connection.id}`));
    } catch {
      throw new ConnectorError("token_revoked", {
        message: "The connection's stored authorization could not be read. Reconnect it.",
      });
    }
  }

  private refresh(
    context: ToolExecutionContext,
    connection: Connection,
    credentials: ConnectionCredentials,
  ): Promise<ConnectionCredentials> {
    // Concurrent calls on one connection share a single refresh.
    const inFlight = this.refreshing.get(connection.id);
    if (inFlight) return inFlight;

    const attempt = (async () => {
      try {
        const renewed = await this.providers.get(connection.provider)!.refresh!(credentials);

        await this.connections.replaceCredentials(
          connection.organizationId,
          connection.id,
          this.providers.cipher!.seal(serializeCredentials(renewed), `connection:${connection.id}`),
          new Date(this.now()),
        );

        return renewed;
      } catch (error) {
        if (isCredentialFailure(error)) {
          await this.needsAttention(context, connection, (error as ConnectorError).code);
        }

        throw error;
      } finally {
        this.refreshing.delete(connection.id);
      }
    })();

    this.refreshing.set(connection.id, attempt);
    return attempt;
  }

  private async needsAttention(context: ToolExecutionContext, connection: Connection, code: string): Promise<void> {
    const current = await this.connections.find(connection.organizationId, connection.id);

    if (!current || current.status !== "active") {
      return;
    }

    await this.connections.update({
      ...current,
      status: "needs_attention",
      lastErrorCode: code,
      updatedAt: new Date(this.now()),
    });

    await this.eventRecorder.record({
      organizationId: connection.organizationId,
      workId: context.workId as WorkId | undefined,
      taskId: context.taskId as TaskId | undefined,
      agentId: context.agentId as AgentId | undefined,
      type: "connection.needs_attention",
      actorType: "system",
      payload: {
        connectionId: connection.id,
        provider: connection.provider,
        reason: code,
      },
    });
  }

  private async touch(connection: Connection): Promise<void> {
    const now = this.now();

    if (connection.lastUsedAt && now - connection.lastUsedAt.getTime() < TOUCH_INTERVAL_MS) {
      return;
    }

    // Recording use must never turn a completed external call into a failure.
    await this.connections.markUsed(connection.organizationId, connection.id, new Date(now)).catch(() => undefined);
  }
}
