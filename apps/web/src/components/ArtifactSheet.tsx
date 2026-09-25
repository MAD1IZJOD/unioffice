import { X } from "lucide-react";

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  deriveKnowledgeFromArtifact,
  formatRelativeTime,
  type ArtifactItem,
  type CaptureReport,
} from "../lib/api";

import { ResultBody } from "./ResultBody";
import { Chip } from "./primitives";

/**
 * Opening an artifact.
 *
 * An artifact is a thing the company made, so looking at one should feel like
 * walking into it rather than unfolding a table row: the shelf recedes and the
 * output itself takes the surface, with the database facts demoted to a strip
 * along the bottom where they belong.
 */
export function ArtifactSheet({
  artifact,
  producedBy,
  onClose,
}: {
  artifact: ArtifactItem;
  /** The agent that made it, when the surface knows who that was. */
  producedBy?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const content = artifact.metadata.content;

  const [learning, setLearning] = useState(false);
  const [report, setReport] = useState<CaptureReport>();
  const [learnError, setLearnError] = useState<string>();

  async function learn() {
    setLearning(true);
    setLearnError(undefined);

    try {
      setReport(await deriveKnowledgeFromArtifact(artifact.id));
    } catch (error) {
      setLearnError((error as Error).message);
    } finally {
      setLearning(false);
    }
  }

  return (
    <div
      className="sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={artifact.name}
      onClick={onClose}
    >
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-head">
          <div className="min-w-0">
            <div className="t-eyebrow mb-2.5">Produced</div>
            <h2 className="sheet-title">{artifact.name}</h2>

            {artifact.description && (
              <p className="mt-2.5 max-w-[62ch] text-(length:--text-sm) leading-[1.7] text-ink-secondary">
                {artifact.description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="icon-button shrink-0"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </header>

        <div className="sheet-body">
          {content === undefined ? (
            <p className="t-meta">
              This artifact recorded no inline content. Its metadata is below.
            </p>
          ) : (
            <ResultBody value={content} />
          )}

          {report && (
            <div className="callout mt-6">
              <div className="detail-label mb-2">What the company took from this</div>
              {report.skipped ? (
                <p>{report.skipped}</p>
              ) : report.created.length === 0 ? (
                <p>
                  Nothing durable enough to keep.
                  {report.duplicates.length > 0 && ` ${report.duplicates.length} already known.`}
                  {report.rejected.length > 0 && ` ${report.rejected.length} suggestion${report.rejected.length === 1 ? " was" : "s were"} refused: ${report.rejected[0]!.reason}`}
                </p>
              ) : (
                <>
                  <p className="mb-2">
                    {report.created.length} proposed — recalled as unverified leads until a person approves them.
                  </p>
                  {report.created.map((item) => (
                    <Link key={item.id} to={`/brain/${item.id}`} className="block py-1 text-blue-ink" onClick={onClose}>
                      {item.title}
                    </Link>
                  ))}
                  {report.rejected.length > 0 && (
                    <p className="t-meta mt-2">
                      {report.rejected.length} other suggestion{report.rejected.length === 1 ? " was" : "s were"} refused.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {learnError && (
            <div className="callout callout-error mt-6">{learnError}</div>
          )}
        </div>

        <footer className="sheet-foot">
          <Chip tone="live">{artifact.type}</Chip>

          <span className="t-machine">v{artifact.version}</span>

          {producedBy && <span className="t-machine">by {producedBy}</span>}

          <span className="t-machine">
            {formatRelativeTime(artifact.createdAt)}
          </span>

          {content !== undefined && !report && (
            <button
              type="button"
              className="button-ghost"
              disabled={learning}
              onClick={() => void learn()}
              title="Reads the artifact and proposes durable knowledge, each item linked back here"
            >
              {learning ? "Reading…" : "Learn from this"}
            </button>
          )}

          {artifact.workId && (
            <Link
              to={`/missions/${artifact.workId}`}
              className="button-quiet ml-auto"
              onClick={onClose}
            >
              Open the mission that produced this
            </Link>
          )}
        </footer>
      </div>
    </div>
  );
}
