import {
  ArrowLeft,
  ArrowRight,
  CircleDot,
  Pencil,
  Plus,
  Zap,
} from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  fetchWorkspace,
  formatRelativeTime,
  updateWorkspace,
  type WorkspaceDetail,
} from "../lib/api";

import { useResource } from "../lib/useResource";
import { describeEvent, excerptOf } from "../lib/events";
import { statusLabel, toneClass, workStatusTone } from "../lib/tone";
import { profileOf } from "../lib/workforce";

import {
  Chapter,
  Connecting,
  Failure,
  Quiet,
  StatusPill,
} from "../components/primitives";

import { AgentMark } from "../components/AgentMark";
import { WorkspaceMark } from "../components/WorkspaceMark";

/**
 * One workspace, read as a place.
 *
 * The three things it has to answer are who works here, what is running here,
 * and what has been made here - and all three are genuinely scoped: the
 * agents come from a workspace-scoped query, the missions from another, and
 * the artifacts and activity are the output of those missions rather than the
 * organization's filtered down to look like it.
 */
export default function Workspace() {
  const { workspaceId = "" } = useParams();

  const detail = useResource<WorkspaceDetail>(
    useCallback(() => fetchWorkspace(workspaceId), [workspaceId]),
    { pollMs: 20_000, enabled: Boolean(workspaceId) },
  );

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function openEditor() {
    if (!detail.data) return;
    setName(detail.data.workspace.name);
    setDescription(detail.data.workspace.description ?? "");
    setError(undefined);
    setEditing(true);
  }

  async function save() {
    if (busy) return;

    setBusy(true);
    setError(undefined);

    try {
      await updateWorkspace(workspaceId, {
        name: name.trim(),
        description: description.trim() || null,
      });
      setEditing(false);
      detail.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "active" | "archived") {
    setBusy(true);
    setError(undefined);

    try {
      await updateWorkspace(workspaceId, { status });
      detail.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (detail.loading) {
    return (
      <div className="mx-auto max-w-[1240px]">
        <Connecting what="Opening the workspace…" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="mx-auto max-w-[1240px] pt-4">
        <Failure
          headline="This workspace could not be opened"
          detail={detail.error?.message ?? "The API returned nothing for this id."}
          action={
            <>
              <button
                type="button"
                onClick={detail.reload}
                className="button-ghost"
              >
                Try again
              </button>
              <Link to="/organization" className="button-quiet">
                The company
              </Link>
            </>
          }
        />
      </div>
    );
  }

  const { workspace, agents, work, artifacts, activity } = detail.data;
  const running = work.filter(
    (item) =>
      item.status === "executing" ||
      item.status === "queued" ||
      item.status === "planning" ||
      item.status === "waiting_approval",
  );

  return (
    <div className="fade-up">
      <header
        className={`place ${toneClass[running.length > 0 ? "active" : "idle"]}`}
      >
        <div className="place-inner">
          <Link to="/organization" className="button-quiet mb-6 inline-flex">
            <ArrowLeft size={12} />
            The company
          </Link>

          <span className="place-mark">
            <WorkspaceMark
              slug={workspace.slug}
              members={agents.length}
              size={32}
              active={running.length > 0}
            />
          </span>

          <h2 className="place-name">{workspace.name}</h2>

          {workspace.description ? (
            <p className="place-description">{workspace.description}</p>
          ) : (
            <p className="place-description text-[#535b68] italic">
              This workspace has no description yet.
            </p>
          )}

          <div className="place-slug">
            {workspace.slug}
            {workspace.status === "archived" && " · archived"}
          </div>

          <div className="dispatch-meta !mt-7">
            <Fact label="Workforce" value={agents.length} />
            <Fact label="Missions" value={work.length} />
            <Fact label="In flight" value={running.length} />
            <Fact label="Artifacts" value={artifacts.length} />
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <Link
              to={`/missions/new?workspace=${workspace.id}`}
              className="button-primary"
            >
              <Zap size={13} />
              Open a mission here
            </Link>

            <button type="button" onClick={openEditor} className="button-quiet">
              <Pencil size={12} />
              Edit
            </button>

            {workspace.status === "active" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStatus("archived")}
                className="button-quiet"
              >
                Archive
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStatus("active")}
                className="button-quiet"
              >
                Restore
              </button>
            )}
          </div>

          {editing && (
            <div className="config mt-5 max-w-[620px]">
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
                  className="config-textarea"
                />
              </div>

              <div className="config-foot">
                <button
                  type="button"
                  onClick={save}
                  disabled={!name.trim() || busy}
                  className="button-primary"
                >
                  {busy ? "Saving…" : "Save"}
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
          )}

          {error && (
            <div className="mt-4 max-w-[620px]">
              <Failure
                headline="That change did not go through"
                detail={error}
                consequence="Nothing was changed."
              />
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1240px]">
        <Chapter
          index="01"
          title="Who works here"
          action={
            <Link to="/agents" className="button-quiet">
              The whole workforce
              <ArrowRight size={11} />
            </Link>
          }
        />

        {agents.length === 0 ? (
          <Quiet
            line="No one is assigned to this workspace."
            detail="A mission opened here can still run — an agent belonging to no workspace stays available everywhere — but nothing is scoped to this place yet. Assign someone from their own page."
            action={
              <Link to="/agents" className="button-ghost">
                <Plus size={13} />
                Assign someone
              </Link>
            }
          />
        ) : (
          <div className="crew">
            {agents.map((agent) => (
              <Link
                key={agent.id}
                to={`/agents/${agent.id}`}
                className={`crew-member ${toneClass[agent.status === "active" ? "live" : "idle"]}`}
              >
                <div className="crew-head">
                  <span className="crew-mark">
                    <AgentMark
                      agentId={agent.id}
                      capabilities={agent.capabilities}
                      tools={agent.toolIds.length}
                      type={agent.type}
                      size={22}
                    />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="crew-name block">{agent.name}</span>
                    <span className="crew-role block">
                      {profileOf(agent).label}
                    </span>
                  </span>

                  {agent.status !== "active" && (
                    <StatusPill tone="idle">{agent.status}</StatusPill>
                  )}
                </div>

                <p className="crew-description">{agent.description}</p>

                <div className="crew-place">
                  <span>
                    {agent.capabilities.length}{" "}
                    {agent.capabilities.length === 1
                      ? "capability"
                      : "capabilities"}
                  </span>
                  <span>
                    {agent.toolIds.length === 0
                      ? "no tools"
                      : `${agent.toolIds.length} ${agent.toolIds.length === 1 ? "tool" : "tools"}`}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <Chapter
          index="02"
          title="What is running here"
          action={
            <Link to="/missions" className="button-quiet">
              Every mission
            </Link>
          }
        />

        {work.length === 0 ? (
          <Quiet
            line="No mission has been opened in this workspace."
            detail="A mission opened here is scoped to it: only agents in this workspace, or agents belonging to no workspace at all, can be given any of the work."
            action={
              <Link
                to={`/missions/new?workspace=${workspace.id}`}
                className="button-primary"
              >
                <Zap size={13} />
                Open one here
              </Link>
            }
          />
        ) : (
          <div className="mission-stack">
            {work.slice(0, 12).map((item) => (
              <Link
                key={item.id}
                to={`/missions/${item.id}`}
                className={`mission-entry ${toneClass[workStatusTone(item.status)]}`}
              >
                <span className="mission-entry-rail" />

                <span className="min-w-0">
                  <span className="mission-entry-objective">
                    {item.objective}
                  </span>

                  <span className="mission-entry-meta">
                    <span>{formatRelativeTime(item.createdAt)}</span>
                    <span className="uppercase">{item.priority}</span>
                  </span>
                </span>

                <span className="mission-entry-status">
                  <StatusPill
                    tone={workStatusTone(item.status)}
                    pulse={item.status === "executing"}
                  >
                    {statusLabel(item.status)}
                  </StatusPill>
                </span>
              </Link>
            ))}
          </div>
        )}

        <div className="grid gap-x-9 lg:grid-cols-2">
          <div className="min-w-0">
            <Chapter index="03" title="Made here" />

            {artifacts.length === 0 ? (
              <Quiet
                line="Nothing has been produced here yet."
                detail="A task stores its result the moment it completes, and it appears here."
              />
            ) : (
              <div className="space-y-px">
                {artifacts.slice(0, 8).map((artifact) => (
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
                          {excerptOf(artifact.metadata.content, 90)}
                        </span>
                      )}
                    </span>

                    <span className="t-machine shrink-0">
                      {formatRelativeTime(artifact.createdAt)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <Chapter index="04" title="What happened here" />

            {activity.length === 0 ? (
              <Quiet
                line="Nothing has been recorded here."
                detail="Every plan, delegation and tool call inside this workspace lands here."
              />
            ) : (
              <div className="scroll-area max-h-[340px] pr-1">
                {activity.slice(0, 16).map((event) => {
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
          </div>
        </div>
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
