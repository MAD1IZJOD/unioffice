import { ArrowLeft, Check, Unplug, Wrench } from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import {
  disconnectConnection,
  fetchConnection,
  formatRelativeTime,
  setConnectionCapabilities,
  type ConnectionCapability,
  type ConnectionItem,
} from "../lib/api";

import { useCan } from "../lib/access";
import { CONNECTION_STATUS, PROVIDER_ICON, SCOPE_LABEL } from "../lib/connections";
import { useResource } from "../lib/useResource";

import {
  Chapter,
  Connecting,
  Failure,
  StatusPill,
} from "../components/primitives";

/**
 * One connection: what it is, who made it, what the provider granted, what
 * agents may do through it, and when it was last used.
 *
 * The capabilities here are the company's decision, not the provider's. The
 * provider's scopes are what the token could do; a capability is what agents
 * are allowed to use it for. A write is still held for a person's approval
 * every time a step needs one.
 */
export default function Connection() {
  const { connectionId = "" } = useParams();
  const [params] = useSearchParams();
  const canManage = useCan("connections.manage");

  const resource = useResource<ConnectionItem>(
    useCallback(() => fetchConnection(connectionId), [connectionId]),
    { enabled: Boolean(connectionId), pollMs: 60_000 },
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  async function toggle(connection: ConnectionItem, capability: ConnectionCapability, enabled: boolean) {
    if (busy) return;
    setBusy(capability);
    setError(undefined);

    const next = enabled
      ? [...connection.capabilities, capability]
      : connection.capabilities.filter((entry) => entry !== capability);

    try {
      await setConnectionCapabilities(connection.id, next);
      resource.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(connection: ConnectionItem) {
    if (busy) return;
    setBusy("disconnect");
    setError(undefined);

    try {
      const result = await disconnectConnection(connection.id);
      setConfirming(false);
      setNotice(
        result.providerRevoked
          ? `Disconnected. ${connection.providerName} confirmed the authorization was revoked, and agents can no longer use it.`
          : `Disconnected here, and agents can no longer use it. ${connection.providerName} did not confirm the revoke - you can also remove the authorization from your ${connection.providerName} account settings.`,
      );
      resource.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (resource.loading) {
    return (
      <div className="mx-auto max-w-[1240px]">
        <Connecting what="Opening the connection…" />
      </div>
    );
  }

  if (resource.error || !resource.data) {
    const missing = resource.error?.status === 404;

    return (
      <div className="mx-auto max-w-[1240px] pt-4">
        <Failure
          headline={missing ? "This connection is not here" : "This connection could not be opened"}
          detail={
            missing
              ? "No connection with this id belongs to this organization, or it is for a workspace you have not been given."
              : (resource.error?.message ?? "The API returned nothing for this id.")
          }
          action={<Link to="/settings/connections" className="button-quiet">Connections</Link>}
        />
      </div>
    );
  }

  const connection = resource.data;
  const status = CONNECTION_STATUS[connection.status];
  const Icon = PROVIDER_ICON[connection.provider];
  const revoked = connection.status === "revoked";

  return (
    <div className="fade-up">
      <header className={`place tone-${status.tone}`}>
        <div className="place-inner">
          <Link to="/settings/connections" className="button-quiet mb-6 inline-flex">
            <ArrowLeft size={12} />
            Connections
          </Link>

          <span className="place-mark"><Icon size={28} /></span>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="place-name">{connection.providerName}</h2>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </div>

          <p className="place-description">
            {connection.account ? `Acts as ${connection.account}.` : "The connected account."}{" "}
            {connection.workspace ? `Used only by missions in ${connection.workspace.name}.` : "Used by missions across the organization."}
          </p>

          {params.get("connected") === "1" && !revoked && (
            <div className="callout mt-5 max-w-[68ch]">
              <Check size={12} className="mr-1 inline align-[-1px]" />
              Connected. No agent can use it until it holds one of the tools below, and writes still wait for a person.
            </div>
          )}

          {connection.problem && (
            <div className="mt-5 max-w-[68ch]">
              <Failure headline="Agents cannot use this connection right now" detail={connection.problem} />
            </div>
          )}

          {notice && <p className="config-hint mt-4 max-w-[68ch]">{notice}</p>}

          {error && (
            <div className="mt-4 max-w-[68ch]">
              <Failure headline="That change was not made" detail={error} />
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1240px]">
        <Chapter index="01" title="The connection" />

        <div className="connection-facts" role="list" aria-label="Connection facts">
          <Fact label="Provider" value={connection.providerName} />
          <Fact label="Status" value={status.label} />
          <Fact label="Scope" value={connection.workspace ? connection.workspace.name : "Whole organization"} />
          <Fact label="Connected by" value={connection.connectedBy ?? "Someone no longer here"} />
          <Fact label="Connected" value={new Date(connection.connectedAt).toLocaleString()} />
          <Fact label="Last used by an agent" value={connection.lastUsedAt ? formatRelativeTime(connection.lastUsedAt) : "Never"} />
          {connection.revokedAt && <Fact label="Disconnected" value={new Date(connection.revokedAt).toLocaleString()} />}
        </div>

        <Chapter index="02" title="What the provider granted" />

        {connection.scopes.length === 0 ? (
          <p className="dossier-answer">
            {revoked ? "Nothing - the authorization was removed." : "No scopes were reported. Public information only."}
          </p>
        ) : (
          <div className="token-set">
            {connection.scopes.map((scope) => (
              <span key={scope} className="token">{SCOPE_LABEL[scope] ?? scope}</span>
            ))}
          </div>
        )}

        <Chapter index="03" title="What agents may do" />

        <div role="group" aria-label="Capabilities">
          {connection.availableCapabilities.map((entry) => (
            <label key={entry.capability} className="connection-capability">
              <input
                type="checkbox"
                checked={entry.enabled}
                disabled={!canManage || revoked || busy !== null || (!entry.enabled && !entry.grantable)}
                onChange={(event) => void toggle(connection, entry.capability, event.target.checked)}
              />
              <span>
                <span className="connection-name">{entry.label}</span>
                <span className="connection-detail">
                  {entry.access === "write"
                    ? "Changes something in the other system. Every step that needs it waits for an owner or admin to approve."
                    : "Reads only."}
                  {!entry.grantable && " The access the provider granted cannot carry this; reconnect with more access to enable it."}
                </span>
              </span>
            </label>
          ))}
        </div>

        <Chapter index="04" title="Tools that use it" />

        <div className="token-set">
          {connection.tools.map((tool) => (
            <span key={tool.id} className="token">
              <Wrench size={10} className="mr-1 inline align-[-1px]" />
              {tool.name}{tool.access === "write" ? " · writes" : ""}
            </span>
          ))}
        </div>
        <p className="dossier-answer">
          An agent reaches this connection only through one of these tools, granted to it on its profile, and only for
          what is allowed above. Governance decides every call.
        </p>

        {canManage && !revoked && (
          <>
            <Chapter index="05" title="Disconnect" />
            <div className="connection-actions !pl-0">
              {confirming ? (
                <>
                  <span className="config-hint !mt-0">
                    Revoke the authorization and erase the stored credentials? Agents lose access immediately. The history
                    stays.
                  </span>
                  <button type="button" className="button-reject" disabled={busy !== null} onClick={() => void disconnect(connection)}>
                    {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                  </button>
                  <button type="button" className="button-quiet" onClick={() => setConfirming(false)}>Keep</button>
                </>
              ) : (
                <button type="button" className="button-ghost" disabled={busy !== null} onClick={() => setConfirming(true)}>
                  <Unplug size={12} />
                  Disconnect {connection.providerName}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="connection-fact" role="listitem">
      <div className="connection-fact-label">{label}</div>
      <div className="connection-fact-value">{value}</div>
    </div>
  );
}
