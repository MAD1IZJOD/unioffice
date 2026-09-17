import { Plug } from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  disconnectConnection,
  fetchConnections,
  fetchOrganization,
  formatRelativeTime,
  startConnection,
  type ConnectionItem,
  type ConnectionProvider,
  type ConnectionsOverview,
  type OrganizationOverview,
} from "../lib/api";

import { useCan } from "../lib/access";
import { callbackMessage, CONNECTION_STATUS, leaveForAuthorization, PROVIDER_ICON } from "../lib/connections";
import { useResource } from "../lib/useResource";

import {
  Chapter,
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
  StatusPill,
} from "../components/primitives";

/**
 * The external systems the organization has connected.
 *
 * A connection belongs to the organization. Connecting one gives no agent
 * anything by itself: an agent reaches it only through a tool it was granted,
 * for what the connection allows, under governance. Everyone sees what is
 * connected where they can see; owners and admins connect and disconnect.
 */

export default function Connections() {
  const canManage = useCan("connections.manage");
  const [params] = useSearchParams();
  const callbackError = callbackMessage(params.get("error"));

  const overview = useResource<ConnectionsOverview>(useCallback(() => fetchConnections(), []), { pollMs: 60_000 });
  const organization = useResource<OrganizationOverview>(
    useCallback(() => fetchOrganization(), []),
    { enabled: canManage },
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [repositoryAccess, setRepositoryAccess] = useState<"public" | "private">("public");

  const workspaces = (organization.data?.workspaces ?? []).filter((entry) => entry.workspace.status === "active");

  async function connect(provider: ConnectionProvider) {
    if (busy) return;
    setBusy(`connect:${provider}`);
    setError(undefined);

    try {
      const url = await startConnection(provider, {
        workspaceId: workspaceId || undefined,
        repositoryAccess: provider === "github" ? repositoryAccess : undefined,
      });
      leaveForAuthorization(url);
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(null);
    }
  }

  async function disconnect(connection: ConnectionItem) {
    if (busy) return;
    setBusy(`disconnect:${connection.id}`);
    setError(undefined);

    try {
      const result = await disconnectConnection(connection.id);
      setConfirming(null);
      if (!result.providerRevoked) {
        setError(
          `${connection.providerName} was disconnected here, but ${connection.providerName} did not confirm the authorization was revoked. You can remove it from your ${connection.providerName} account settings.`,
        );
      }
      overview.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (overview.error) {
    return (
      <div className="mx-auto max-w-[1240px] pt-6">
        <Failure
          headline="Connections could not be read"
          detail={overview.error.message}
          consequence="Nothing was changed by this request."
          action={<button type="button" className="button-ghost" onClick={overview.reload}>Try again</button>}
        />
      </div>
    );
  }

  const providers = overview.data?.providers ?? [];
  const connections = overview.data?.connections ?? [];
  const live = connections.filter((connection) => connection.status !== "revoked");
  const history = connections.filter((connection) => connection.status === "revoked");
  const selectedScope = workspaceId || undefined;

  return (
    <div className="fade-up">
      <PageOpening
        eyebrow="Settings"
        title="CONNECTIONS"
        lead={live.length === 1 ? "ONE SYSTEM CONNECTED." : `${live.length === 0 ? "NO" : live.length} SYSTEMS CONNECTED.`}
        detail="External systems the organization has authorized. An agent reaches one only through a tool it was granted, for what the connection allows, and governance still decides every call. Tokens stay on the server."
        tone={live.some((connection) => connection.status === "needs_attention") ? "waiting" : "quiet"}
        meta={
          <>
            <Reading label="Connected" value={overview.loading ? "—" : live.filter((entry) => entry.status === "active").length} tone="live" />
            <Reading label="Needs reconnecting" value={overview.loading ? "—" : live.filter((entry) => entry.status === "needs_attention").length} tone="warning" />
            <Reading label="Disconnected" value={overview.loading ? "—" : history.length} tone="idle" />
          </>
        }
      />

      <div className="mx-auto max-w-[1240px]">
        {(callbackError || error) && (
          <div className="mb-4">
            <Failure headline="That was not connected" detail={error ?? callbackError!} />
          </div>
        )}

        <Chapter index="01" title="Systems" />

        {canManage && workspaces.length > 0 && (
          <div className="config mb-4">
            <div className="config-row">
              <label className="config-label" htmlFor="connection-scope">Connect for</label>
              <select
                id="connection-scope"
                className="config-input"
                value={workspaceId}
                disabled={busy !== null}
                onChange={(event) => setWorkspaceId(event.target.value)}
              >
                <option value="">The whole organization</option>
                {workspaces.map((entry) => (
                  <option key={entry.workspace.id} value={entry.workspace.id}>Only {entry.workspace.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {overview.loading ? (
          <Connecting what="Reading connections…" />
        ) : (
          <div className="connection-list" role="list" aria-label="Systems">
            {providers.map((provider) => {
              const Icon = PROVIDER_ICON[provider.provider];
              const inScope = live.find((connection) =>
                connection.provider === provider.provider && (connection.workspace?.id ?? undefined) === selectedScope);
              const elsewhere = live.filter((connection) => connection.provider === provider.provider && connection !== inScope);

              return (
                <div key={provider.provider} className="connection-row" role="listitem" aria-label={provider.name}>
                  <div className="connection-main">
                    <span className="connection-mark"><Icon size={14} /></span>

                    <span className="min-w-0 flex-1">
                      <span className="connection-name">{provider.name}</span>
                      <span className="connection-detail">
                        {inScope
                          ? `${inScope.account ?? "Account"} · connected by ${inScope.connectedBy ?? "someone no longer here"} ${formatRelativeTime(inScope.connectedAt)}`
                          : provider.configured
                            ? provider.description
                            : "Not set up on this server. An administrator adds its OAuth client to the API's environment."}
                      </span>
                    </span>

                    {inScope ? (
                      <StatusPill tone={CONNECTION_STATUS[inScope.status].tone}>{CONNECTION_STATUS[inScope.status].label}</StatusPill>
                    ) : (
                      <StatusPill tone="idle">{provider.configured ? "Not connected" : "Unavailable"}</StatusPill>
                    )}
                  </div>

                  <div className="connection-actions">
                    {inScope && (
                      <Link to={`/settings/connections/${inScope.id}`} className="button-quiet">Details</Link>
                    )}

                    {canManage && provider.configured && provider.provider === "github" && (!inScope || inScope.status === "needs_attention") && (
                      <select
                        aria-label="GitHub repositories to allow"
                        className="config-input member-role"
                        value={repositoryAccess}
                        disabled={busy !== null}
                        onChange={(event) => setRepositoryAccess(event.target.value as "public" | "private")}
                      >
                        <option value="public">Public repositories</option>
                        <option value="private">Public and private repositories</option>
                      </select>
                    )}

                    {canManage && provider.configured && (!inScope || inScope.status === "needs_attention") && (
                      <button
                        type="button"
                        className="button-primary"
                        disabled={busy !== null}
                        onClick={() => void connect(provider.provider)}
                      >
                        <Plug size={12} />
                        {busy === `connect:${provider.provider}` ? "Opening…" : inScope ? "Reconnect" : "Connect"}
                      </button>
                    )}

                    {canManage && inScope && (confirming === inScope.id ? (
                      <>
                        <span className="config-hint !mt-0">
                          Disconnect {provider.name}? Agents lose access immediately.
                        </span>
                        <button
                          type="button"
                          className="button-reject"
                          disabled={busy !== null}
                          onClick={() => void disconnect(inScope)}
                        >
                          {busy === `disconnect:${inScope.id}` ? "Disconnecting…" : "Disconnect"}
                        </button>
                        <button type="button" className="button-quiet" onClick={() => setConfirming(null)}>Keep</button>
                      </>
                    ) : (
                      <button type="button" className="button-quiet" disabled={busy !== null} onClick={() => setConfirming(inScope.id)}>
                        Disconnect
                      </button>
                    ))}
                  </div>

                  {elsewhere.length > 0 && (
                    <div className="connection-actions">
                      {elsewhere.map((connection) => (
                        <Link key={connection.id} to={`/settings/connections/${connection.id}`} className="token">
                          {connection.workspace ? connection.workspace.name : "Whole organization"} · {CONNECTION_STATUS[connection.status].label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {history.length > 0 && (
          <>
            <Chapter index="02" title="Disconnected" />
            <div className="connection-list" role="list" aria-label="Disconnected">
              {history.map((connection) => (
                <Link key={connection.id} to={`/settings/connections/${connection.id}`} className="connection-row" role="listitem">
                  <span className="connection-main">
                    <span className="min-w-0 flex-1">
                      <span className="connection-name">{connection.providerName}</span>
                      <span className="connection-detail">
                        {connection.account ?? "Account"} · {connection.workspace ? connection.workspace.name : "Whole organization"} · disconnected {formatRelativeTime(connection.revokedAt ?? undefined)}
                      </span>
                    </span>
                    <StatusPill tone="idle">Disconnected</StatusPill>
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        {!overview.loading && providers.every((provider) => !provider.configured) && live.length === 0 && (
          <div className="mt-4">
            <Quiet
              line="No external system is set up on this server yet."
              detail="GitHub and Google Drive become available once their OAuth clients and an encryption key are added to the API's environment."
            />
          </div>
        )}
      </div>
    </div>
  );
}
