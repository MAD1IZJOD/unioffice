import { Check, Plus, ShieldAlert, Wrench, X } from "lucide-react";

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  createAgent,
  fetchOverview,
  fetchTools,
  fetchWorkspaces,
  type AgentPresenceSummary,
  type AgentSummary,
  type CompanyOverview,
  type ToolDescriptor,
  type WorkspaceSummary,
} from "../lib/api";

import { useResource } from "../lib/useResource";
import { presenceTone, toneClass } from "../lib/tone";
import { spellOut } from "../lib/statement";
import { groupByDiscipline, profileOf } from "../lib/workforce";

import {
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
  StatusPill,
} from "../components/primitives";

import { AgentMark } from "../components/AgentMark";
import { WorkspaceMark } from "../components/WorkspaceMark";

/**
 * The workforce.
 *
 * A roster of people rather than a grid of avatar cards: each entry says what
 * the agent does, where it works and what it is holding right now, and leads
 * to its own dossier. Everyone here comes from the database - there is no
 * hard-coded list of six names anywhere in this file.
 */
export default function Agents() {
  const overview = useResource<CompanyOverview>(
    useCallback(() => fetchOverview(60), []),
    { pollMs: 15_000 },
  );

  const workspaces = useResource<WorkspaceSummary[]>(
    useCallback(() => fetchWorkspaces(), []),
  );
  const tools = useResource<ToolDescriptor[]>(useCallback(() => fetchTools(), []));

  const [hiring, setHiring] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<AgentSummary["type"]>("specialist");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [capabilityDraft, setCapabilityDraft] = useState("");
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const agents = useMemo(() => overview.data?.agents ?? [], [overview.data]);
  const working = agents.filter((agent) => agent.presence === "working");
  const groups = useMemo(() => groupByDiscipline(agents), [agents]);

  const workspaceById = useMemo(() => {
    const map = new Map<string, WorkspaceSummary["workspace"]>();
    for (const entry of workspaces.data ?? []) {
      map.set(entry.workspace.id, entry.workspace);
    }
    return map;
  }, [workspaces.data]);

  function addCapability() {
    const value = capabilityDraft.trim().toLowerCase().replace(/\s+/g, "_");
    if (!value || capabilities.includes(value)) {
      setCapabilityDraft("");
      return;
    }
    setCapabilities((current) => [...current, value]);
    setCapabilityDraft("");
  }

  function resetForm() {
    setName("");
    setDescription("");
    setType("specialist");
    setCapabilities([]);
    setCapabilityDraft("");
    setToolIds([]);
    setWorkspaceId(null);
    setError(undefined);
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
      resetForm();
      setHiring(false);
      overview.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    capabilities.length > 0;

  return (
    <div className="mx-auto max-w-[1240px] fade-up">
      <PageOpening
        eyebrow="Workforce"
        title={
          overview.loading
            ? "THE WORKFORCE."
            : `${spellOut(agents.length)} WORKERS.`
        }
        lead={
          working.length > 0
            ? `${spellOut(working.length)} AT WORK.`
            : "ALL STANDING BY."
        }
        detail="Each holds a different set of capabilities and a different set of tools, and the delegator routes on exactly those two facts."
        tone={working.length > 0 ? "moving" : "quiet"}
        action={
          !hiring && (
            <button
              type="button"
              className="button-primary"
              onClick={() => setHiring(true)}
            >
              <Plus size={13} />
              Add an agent
            </button>
          )
        }
        meta={
          <>
            <Reading
              label="On the roster"
              value={overview.loading ? "—" : agents.length}
              tone="idle"
            />
            <Reading
              label="Working"
              value={overview.loading ? "—" : working.length}
              tone="active"
              live={working.length > 0}
            />
            <Reading
              label="Available"
              value={
                overview.loading
                  ? "—"
                  : agents.filter((agent) => agent.presence === "available")
                      .length
              }
              tone="live"
            />
            <Reading
              label="Tool grants"
              value={
                overview.loading
                  ? "—"
                  : agents.reduce(
                      (total, agent) => total + agent.toolIds.length,
                      0,
                    )
              }
              tone="idle"
            />
          </>
        }
      />

      {hiring && (
        <div className="config mb-6">
          <div className="config-row">
            <label className="config-label" htmlFor="agent-name">
              Name
            </label>
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
            <label className="config-label" htmlFor="agent-description">
              What it does
            </label>
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
              {(["specialist", "manager", "orchestrator"] as const).map(
                (value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={busy}
                    onClick={() => setType(value)}
                    className={`config-choice${type === value ? " config-choice-on" : ""}`}
                  >
                    {value}
                  </button>
                ),
              )}
            </div>

            {type === "orchestrator" && (
              <p className="config-hint">
                <ShieldAlert size={11} className="mr-1 inline align-[-1px]" />
                An orchestrator plans and routes work. This organization already
                has one, and a second is only useful if you intend to scope them
                to different workspaces.
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
                    onClick={() =>
                      setCapabilities((current) =>
                        current.filter((value) => value !== capability),
                      )
                    }
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
              At least one. These are what the planner names when it writes a
              task, so an agent with no capability can never be given work.
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
                    workspaceId === entry.workspace.id ? " config-choice-on" : ""
                  }`}
                >
                  {entry.workspace.name}
                </button>
              ))}
            </div>

            {(workspaces.data?.length ?? 0) === 0 && (
              <p className="config-hint">
                No workspaces exist yet, so this agent will be available
                everywhere.{" "}
                <Link to="/organization" className="underline">
                  Create one
                </Link>
                .
              </p>
            )}
          </div>

          {error && (
            <div className="mt-5">
              <Failure
                headline="That agent was not created"
                detail={error}
                consequence="Nothing was changed."
              />
            </div>
          )}

          <div className="config-foot">
            <button
              type="button"
              onClick={hire}
              disabled={!ready || busy}
              className="button-primary"
            >
              {busy ? "Creating…" : "Add to the workforce"}
            </button>

            <button
              type="button"
              onClick={() => {
                setHiring(false);
                resetForm();
              }}
              disabled={busy}
              className="button-quiet"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {overview.loading ? (
        <Connecting what="Loading the workforce…" />
      ) : overview.error ? (
        <Failure
          headline={
            overview.error.isOffline
              ? "The company is unreachable"
              : "The roster could not be read"
          }
          detail={overview.error.message}
          action={
            <button
              type="button"
              onClick={overview.reload}
              className="button-ghost"
            >
              Try again
            </button>
          }
        />
      ) : agents.length === 0 ? (
        <Quiet
          line="No one has been hired."
          detail="Add an agent, or run the API with SEED_DEVELOPMENT_WORKFORCE=true and the starting workforce is created on boot."
          action={
            <button
              type="button"
              className="button-primary"
              onClick={() => setHiring(true)}
            >
              <Plus size={13} />
              Add the first agent
            </button>
          }
        />
      ) : (
        groups.map((group) => (
          <section key={group.discipline} className="mb-8">
            <div className="discipline-head">
              <span className="discipline-name">{group.profile.label}</span>
              <span className="discipline-role">{group.profile.role}</span>
              <span className="discipline-rule" />
              <span className="t-machine">{group.members.length}</span>
            </div>

            <div className="crew">
              {group.members.map((agent) => (
                <Member
                  key={agent.agentId}
                  agent={agent}
                  workspace={
                    agent.workspaceId
                      ? workspaceById.get(agent.workspaceId)
                      : undefined
                  }
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Member({
  agent,
  workspace,
}: {
  agent: AgentPresenceSummary;
  workspace?: WorkspaceSummary["workspace"];
}) {
  const tone = presenceTone(agent.presence);

  return (
    <Link to={`/agents/${agent.agentId}`} className={`crew-member ${toneClass[tone]}`}>
      <div className="crew-head">
        <span className="crew-mark">
          <AgentMark
            agentId={agent.agentId}
            capabilities={agent.capabilities}
            tools={agent.toolIds.length}
            type={agent.type}
            size={22}
            active={agent.presence === "working"}
          />
        </span>

        <span className="min-w-0 flex-1">
          <span className="crew-name block">{agent.name}</span>
          <span className="crew-role block">{profileOf(agent).label}</span>
        </span>

        <StatusPill tone={tone} pulse={agent.presence === "working"}>
          {agent.presence}
        </StatusPill>
      </div>

      <p className="crew-description">{agent.description}</p>

      {agent.activeTask && (
        <p className="crew-doing">{agent.activeTask.title}</p>
      )}

      <div className="crew-foot">
        {agent.toolIds.length === 0 ? (
          <span className="token">holds no tools</span>
        ) : (
          agent.toolIds.map((tool) => (
            <span key={tool} className="token token-tool">
              {tool}
            </span>
          ))
        )}
      </div>

      <div className="crew-place">
        {workspace ? (
          <span className="inline-flex items-center gap-1.5">
            <WorkspaceMark slug={workspace.slug} size={11} />
            {workspace.name}
          </span>
        ) : (
          <span>everywhere</span>
        )}

        <span>{agent.completedTaskCount} done</span>

        {agent.failedTaskCount > 0 && (
          <span>{agent.failedTaskCount} failed</span>
        )}
      </div>
    </Link>
  );
}
