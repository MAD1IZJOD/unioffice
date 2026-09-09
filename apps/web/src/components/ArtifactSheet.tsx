import { X } from "lucide-react";

import { useEffect } from "react";
import { Link } from "react-router-dom";

import { formatRelativeTime, type ArtifactItem } from "../lib/api";

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
              <p className="mt-2.5 max-w-[62ch] text-[11.5px] leading-[1.7] text-[#a7b0bd]">
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
        </div>

        <footer className="sheet-foot">
          <Chip tone="live">{artifact.type}</Chip>

          <span className="t-machine">v{artifact.version}</span>

          {producedBy && <span className="t-machine">by {producedBy}</span>}

          <span className="t-machine">
            {formatRelativeTime(artifact.createdAt)}
          </span>

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
