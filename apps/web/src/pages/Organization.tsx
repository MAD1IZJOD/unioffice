import { ArrowRight, CircleDot, Plus, Users } from "lucide-react";

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import {
  createWorkspace,
  fetchOrganization,
  formatRelativeTime,
  type OrganizationOverview,
  type WorkspaceSummary,
} from "../lib/api";

import { useResource } from "../lib/useResource";
import { describeEvent } from "../lib/events";
import { toneClass, type Tone } from "../lib/tone";

import {
  Chapter,
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
} from "../components/primitives";

import { WorkspaceMark } from "../components/WorkspaceMark";

/**
 * The company itself.
 *
 * Mission answers what the company is doing; this answers what the company
 * is. Every number here is counted from real rows - workspaces, agents, work -
 * so an organization that has never been configured reads as empty rather
 * than as a dashboard full of zeroes pretending to be a product.
 */

/** A workspace with work in flight is live; one with a workforce is settled. */
function toneOf(summary: WorkspaceSummary): Tone {
  if (summary.workspace.status === "archived") return "idle";
  if (summary.activeWorkCount > 0) return "active";
  if (summary.agentCount > 0) return "live";
  return "idle";
}

export default function Organization() {
  const organization = useResource<OrganizationOverview>(
    useCallback(() => fetchOrganization(), []),
    { pollMs: 30_000 },
  );

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(undefined);

    try {
      await createWorkspace({ name: trimmed, description });
      setName("");
      setDescription("");
      setCreating(false);
      organization.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const data = organization.data;
  const workspaces = data?.workspaces ?? [];
  const active = workspaces.filter(
    (entry) => entry.workspace.status === "active",
  );

  if (organization.error) {
    return (
      <div className="mx-auto max-w-[1240px] pt-6">
        <Failure
          headline={
            organization.error.isOffline
              ? "The company is unreachable"
              : "The organization could not be read"
          }
          detail={organization.error.message}
          consequence={
            organization.error.isOffline
              ? "Nothing is lost - missions already queued keep running on the worker."
              : "Nothing was changed by this request."
          }
          action={
            <button
              type="button"
              onClick={organization.reload}
              className="button-ghost"
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="fade-up">
      <PageOpening
        eyebrow="Workforce"
        title={data ? data.organization.name.toUpperCase() : "THE COMPANY"}
        lead={
          active.length === 0
            ? "ONE FLOOR, NO DIVISIONS."
            : active.length === 1
              ? "ONE WORKSPACE."
              : `${active.length} WORKSPACES.`
        }
        detail="A workspace scopes who can be given work inside it. The planner and the delegator both treat it as a hard boundary, so this is org design rather than filing."
        tone={(data?.activeWorkCount ?? 0) > 0 ? "moving" : "quiet"}
        meta={
          <>
            <Reading
              label="Workspaces"
              value={organization.loading ? "—" : active.length}
              tone="idle"
            />
            <Reading
              label="Workforce"
              value={organization.loading ? "—" : (data?.agentCount ?? 0)}
              tone="idle"
            />
            <Reading
              label="Missions run"
              value={organization.loading ? "—" : (data?.workCount ?? 0)}
              tone="idle"
            />
            <Reading
              label="In flight"
              value={organization.loading ? "—" : (data?.activeWorkCount ?? 0)}
              tone="active"
              live={(data?.activeWorkCount ?? 0) > 0}
            />
          </>
        }
      />

      <div className="mx-auto max-w-[1240px]">
        <Chapter
          index="01"
          title="Workspaces"
          action={
            <Link to="/agents" className="button-quiet">
              The whole workforce
              <ArrowRight size={11} />
            </Link>
          }
        />

        {creating && (
          <div className="config mb-4">
            <div className="config-row">
              <label className="config-label" htmlFor="workspace-name">
                Name
              </label>
              <input
                id="workspace-name"
                autoFocus
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void create();
                }}
                placeholder="Engineering"
                className="config-input"
              />
            </div>

            <div className="config-row">
              <label className="config-label" htmlFor="workspace-description">
                What happens here
              </label>
              <textarea
                id="workspace-description"
                value={description}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional. What this part of the company is responsible for."
                className="config-textarea"
              />
            </div>

            {error && (
              <div className="mt-4">
                <Failure
                  headline="That workspace was not created"
                  detail={error}
                  consequence="Nothing was changed."
                />
              </div>
            )}

            <div className="config-foot">
              <button
                type="button"
                onClick={create}
                disabled={!name.trim() || busy}
                className="button-primary"
              >
                {busy ? "Creating…" : "Create workspace"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setError(undefined);
                }}
                disabled={busy}
                className="button-quiet"
              >
                Cancel
              </button>

              <span className="config-hint !mt-0">
                Agents and missions can then be scoped to it.
              </span>
            </div>
          </div>
        )}

        {organization.loading ? (
          <Connecting what="Reading the company…" />
        ) : workspaces.length === 0 && !creating ? (
          <Quiet
            line="The company has no workspaces."
            detail="Everyone works on one undivided floor, and every agent is available to every mission. Create a workspace to scope a part of the company — who works there, and which missions run inside it."
            action={
              <button
                type="button"
                className="button-primary"
                onClick={() => setCreating(true)}
              >
                <Plus size={13} />
                Create the first workspace
              </button>
            }
          />
        ) : (
          <div className="plate-grid">
            {workspaces.map((entry) => (
              <Link
                key={entry.workspace.id}
                to={`/workspaces/${entry.workspace.id}`}
                className={`plate ${toneClass[toneOf(entry)]}${
                  entry.activeWorkCount > 0 ? " plate-live" : ""
                }`}
              >
                <div className="plate-head">
                  <span className="plate-mark">
                    <WorkspaceMark
                      slug={entry.workspace.slug}
                      members={entry.agentCount}
                      size={24}
                      active={entry.activeWorkCount > 0}
                    />
                  </span>

                  {entry.workspace.status === "archived" && (
                    <span className="t-machine">ARCHIVED</span>
                  )}
                </div>

                <div className="plate-name">{entry.workspace.name}</div>

                {entry.workspace.description ? (
                  <div className="plate-description">
                    {entry.workspace.description}
                  </div>
                ) : (
                  <div className="plate-empty-note">
                    No description yet.
                  </div>
                )}

                <div className="plate-foot">
                  <span>
                    {entry.agentCount === 0
                      ? "no one assigned"
                      : `${entry.agentCount} ${entry.agentCount === 1 ? "agent" : "agents"}`}
                  </span>

                  <span>
                    {entry.workCount === 0
                      ? "no missions"
                      : `${entry.workCount} ${entry.workCount === 1 ? "mission" : "missions"}`}
                  </span>

                  {entry.activeWorkCount > 0 && (
                    <span className="plate-foot-live">
                      {entry.activeWorkCount} in flight
                    </span>
                  )}
                </div>
              </Link>
            ))}

            {!creating && (
              <button
                type="button"
                className="plate plate-new"
                onClick={() => setCreating(true)}
              >
                <span className="plate-new-mark">
                  <Plus size={16} />
                </span>
                <span className="plate-name">New workspace</span>
                <span className="plate-description">
                  Scope a part of the company: who works there, and which
                  missions run inside it.
                </span>
              </button>
            )}
          </div>
        )}

        {(data?.unassignedAgentCount ?? 0) > 0 && workspaces.length > 0 && (
          <Link to="/agents" className="presence-row mt-4 !border-0">
            <span className="presence-mark tone-idle">
              <Users size={14} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-[#f2f4f7]">
                {data!.unassignedAgentCount} on the roster belong to no
                workspace
              </span>
              <span className="mt-0.5 block text-[10.5px] text-[#6f7887]">
                An unscoped agent stays available to every workspace, which is
                right for an orchestrator and usually not for a specialist.
              </span>
            </span>

            <ArrowRight size={13} className="shrink-0 text-[#535b68]" />
          </Link>
        )}

        <Chapter
          index="02"
          title="Lately"
          action={
            <Link to="/activity" className="button-quiet">
              Full history
            </Link>
          }
        />

        {organization.loading ? (
          <Connecting what="Reading the log…" />
        ) : (data?.activity.length ?? 0) === 0 ? (
          <Quiet
            line="Nothing has happened yet."
            detail="Every workspace created, agent configured, plan written and tool called is recorded here as it happens."
          />
        ) : (
          <div className="space-y-px">
            {data!.activity.slice(0, 12).map((event) => {
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
                    {described.detail && (
                      <span className="mt-0.5 block truncate text-[9.5px] text-[#535b68]">
                        {described.detail}
                      </span>
                    )}
                  </span>

                  <span className="t-machine shrink-0">
                    {formatRelativeTime(event.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
