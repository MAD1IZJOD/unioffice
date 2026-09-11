import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchAgents,
  fetchArtifacts,
  formatRelativeTime,
  type AgentSummary,
  type ArtifactItem,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  Chapter,
  Chip,
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
} from "../components/primitives";

import { ArtifactSheet } from "../components/ArtifactSheet";
import { excerptOf } from "../lib/events";

import { agentNamed } from "../lib/workforce";

/** Artifacts made on the same day belong together, newest day first. */
function groupByDay(artifacts: ArtifactItem[]) {
  const groups = new Map<string, ArtifactItem[]>();

  for (const artifact of artifacts) {
    const day = new Date(artifact.createdAt).toDateString();
    groups.set(day, [...(groups.get(day) ?? []), artifact]);
  }

  return [...groups.entries()];
}

export default function Artifacts() {
  const artifacts = useResource<ArtifactItem[]>(
    useCallback(() => fetchArtifacts(60), []),
    { pollMs: 30_000 },
  );

  // The roster is static enough to read once; it exists here only so an
  // artifact can name the worker that made it instead of showing an id.
  const agents = useResource<AgentSummary[]>(useCallback(() => fetchAgents(), []));

  const [open, setOpen] = useState<ArtifactItem>();

  const items = useMemo(() => artifacts.data ?? [], [artifacts.data]);
  const days = useMemo(() => groupByDay(items), [items]);

  const makers = useMemo(() => {
    const counts = new Map<string, number>();

    for (const artifact of items) {
      if (!artifact.createdByAgentId) continue;
      counts.set(
        artifact.createdByAgentId,
        (counts.get(artifact.createdByAgentId) ?? 0) + 1,
      );
    }

    return counts;
  }, [items]);

  const nameOf = (id?: string) => agentNamed(agents.data ?? [], id);

  return (
    <div className="mx-auto max-w-[1180px] fade-up">
      <PageOpening
        eyebrow="Outputs"
        title="WHAT THE COMPANY"
        lead="HAS PRODUCED."
        detail="Everything a completed task stored, kept after the run that made it has finished. Open one and you get the output itself, not its database row."
        tone={items.length > 0 ? "moving" : "quiet"}
        meta={
          <>
            <Reading
              label="Artifacts"
              value={artifacts.loading ? "—" : items.length}
              tone="live"
              live={items.length > 0}
            />
            <Reading
              label="Makers"
              value={artifacts.loading ? "—" : makers.size}
              tone="active"
            />
          </>
        }
      />

      {artifacts.loading ? (
        <Connecting what="Opening the output archive…" />
      ) : artifacts.error ? (
        <Failure
          headline={
            artifacts.error.isOffline
              ? "The company is unreachable"
              : "The archive could not be read"
          }
          detail={artifacts.error.message}
          consequence="Nothing is lost — artifacts are rows, not something this page holds."
          action={
            <button
              type="button"
              onClick={artifacts.reload}
              className="button-ghost"
            >
              Try again
            </button>
          }
        />
      ) : items.length === 0 ? (
        <Quiet
          line="Nothing has been produced yet."
          detail="A task stores its result as a durable artifact the moment it completes. Run an objective and whatever it makes is shelved here."
          action={
            <Link to="/command" className="button-primary">
              Give the company an objective
            </Link>
          }
        />
      ) : (
        days.map(([day, group], index) => (
          <div key={day}>
            <Chapter
              index={String(index + 1).padStart(2, "0")}
              title={
                new Date(day).toDateString() === new Date().toDateString()
                  ? "Today"
                  : new Date(day).toLocaleDateString(undefined, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })
              }
              action={
                <span className="t-machine">
                  {group.length} {group.length === 1 ? "output" : "outputs"}
                </span>
              }
            />

            <div className="workbench">
              {group.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  className="artifact-tile"
                  onClick={() => setOpen(artifact)}
                  aria-label={`Open ${artifact.name}`}
                >
                  <span className="artifact-tile-name">{artifact.name}</span>

                  <span className="artifact-tile-excerpt">
                    {artifact.metadata.content !== undefined
                      ? excerptOf(artifact.metadata.content, 200)
                      : (artifact.description ?? "No inline content recorded.")}
                  </span>

                  <span className="artifact-tile-foot">
                    <Chip tone="live">{artifact.type}</Chip>

                    <span className="t-machine truncate">
                      {nameOf(artifact.createdByAgentId) ??
                        formatRelativeTime(artifact.createdAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      {open && (
        <ArtifactSheet
          artifact={open}
          producedBy={nameOf(open.createdByAgentId)}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  );
}
