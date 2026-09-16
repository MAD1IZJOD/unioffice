import {
  ArrowLeft,
  Check,
  CircleDot,
  Pause,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  fetchAgentProfile,
  fetchTools,
  fetchWorkspaces,
  formatRelativeTime,
  updateAgent,
  type AgentProfile,
  type AgentSummary,
  type ToolDescriptor,
  type WorkforceMember,
  type WorkspaceSummary,
} from "../lib/api";

import { useCan } from "../lib/access";
import { useLiveResource } from "../lib/live";
import { useResource } from "../lib/useResource";
import { statusLabel, taskStatusTone, toneClass, type Tone } from "../lib/tone";
import { capabilityLabel, PRESENCE, profileOf } from "../lib/workforce";

import {
  Connecting,
  Failure,
  Quiet,
  StatusPill,
} from "../components/primitives";

import { AgentMark } from "../components/AgentMark";
import { WorkspaceMark } from "../components/WorkspaceMark";

/**
 * One worker's profile.
 *
 * Who this is, what it is doing now, what it can do, what it may use - and
 * what governance lets it actually do with that - where it works, and what it
 * has done. Everything is read from the API's profile of the agent: its task
 * rows, the missions they belong to, the events and artifacts it left and the
 * enforced policies. Nothing it was instructed or produced is shown here
 * beyond names and titles.
 */
export default function Agent() {
  const { agentId = "" } = useParams();
  const canConfigure = useCan("agents.configure");

  const profile = useLiveResource<AgentProfile>(
    useCallback(() => fetchAgentProfile(agentId), [agentId]),
    { fallbackPollMs: 20_000, enabled: Boolean(agentId) },
  );

  const [editing, setEditing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [statusError, setStatusError] = useState<string>();

  // Pausing stops the delegator giving the agent new steps; resuming lets it
  // be given work again. The API decides whether it may - the last active
  // orchestrator cannot be paused - and says why when it refuses.
  async function setStatus(status: "active" | "paused") {
    setSwitching(true);
    setStatusError(undefined);

    try {
      await updateAgent(agentId, { status });
      profile.reload();
    } catch (caught) {
      setStatusError((caught as Error).message);
    } finally {
      setSwitching(false);
    }
  }

  if (profile.loading) {
    return (
      <div className="mx-auto max-w-[1240px]">
        <Connecting what="Opening the profile…" />
      </div>
    );
  }

  if (profile.error || !profile.data) {
    const missing = profile.error?.status === 404;

    return (
      <div className="mx-auto max-w-[1240px] pt-4">
        <Failure
          headline={missing ? "This agent is not in your workforce" : "This agent could not be opened"}
          detail={
            missing
              ? "No agent with this id works for this organization, or it works in a workspace you have not been given."
              : (profile.error?.message ?? "The API returned nothing for this id.")
          }
          action={
            <>
              {!missing && (
                <button type="button" onClick={profile.reload} className="button-ghost">
                  Try again
                </button>
              )}
              <Link to="/workforce" className="button-quiet">
                The workforce
              </Link>
            </>
          }
        />
      </div>
    );
  }

  const { member, history, artifacts, activity, governance } = profile.data;
  const presence = PRESENCE[member.presence];
  const orchestrator = member.type === "orchestrator";
  const unregistered = member.tools.filter((tool) => !tool.registered);

  return (
    <div className="fade-up">
      <header className={`place ${toneClass[presence.tone]}`}>
        <div className="place-inner">
          <Link to="/workforce" className="button-quiet mb-6 inline-flex">
            <ArrowLeft size={12} />
            The workforce
          </Link>

          <span className="place-mark">
            <AgentMark
              agentId={member.id}
              capabilities={member.capabilities}
              tools={member.tools.length}
              type={member.type}
              size={32}
              active={member.presence === "working"}
            />
          </span>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="place-name">{member.name}</h2>

            <StatusPill tone={presence.tone} pulse={member.presence === "working"}>
              {presence.label}
            </StatusPill>
          </div>

          <p className="place-description">{member.description}</p>

          <div className="place-slug">
            {profileOf(member).label} · {member.type}
            {orchestrator && " · system-critical"}
          </div>

          {member.workspace ? (
            <Link to={`/workspaces/${member.workspace.id}`} className="place-tag mt-5 inline-flex">
              <span className="place-tag-mark">
                <WorkspaceMark slug={member.workspace.slug} size={16} />
              </span>
              Works in {member.workspace.name}
            </Link>
          ) : (
            <div className="place-slug !mt-5">Belongs to no workspace — can be given work anywhere</div>
          )}

          <div className="dispatch-meta !mt-7">
            <Fact label="Finished" value={member.recent.completed} />
            <Fact label="Failed" value={member.recent.failed} />
            <Fact label="Capabilities" value={member.capabilities.length} />
            <Fact label="Tools" value={member.tools.length} />
          </div>

          {canConfigure && !editing && (
            <div className="mt-7 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setEditing(true)} className="button-ghost">
                <Pencil size={12} />
                Configure
              </button>

              {(member.status === "active" || member.status === "paused") && (
                <button
                  type="button"
                  className="button-quiet"
                  disabled={switching}
                  onClick={() => void setStatus(member.status === "active" ? "paused" : "active")}
                >
                  {member.status === "active" ? <Pause size={12} /> : <Play size={12} />}
                  {switching
                    ? member.status === "active" ? "Pausing…" : "Resuming…"
                    : member.status === "active" ? "Pause" : "Resume"}
                </button>
              )}
            </div>
          )}

          {statusError && (
            <div className="mt-4 max-w-[68ch]">
              <Failure headline="The agent's status was not changed" detail={statusError} />
            </div>
          )}

          {member.status === "paused" && member.current && (
            <p className="config-hint mt-4 max-w-[68ch]">
              Paused agents are given no new steps. The step it is on now is left to finish.
            </p>
          )}

          {orchestrator && (
            <p className="config-hint mt-4 max-w-[68ch]">
              <ShieldAlert size={11} className="mr-1 inline align-[-1px]" />
              {member.name} plans and routes every mission in this organization. Its capabilities cannot be removed and
              it cannot be paused while it is the only active orchestrator.
            </p>
          )}
        </div>
      </header>

      <div className="dossier">
        <div className="min-w-0">
          {editing ? (
            <AgentEditor
              member={member}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                profile.reload();
              }}
            />
          ) : (
            <>
              <section className="dossier-block" aria-label="Current work">
                <div className="dossier-question">What it is doing now</div>
                <CurrentWork member={member} />
              </section>

              <section className="dossier-block" aria-label="Capabilities">
                <div className="dossier-question">What it can do</div>
                <div className="token-set">
                  {member.capabilities.map((capability) => (
                    <span key={capability} className="token">
                      {capabilityLabel(capability)}
                    </span>
                  ))}
                </div>
                <p className="dossier-answer">
                  The planner names these when it writes a step, and a step goes to whoever holds the one it names.
                </p>
              </section>

              <section className="dossier-block" aria-label="Tools">
                <div className="dossier-question">What it may use</div>

                {governance.tools.length === 0 && unregistered.length === 0 ? (
                  <p className="dossier-answer">
                    Holds no tools, so it is never given a step that needs one. This is a hard boundary, not a
                    preference.
                  </p>
                ) : (
                  <div className="agent-tools">
                    {governance.tools.map((tool) => (
                      <div key={tool.toolId} className={`agent-tool ${toneClass[accessTone(tool.access)]}`}>
                        <span className="agent-tool-name">
                          <Wrench size={11} />
                          {tool.name}
                        </span>
                        <StatusPill tone={accessTone(tool.access)}>{ACCESS_LABEL[tool.access]}</StatusPill>
                        <span className="agent-tool-why">
                          {tool.explanation}
                          {tool.policyNames.length > 0 && ` (${tool.policyNames.join(", ")})`}
                        </span>
                      </div>
                    ))}

                    {unregistered.map((tool) => (
                      <div key={tool.id} className="agent-tool tone-idle">
                        <span className="agent-tool-name">
                          <Wrench size={11} />
                          {tool.id}
                        </span>
                        <StatusPill tone="idle">No longer registered</StatusPill>
                        <span className="agent-tool-why">
                          The grant is inert: this build has no such tool, so the agent cannot call it.
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <p className="dossier-answer">
                  A tool grant is not a permission. Governance decides every call, and can put a person in front of it
                  or refuse it.
                </p>
              </section>

              <section className="dossier-block" aria-label="Rules">
                <div className="dossier-question">Rules that apply</div>

                {governance.policies.length === 0 ? (
                  <p className="dossier-answer">No enforced policy narrows what this agent does.</p>
                ) : (
                  <div className="token-set">
                    {governance.policies.map((policy) => (
                      <Link key={policy.id} to="/governance" className={`token ${policy.effect === "deny" ? "token-unknown" : ""}`}>
                        {policy.name} · {EFFECT_LABEL[policy.effect]}
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              <section className="dossier-block" aria-label="Work history">
                <div className="dossier-question">What it has done</div>

                {history.length === 0 ? (
                  <Quiet
                    line="Nothing has been given to this agent yet."
                    detail="Every step delegated here appears in this list, with the mission it belonged to."
                  />
                ) : (
                  <div className="mission-board mt-3">
                    {history.map((entry) => (
                      <Link
                        key={entry.taskId}
                        to={`/missions/${entry.missionId}`}
                        className={`mission-step ${toneClass[taskStatusTone(entry.status)]} block !border-b`}
                      >
                        <div className="mission-step-head !grid">
                          <span className="mission-step-rail" />
                          <span className="mission-step-index">
                            {entry.status === "completed" ? "✓" : entry.status === "failed" ? "✕" : "·"}
                          </span>

                          <span className="min-w-0">
                            <span className="mission-step-title block">{entry.taskTitle}</span>
                            <span className="mission-step-meta">
                              <span className="truncate">{entry.missionName}</span>
                              <span>{formatRelativeTime(entry.at)}</span>
                            </span>
                          </span>

                          <span className="pt-0.5">
                            <StatusPill tone={taskStatusTone(entry.status)}>{statusLabel(entry.status)}</StatusPill>
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <aside className="dossier-side">
          <div className="section-head">
            <div className="section-head-title">
              Produced
              <span className="section-head-count">{artifacts.length}</span>
            </div>
          </div>

          {artifacts.length === 0 ? (
            <p className="t-meta py-2">This agent has not produced an artifact yet.</p>
          ) : (
            <div className="space-y-px">
              {artifacts.map((artifact) => (
                <Link
                  key={artifact.id}
                  to={artifact.missionId ? `/missions/${artifact.missionId}` : "/artifacts"}
                  className="presence-row"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] text-[#f2f4f7]">{artifact.name}</span>
                    <span className="mt-1 block truncate text-[10px] text-[#6f7887]">
                      {artifact.type} · {formatRelativeTime(artifact.createdAt)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}

          <div className="section-head mt-8">
            <div className="section-head-title">Its record</div>
          </div>

          {activity.length === 0 ? (
            <p className="t-meta py-2">Nothing recorded for this agent yet.</p>
          ) : (
            <ol className="scroll-area max-h-[420px] pr-1" aria-label="Recent activity">
              {activity.map((event) => (
                <li key={event.id} className="stream-row">
                  <CircleDot size={9} className={`stream-dot ${toneClass[eventTone(event.type)]}`} />

                  <span className="min-w-0 flex-1">
                    {event.missionId ? (
                      <Link to={`/missions/${event.missionId}`} className="block truncate text-[11px] text-[#a7b0bd] hover:text-[#84b4fb]">
                        {event.summary}
                      </Link>
                    ) : (
                      <span className="block truncate text-[11px] text-[#a7b0bd]">{event.summary}</span>
                    )}
                  </span>

                  <span className="t-machine shrink-0">{formatRelativeTime(event.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}

function CurrentWork({ member }: { member: WorkforceMember }) {
  if (member.current) {
    return (
      <Link to={`/missions/${member.current.missionId}`} className="presence-row mt-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-[#f2f4f7]">{member.current.taskTitle}</span>
          <span className="mt-1 block truncate text-[10.5px] text-[#6f7887]">{member.current.missionName}</span>
        </span>

        <StatusPill tone={member.current.state === "working" ? "active" : "warning"} pulse={member.current.state === "working"}>
          {member.current.state === "working" ? "running" : "held for a decision"}
        </StatusPill>
      </Link>
    );
  }

  return (
    <p className="dossier-answer">
      {member.workingElsewhere
        ? "Working on a mission outside your workspaces."
        : member.presence === "paused"
          ? "Paused. It is not given new work until it is resumed."
          : member.presence === "unavailable"
            ? "Unavailable. It is not given work while it is disabled."
            : member.upcomingSteps > 0
              ? `Nothing running. ${member.upcomingSteps} ${member.upcomingSteps === 1 ? "step is" : "steps are"} assigned and waiting to start.`
              : "Nothing right now. Available to be given work."}
    </p>
  );
}

const ACCESS_LABEL: Record<AgentProfile["governance"]["tools"][number]["access"], string> = {
  allowed: "Allowed",
  requires_approval: "Needs approval",
  denied: "Refused",
};

const EFFECT_LABEL: Record<AgentProfile["governance"]["policies"][number]["effect"], string> = {
  allow: "allows",
  require_approval: "needs approval",
  deny: "refuses",
};

function accessTone(access: AgentProfile["governance"]["tools"][number]["access"]): Tone {
  return access === "allowed" ? "live" : access === "requires_approval" ? "warning" : "error";
}

function eventTone(type: string): Tone {
  if (type === "task.completed" || type === "artifact.created") return "live";
  if (type === "task.failed" || type === "governance.denied") return "error";
  if (type === "approval.requested" || type === "governance.approval_required") return "warning";
  return "active";
}

/**
 * Configuring an agent, against what the backend accepts. Only offered to
 * roles that configure the workforce; the API refuses anyone else.
 */
function AgentEditor({ member, onCancel, onSaved }: { member: WorkforceMember; onCancel: () => void; onSaved: () => void }) {
  const tools = useResource<ToolDescriptor[]>(useCallback(() => fetchTools(), []));
  const workspaces = useResource<WorkspaceSummary[]>(useCallback(() => fetchWorkspaces(), []));

  const orchestrator = member.type === "orchestrator";

  const [description, setDescription] = useState(member.description);
  const [capabilities, setCapabilities] = useState<string[]>([...member.capabilities]);
  const [capabilityDraft, setCapabilityDraft] = useState("");
  // A grant for a tool that is no longer registered cannot be saved back, so
  // it is left out; saving drops it.
  const [toolIds, setToolIds] = useState<string[]>(member.tools.filter((tool) => tool.registered).map((tool) => tool.id));
  const [workspaceId, setWorkspaceId] = useState<string | null>(member.workspace?.id ?? null);
  const [status, setStatus] = useState<AgentSummary["status"]>(member.status);
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

  async function save() {
    if (busy) return;

    setBusy(true);
    setError(undefined);

    try {
      await updateAgent(member.id, { description: description.trim(), capabilities, toolIds, workspaceId, status });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="config">
      <div className="config-row">
        <label className="config-label" htmlFor="agent-description">What it does</label>
        <textarea
          id="agent-description"
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
          className="config-textarea"
        />
        <p className="config-hint">
          This becomes part of the instructions the model is given, so it changes how the agent actually works.
        </p>
      </div>

      <div className="config-row">
        <span className="config-label">Capabilities</span>

        <div className="token-set !mt-0">
          {capabilities.map((capability) => {
            const locked = orchestrator && member.capabilities.includes(capability);

            return (
              <span key={capability} className={`token${locked ? " config-choice-locked" : ""}`}>
                {capability}
                {!locked && (
                  <button
                    type="button"
                    className="token-remove"
                    disabled={busy}
                    aria-label={`Remove ${capability}`}
                    onClick={() => setCapabilities((current) => current.filter((value) => value !== capability))}
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            );
          })}
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
            placeholder="add a capability"
            className="config-input max-w-[240px]"
          />
          <button type="button" onClick={addCapability} disabled={busy || !capabilityDraft.trim()} className="button-quiet">
            <Plus size={12} />
            Add
          </button>
        </div>

        <p className="config-hint">
          Capabilities are the planner's routing vocabulary. A capability nobody holds is a step nobody can be given.
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

        <p className="config-hint">
          Only tools this build registers can be granted, and governance still decides each call.
        </p>
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

        <p className="config-hint">
          An agent in a workspace is only given missions opened there. One belonging to no workspace can work anywhere.
        </p>
      </div>

      <div className="config-row">
        <span className="config-label">Status</span>

        <div className="config-choices">
          {(["active", "paused", "disabled"] as const).map((value) => (
            <button
              key={value}
              type="button"
              disabled={busy}
              onClick={() => setStatus(value)}
              className={`config-choice${status === value ? " config-choice-on" : ""}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-5">
          <Failure headline="That configuration was not saved" detail={error} consequence="Nothing was changed. The agent is as it was." />
        </div>
      )}

      <div className="config-foot">
        <button type="button" onClick={save} disabled={busy || !description.trim() || capabilities.length === 0} className="button-primary">
          {busy ? "Saving…" : "Save configuration"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="button-quiet">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="dispatch-stat tone-idle">
      <div className="dispatch-stat-value !text-[19px]">{value}</div>
      <div className="dispatch-stat-label">{label}</div>
    </div>
  );
}
