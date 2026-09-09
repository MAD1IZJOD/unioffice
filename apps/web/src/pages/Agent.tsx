import {
  ArrowLeft,
  Check,
  CircleDot,
  Pencil,
  Plus,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  fetchAgent,
  fetchTools,
  fetchWorkspaces,
  formatRelativeTime,
  updateAgent,
  type AgentDetail,
  type ToolDescriptor,
  type WorkspaceSummary,
} from "../lib/api";

import { useResource } from "../lib/useResource";
import { describeEvent, excerptOf } from "../lib/events";
import { statusLabel, taskStatusTone, toneClass } from "../lib/tone";
import { profileOf } from "../lib/workforce";

import {
  Connecting,
  Failure,
  Quiet,
  StatusPill,
} from "../components/primitives";

import { AgentMark } from "../components/AgentMark";
import { WorkspaceMark } from "../components/WorkspaceMark";

/**
 * One agent's dossier.
 *
 * Six questions, in the order someone actually asks them: who is this, what
 * can it do, what may it use, where does it work, what is it doing now, and
 * what has it produced. Configuration happens inline against the same answers
 * rather than on a separate settings page, so what you change is next to what
 * it changes.
 */
export default function Agent() {
  const { agentId = "" } = useParams();

  const detail = useResource<AgentDetail>(
    useCallback(() => fetchAgent(agentId), [agentId]),
    { pollMs: 15_000, enabled: Boolean(agentId) },
  );

  // The vocabulary an edit can draw on: real registered tools, real
  // workspaces. Neither moves often, so neither is polled.
  const tools = useResource<ToolDescriptor[]>(useCallback(() => fetchTools(), []));
  const workspaces = useResource<WorkspaceSummary[]>(
    useCallback(() => fetchWorkspaces(), []),
  );

  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [capabilityDraft, setCapabilityDraft] = useState("");
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "paused" | "disabled">(
    "active",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function openEditor() {
    const agent = detail.data?.agent;
    if (!agent) return;

    setDescription(agent.description);
    setCapabilities([...agent.capabilities]);
    setToolIds([...agent.toolIds]);
    setWorkspaceId(agent.workspaceId ?? null);
    setStatus(agent.status);
    setCapabilityDraft("");
    setError(undefined);
    setEditing(true);
  }

  async function save() {
    if (busy) return;

    setBusy(true);
    setError(undefined);

    try {
      await updateAgent(agentId, {
        description: description.trim(),
        capabilities,
        toolIds,
        workspaceId,
        status,
      });
      setEditing(false);
      detail.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addCapability() {
    const value = capabilityDraft.trim().toLowerCase().replace(/\s+/g, "_");
    if (!value || capabilities.includes(value)) {
      setCapabilityDraft("");
      return;
    }

    setCapabilities((current) => [...current, value]);
    setCapabilityDraft("");
  }

  if (detail.loading) {
    return (
      <div className="mx-auto max-w-[1240px]">
        <Connecting what="Opening the dossier…" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="mx-auto max-w-[1240px] pt-4">
        <Failure
          headline="This agent could not be opened"
          detail={detail.error?.message ?? "The API returned nothing for this id."}
          action={
            <>
              <button type="button" onClick={detail.reload} className="button-ghost">
                Try again
              </button>
              <Link to="/agents" className="button-quiet">
                The workforce
              </Link>
            </>
          }
        />
      </div>
    );
  }

  const {
    agent,
    workspace,
    tools: granted,
    unknownToolIds,
    assignments,
    current,
    artifacts,
    activity,
    completedCount,
    failedCount,
  } = detail.data;

  const orchestrator = agent.type === "orchestrator";
  const profile = profileOf(agent);

  return (
    <div className="fade-up">
      <header
        className={`place ${toneClass[current ? "active" : agent.status === "active" ? "live" : "idle"]}`}
      >
        <div className="place-inner">
          <Link to="/agents" className="button-quiet mb-6 inline-flex">
            <ArrowLeft size={12} />
            The workforce
          </Link>

          <span className="place-mark">
            <AgentMark
              agentId={agent.id}
              capabilities={agent.capabilities}
              tools={agent.toolIds.length}
              type={agent.type}
              size={32}
              active={Boolean(current)}
            />
          </span>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="place-name">{agent.name}</h2>

            <StatusPill
              tone={
                current
                  ? "active"
                  : agent.status === "active"
                    ? "live"
                    : "idle"
              }
              pulse={Boolean(current)}
            >
              {current ? "working" : agent.status}
            </StatusPill>
          </div>

          <p className="place-description">{agent.description}</p>

          <div className="place-slug">
            {profile.label} · {agent.type}
            {orchestrator && " · system-critical"}
          </div>

          {workspace ? (
            <Link
              to={`/workspaces/${workspace.id}`}
              className="place-tag mt-5 inline-flex"
            >
              <span className="place-tag-mark">
                <WorkspaceMark slug={workspace.slug} size={16} />
              </span>
              Works in {workspace.name}
            </Link>
          ) : (
            <div className="place-slug !mt-5">
              Belongs to no workspace — available to every mission
            </div>
          )}

          <div className="dispatch-meta !mt-7">
            <Fact label="Completed" value={completedCount} />
            <Fact label="Failed" value={failedCount} />
            <Fact label="Capabilities" value={agent.capabilities.length} />
            <Fact label="Tools" value={agent.toolIds.length} />
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            {!editing && (
              <button type="button" onClick={openEditor} className="button-ghost">
                <Pencil size={12} />
                Configure
              </button>
            )}
          </div>

          {orchestrator && (
            <p className="config-hint mt-4 max-w-[68ch]">
              <ShieldAlert size={11} className="mr-1 inline align-[-1px]" />
              {agent.name} plans and routes every mission in this organization.
              Its capabilities cannot be removed and it cannot be paused while
              it is the only active orchestrator.
            </p>
          )}
        </div>
      </header>

      <div className="dossier">
        <div className="min-w-0">
          {editing ? (
            <div className="config">
              <div className="config-row">
                <label className="config-label" htmlFor="agent-description">
                  What it does
                </label>
                <textarea
                  id="agent-description"
                  value={description}
                  disabled={busy}
                  onChange={(event) => setDescription(event.target.value)}
                  className="config-textarea"
                />
                <p className="config-hint">
                  This becomes part of the instructions the model is given, so
                  it changes how the agent actually works.
                </p>
              </div>

              <div className="config-row">
                <span className="config-label">Capabilities</span>

                <div className="token-set !mt-0">
                  {capabilities.map((capability) => {
                    const locked =
                      orchestrator && agent.capabilities.includes(capability);

                    return (
                      <span
                        key={capability}
                        className={`token${locked ? " config-choice-locked" : ""}`}
                      >
                        {capability}
                        {!locked && (
                          <button
                            type="button"
                            className="token-remove"
                            disabled={busy}
                            aria-label={`Remove ${capability}`}
                            onClick={() =>
                              setCapabilities((current) =>
                                current.filter((value) => value !== capability),
                              )
                            }
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
                  <button
                    type="button"
                    onClick={addCapability}
                    disabled={busy || !capabilityDraft.trim()}
                    className="button-quiet"
                  >
                    <Plus size={12} />
                    Add
                  </button>
                </div>

                <p className="config-hint">
                  Capabilities are the planner's routing vocabulary. A task is
                  given to whoever holds the one it names, so a capability
                  nobody holds is a task nobody can be given.
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
                        onClick={() =>
                          setToolIds((current) =>
                            on
                              ? current.filter((value) => value !== tool.id)
                              : [...current, tool.id],
                          )
                        }
                        className={`config-choice${on ? " config-choice-on" : ""}`}
                      >
                        {on ? <Check size={11} /> : <Wrench size={11} />}
                        {tool.name}
                      </button>
                    );
                  })}
                </div>

                <p className="config-hint">
                  Only tools this build actually registers can be granted. The
                  delegator will not route a task that needs a tool to an agent
                  that does not hold it.
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
                      className={`config-choice${
                        workspaceId === entry.workspace.id
                          ? " config-choice-on"
                          : ""
                      }`}
                    >
                      {entry.workspace.name}
                    </button>
                  ))}
                </div>

                <p className="config-hint">
                  An agent in a workspace can only be given missions opened in
                  that workspace. One belonging to no workspace stays available
                  everywhere.
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
                  <Failure
                    headline="That configuration was not saved"
                    detail={error}
                    consequence="Nothing was changed. The agent is as it was."
                  />
                </div>
              )}

              <div className="config-foot">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || !description.trim() || capabilities.length === 0}
                  className="button-primary"
                >
                  {busy ? "Saving…" : "Save configuration"}
                </button>

                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={busy}
                  className="button-quiet"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="dossier-block">
                <div className="dossier-question">What it can do</div>

                <div className="token-set">
                  {agent.capabilities.map((capability) => (
                    <span key={capability} className="token">
                      {capability}
                    </span>
                  ))}
                </div>

                <p className="dossier-answer">
                  The delegator routes a task here when the plan names one of
                  these, and ranks this agent against everyone else who holds
                  it.
                </p>
              </div>

              <div className="dossier-block">
                <div className="dossier-question">What it may use</div>

                {granted.length === 0 && unknownToolIds.length === 0 ? (
                  <p className="dossier-answer">
                    Holds no tools, so the delegator will never route a task
                    that requires one here. This is a hard boundary, not a
                    preference.
                  </p>
                ) : (
                  <>
                    <div className="token-set">
                      {granted.map((tool) => (
                        <span
                          key={tool.id}
                          className="token token-tool"
                          title={tool.description}
                        >
                          <Wrench size={9} />
                          {tool.name}
                        </span>
                      ))}

                      {unknownToolIds.map((toolId) => (
                        <span key={toolId} className="token token-unknown">
                          {toolId} — no longer registered
                        </span>
                      ))}
                    </div>

                    {unknownToolIds.length > 0 && (
                      <p className="dossier-answer">
                        A grant for a tool this build no longer registers is
                        inert: the runtime cannot call it, so the agent behaves
                        as though it were never granted.
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="dossier-block">
                <div className="dossier-question">What it is doing now</div>

                {current ? (
                  <Link
                    to={`/missions/${current.task.workId}`}
                    className="presence-row mt-3"
                  >
                    <span className="presence-mark tone-active">
                      <AgentMark
                        agentId={agent.id}
                        capabilities={agent.capabilities}
                        tools={agent.toolIds.length}
                        type={agent.type}
                        size={20}
                        active
                      />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-[#f2f4f7]">
                        {current.task.title}
                      </span>
                      <span className="mt-1 block truncate text-[10.5px] text-[#6f7887]">
                        {current.work?.objective ?? "an earlier mission"}
                      </span>
                    </span>

                    <StatusPill tone="active" pulse>
                      running
                    </StatusPill>
                  </Link>
                ) : (
                  <p className="dossier-answer">
                    {agent.status === "active"
                      ? "Nothing right now. Available to be given work."
                      : `Not available — this agent is ${agent.status}.`}
                  </p>
                )}
              </div>

              <div className="dossier-block">
                <div className="dossier-question">What it has done</div>

                {assignments.length === 0 ? (
                  <Quiet
                    line="Nothing has been given to this agent yet."
                    detail="Every task delegated here appears in this list, with the mission it belonged to."
                  />
                ) : (
                  <div className="mission-board mt-3">
                    {assignments.slice(0, 12).map((assignment) => (
                      <Link
                        key={assignment.task.id}
                        to={`/missions/${assignment.task.workId}`}
                        className={`mission-step ${toneClass[taskStatusTone(assignment.task.status)]} block !border-b`}
                      >
                        <div className="mission-step-head !grid">
                          <span className="mission-step-rail" />
                          <span className="mission-step-index">
                            {assignment.task.status === "completed"
                              ? "✓"
                              : assignment.task.status === "failed"
                                ? "✕"
                                : "·"}
                          </span>

                          <span className="min-w-0">
                            <span className="mission-step-title block">
                              {assignment.task.title}
                            </span>
                            <span className="mission-step-meta">
                              <span className="truncate">
                                {assignment.work?.objective ??
                                  "an earlier mission"}
                              </span>
                              <span>
                                {formatRelativeTime(
                                  assignment.task.completedAt ??
                                    assignment.task.updatedAt,
                                )}
                              </span>
                            </span>
                          </span>

                          <span className="pt-0.5">
                            <StatusPill
                              tone={taskStatusTone(assignment.task.status)}
                            >
                              {statusLabel(assignment.task.status)}
                            </StatusPill>
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
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
            <p className="t-meta py-2">
              This agent has not produced an artifact yet.
            </p>
          ) : (
            <div className="space-y-px">
              {artifacts.slice(0, 6).map((artifact) => (
                <Link
                  key={artifact.id}
                  to={`/missions/${artifact.workId}`}
                  className="presence-row"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] text-[#f2f4f7]">
                      {artifact.name}
                    </span>
                    {artifact.metadata.content !== undefined && (
                      <span className="mt-1 block truncate text-[10px] text-[#6f7887]">
                        {excerptOf(artifact.metadata.content, 80)}
                      </span>
                    )}
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
            <div className="scroll-area max-h-[360px] pr-1">
              {activity.slice(0, 20).map((event) => {
                const described = describeEvent(event);

                return (
                  <div key={event.id} className="stream-row">
                    <CircleDot
                      size={9}
                      className={`stream-dot ${described.tone}`}
                    />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] text-[#a7b0bd]">
                        {described.title}
                      </span>
                    </span>

                    <span className="t-machine shrink-0">
                      {formatRelativeTime(event.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
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
