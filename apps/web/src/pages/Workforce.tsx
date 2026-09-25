import { Check, Plus, ShieldAlert, Wrench, X } from "lucide-react";

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import {
  createAgent,
  fetchTools,
  fetchWorkforce,
  fetchWorkspaces,
  formatRelativeTime,
  type AgentSummary,
  type ToolDescriptor,
  type Workforce as WorkforceData,
  type WorkforceMember,
  type WorkspaceSummary,
} from "../lib/api";

import { useCan } from "../lib/access";
import { useLiveResource } from "../lib/live";
import { useResource } from "../lib/useResource";
import { toneClass } from "../lib/tone";
import { spellOut } from "../lib/statement";
import { capabilityLabel, PRESENCE, profileOf } from "../lib/workforce";

import {
  Chapter,
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  ReadFailure,
  Reading,
  StaleNotice,
  StatusPill,
} from "../components/primitives";

import { AgentMark } from "../components/AgentMark";

/**
 * The workforce.
 *
 * Who is working for this organization, read at a glance: who is busy and on
 * what, who is free, who has been taken off work. Every status, every line of
 * current work and every outcome is the API's reading of the task rows
 * execution writes - the same rows Mission Control reads - so the two cannot
 * disagree about who is doing what.
 */
export default function Workforce() {
  const canConfigure = useCan("agents.configure");

  const workforce = useLiveResource<WorkforceData>(
    useCallback(() => fetchWorkforce(), []),
    { fallbackPollMs: 20_000 },
  );

  const [hiring, setHiring] = useState(false);

  const data = workforce.data;
  const members = data?.members ?? [];
  const summary = data?.summary;

  const atWork = members.filter((member) => member.presence === "working" || member.presence === "waiting");
  const available = members.filter((member) => member.presence === "available");
  const off = members.filter((member) => member.presence === "paused" || member.presence === "unavailable");

  const count = (value: number | undefined) => (workforce.loading || value === undefined ? "—" : value);

  return (
    <div className="mx-auto max-w-[1240px] fade-up">
      <PageOpening
        eyebrow="Company"
        title={workforce.loading || !summary ? "THE WORKFORCE." : `${spellOut(summary.total)} ${summary.total === 1 ? "WORKER" : "WORKERS"}.`}
        lead={
          !summary
            ? undefined
            : summary.working > 0
              ? `${spellOut(summary.working)} AT WORK.`
              : "ALL STANDING BY."
        }
        detail="The agents working for this organization. Each is given work by what it can do and what it may use, and governance still decides every step it takes."
        tone={(summary?.working ?? 0) > 0 ? "moving" : "quiet"}
        action={
          canConfigure && !hiring && (
            <button type="button" className="button-primary" onClick={() => setHiring(true)}>
              <Plus size={13} />
              Add an agent
            </button>
          )
        }
        meta={
          <>
            <Reading label="Working" value={count(summary?.working)} tone="active" live={(summary?.working ?? 0) > 0} />
            {(summary?.waiting ?? 0) > 0 && (
              <Reading label="Waiting on a decision" value={summary!.waiting} tone="warning" live />
            )}
            <Reading label="Available" value={count(summary?.available)} tone="live" />
            <Reading label="Paused or unavailable" value={count(summary ? summary.paused + summary.unavailable : undefined)} tone="idle" />
          </>
        }
      />

      {hiring && (
        <HireForm
          onCancel={() => setHiring(false)}
          onHired={() => {
            setHiring(false);
            workforce.reload();
          }}
        />
      )}

      {workforce.error && workforce.data && <StaleNotice error={workforce.error} onRetry={workforce.reload} />}

      {workforce.loading ? (
        <Connecting what="Reading the workforce…" />
      ) : workforce.error && !workforce.data ? (
        <ReadFailure
          what="the workforce"
          error={workforce.error}
          onRetry={workforce.reload}
          consequence={workforce.error.isOffline ? "Missions already running keep running on the worker." : undefined}
        />
      ) : members.length === 0 ? (
        <Quiet
          line="No agents work for this organization."
          detail="Missions need at least an orchestrator to plan them and a specialist to carry out the steps."
          action={
            canConfigure ? (
              <button type="button" className="button-primary" onClick={() => setHiring(true)}>
                <Plus size={13} />
                Add the first agent
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {atWork.length > 0 && (
            <section aria-label="At work">
              <Chapter index="01" title="At work" />
              <div className="workers">
                {atWork.map((member) => <Worker key={member.id} member={member} />)}
              </div>
            </section>
          )}

          <section aria-label="Available">
            <Chapter index={atWork.length > 0 ? "02" : "01"} title="Available" />
            {available.length === 0 ? (
              <p className="t-meta py-2">Nobody is free right now.</p>
            ) : (
              <div className="workers">
                {available.map((member) => <Worker key={member.id} member={member} />)}
              </div>
            )}
          </section>

          {off.length > 0 && (
            <section aria-label="Paused or unavailable">
              <Chapter index={atWork.length > 0 ? "03" : "02"} title="Paused or unavailable" />
              <div className="workers">
                {off.map((member) => <Worker key={member.id} member={member} />)}
              </div>
            </section>
          )}

          <p className="workers-note">
            Outcomes are counted over the {data!.missionWindow} most recently active missions.
          </p>
        </>
      )}
    </div>
  );
}

function Worker({ member }: { member: WorkforceMember }) {
  const presence = PRESENCE[member.presence];
  const working = member.presence === "working";
  const shownCapabilities = member.capabilities.slice(0, 4);

  return (
    <article className={`worker ${toneClass[presence.tone]}`} aria-label={member.name}>
      <span className="worker-mark" aria-hidden="true">
        <AgentMark
          agentId={member.id}
          capabilities={member.capabilities}
          tools={member.tools.length}
          type={member.type}
          size={30}
          active={working}
        />
      </span>

      <Link to={`/workforce/${member.id}`} className="worker-who">
        <span className="worker-name">{member.name}</span>
        <span className="worker-role">{profileOf(member).label}</span>
      </Link>

      <span className="worker-status">
        <StatusPill tone={presence.tone} pulse={working}>{presence.label}</StatusPill>
      </span>

      <span className="worker-now">
        <NowLine member={member} />
      </span>

      <span className="worker-kit">
        <span className="worker-tokens" aria-label="Capabilities">
          {shownCapabilities.map((capability) => (
            <span key={capability} className="token">{capabilityLabel(capability)}</span>
          ))}
          {member.capabilities.length > shownCapabilities.length && (
            <span className="token">+{member.capabilities.length - shownCapabilities.length}</span>
          )}
        </span>

        <span className="worker-tokens" aria-label="Tools">
          {member.tools.length === 0 ? (
            <span className="token">no tools</span>
          ) : (
            member.tools.map((tool) => (
              <span
                key={tool.id}
                className={`token ${tool.registered ? "token-tool" : "token-unknown"}`}
                title={tool.registered ? tool.description : "No longer registered - this grant does nothing."}
              >
                <Wrench size={9} />
                {tool.name}
              </span>
            ))
          )}
        </span>
      </span>

      <span className="worker-foot">
        <span>{member.workspace ? member.workspace.name : "Every workspace"}</span>
        {(member.recent.completed > 0 || member.recent.failed > 0) && (
          <span>
            {member.recent.completed} done
            {member.recent.failed > 0 && ` · ${member.recent.failed} failed`}
          </span>
        )}
      </span>
    </article>
  );
}

/** What the worker is doing, or last did, in one line. */
function NowLine({ member }: { member: WorkforceMember }) {
  if (member.current) {
    return (
      <>
        <Link to={`/missions/${member.current.missionId}`} className="worker-mission">
          {member.current.missionName}
        </Link>
        <span className="worker-task">
          {member.current.state === "waiting" ? "Held for a decision: " : ""}
          {member.current.taskTitle}
        </span>
      </>
    );
  }

  if (member.workingElsewhere) {
    return <span className="worker-task">On a mission outside your workspaces</span>;
  }

  if (member.presence === "paused" || member.presence === "unavailable") {
    return <span className="worker-task">Not being given new work</span>;
  }

  if (member.lastOutcome) {
    const { lastOutcome } = member;

    return (
      <>
        <Link to={`/missions/${lastOutcome.missionId}`} className="worker-mission worker-mission-past">
          {lastOutcome.missionName}
        </Link>
        <span className="worker-task">
          {lastOutcome.outcome === "completed" ? "Finished" : "Could not finish"} “{lastOutcome.taskTitle}” ·{" "}
          {formatRelativeTime(lastOutcome.at)}
        </span>
      </>
    );
  }

  return <span className="worker-task">Has not been given work yet</span>;
}

/**
 * Adding an agent. Kept from the roster it replaces: the backend supports
 * organization-owned agents fully, and only the roles that configure the
 * workforce are offered it.
 */
function HireForm({ onCancel, onHired }: { onCancel: () => void; onHired: () => void }) {
  const workspaces = useResource<WorkspaceSummary[]>(useCallback(() => fetchWorkspaces(), []));
  const tools = useResource<ToolDescriptor[]>(useCallback(() => fetchTools(), []));

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<AgentSummary["type"]>("specialist");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [capabilityDraft, setCapabilityDraft] = useState("");
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function addCapability() {
    const value = capabilityDraft.trim().toLowerCase().replace(/\s+/g, "_");
    if (!value || capabilities.includes(value)) {
      setCapabilityDraft("");
      return;
    }
    setCapabilities((current) => [...current, value]);
    setCapabilityDraft("");
  }

  async function hire() {
    if (busy) return;

    setBusy(true);
    setError(undefined);

    try {
      await createAgent({
        name: name.trim(),
        description: description.trim(),
        type,
        capabilities,
        toolIds,
        workspaceId: workspaceId ?? undefined,
      });
      onHired();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = name.trim().length > 0 && description.trim().length > 0 && capabilities.length > 0;

  return (
    <div className="config mb-6">
      <div className="config-row">
        <label className="config-label" htmlFor="agent-name">Name</label>
        <input
          id="agent-name"
          autoFocus
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          placeholder="Dana"
          className="config-input max-w-[300px]"
        />
      </div>

      <div className="config-row">
        <label className="config-label" htmlFor="agent-description">What it does</label>
        <textarea
          id="agent-description"
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="One or two sentences. This becomes part of the instructions the model is given."
          className="config-textarea"
        />
      </div>

      <div className="config-row">
        <span className="config-label">Kind</span>
        <div className="config-choices">
          {(["specialist", "manager", "orchestrator"] as const).map((value) => (
            <button
              key={value}
              type="button"
              disabled={busy}
              onClick={() => setType(value)}
              className={`config-choice${type === value ? " config-choice-on" : ""}`}
            >
              {value}
            </button>
          ))}
        </div>

        {type === "orchestrator" && (
          <p className="config-hint">
            <ShieldAlert size={11} className="mr-1 inline align-[-1px]" />
            An orchestrator plans and routes work. This organization already has one, and a second is only useful if
            you intend to scope them to different workspaces.
          </p>
        )}
      </div>

      <div className="config-row">
        <span className="config-label">Capabilities</span>

        <div className="token-set !mt-0">
          {capabilities.map((capability) => (
            <span key={capability} className="token">
              {capability}
              <button
                type="button"
                className="token-remove"
                disabled={busy}
                aria-label={`Remove ${capability}`}
                onClick={() => setCapabilities((current) => current.filter((value) => value !== capability))}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={capabilityDraft}
            disabled={busy}
            onChange={(event) => setCapabilityDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCapability();
              }
            }}
            placeholder="research, calculation, scheduling…"
            className="config-input max-w-[280px]"
          />
          <button type="button" onClick={addCapability} disabled={busy || !capabilityDraft.trim()} className="button-quiet">
            <Plus size={12} />
            Add
          </button>
        </div>

        <p className="config-hint">
          At least one. These are what the planner names when it writes a task, so an agent with no capability can
          never be given work.
        </p>
      </div>

      <div className="config-row">
        <span className="config-label">Authorized tools</span>
        <div className="config-choices">
          {(tools.data ?? []).map((tool) => {
            const on = toolIds.includes(tool.id);

            return (
              <button
                key={tool.id}
                type="button"
                disabled={busy}
                title={tool.description}
                onClick={() => setToolIds((current) => (on ? current.filter((value) => value !== tool.id) : [...current, tool.id]))}
                className={`config-choice${on ? " config-choice-on" : ""}`}
              >
                {on ? <Check size={11} /> : <Wrench size={11} />}
                {tool.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="config-row">
        <span className="config-label">Workspace</span>
        <div className="config-choices">
          <button
            type="button"
            disabled={busy}
            onClick={() => setWorkspaceId(null)}
            className={`config-choice${workspaceId === null ? " config-choice-on" : ""}`}
          >
            Everywhere
          </button>

          {(workspaces.data ?? []).map((entry) => (
            <button
              key={entry.workspace.id}
              type="button"
              disabled={busy}
              onClick={() => setWorkspaceId(entry.workspace.id)}
              className={`config-choice${workspaceId === entry.workspace.id ? " config-choice-on" : ""}`}
            >
              {entry.workspace.name}
            </button>
          ))}
        </div>

        {(workspaces.data?.length ?? 0) === 0 && (
          <p className="config-hint">
            No workspaces exist yet, so this agent will be available everywhere.{" "}
            <Link to="/organization" className="underline">Create one</Link>.
          </p>
        )}
      </div>

      {error && (
        <div className="mt-5">
          <Failure headline="That agent was not created" detail={error} consequence="Nothing was changed." />
        </div>
      )}

      <div className="config-foot">
        <button type="button" onClick={hire} disabled={!ready || busy} className="button-primary">
          {busy ? "Creating…" : "Add to the workforce"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="button-quiet">
          Cancel
        </button>
      </div>
    </div>
  );
}
