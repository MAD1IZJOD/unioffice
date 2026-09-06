import { FileOutput } from "lucide-react";

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchArtifacts,
  formatRelativeTime,
  type ArtifactItem,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import { safeStringify } from "../lib/events";

import {
  Chip,
  PageOpening,
  Reading,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
} from "../components/primitives";

export default function Artifacts() {
  const artifacts = useResource<ArtifactItem[]>(
    useCallback(() => fetchArtifacts(60), []),
    { pollMs: 30_000 },
  );

  const items = artifacts.data ?? [];
  const [openId, setOpenId] = useState<string>();

  return (
    <div className="mx-auto max-w-[1080px] fade-up">
      <PageOpening
        eyebrow="System"
        title="WHAT THE COMPANY"
        lead="HAS PRODUCED."
        detail="Durable outputs from completed tasks, each attributable to the agent and the work that created it."
        meta={<Reading label="Artifacts" value={artifacts.loading ? "—" : items.length} tone="live" />}
      />

      <Panel padded={false}>
        {artifacts.loading ? (
          <div className="p-[18px]">
            <Skeleton rows={5} />
          </div>
        ) : artifacts.error ? (
          <ErrorState
            message={artifacts.error.message}
            offline={artifacts.error.isOffline}
            onRetry={artifacts.reload}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={FileOutput}
            title="No artifacts yet"
            description="A task stores its result as an artifact the moment it completes."
          />
        ) : (
          <div className="stack-list">
            {items.map((artifact) => {
              const open = openId === artifact.id;
              const content = artifact.metadata.content;

              return (
                <div key={artifact.id} className="px-[18px] py-4">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-4 text-left"
                    onClick={() => setOpenId(open ? undefined : artifact.id)}
                    aria-expanded={open}
                  >
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-slate-200">
                        {artifact.name}
                      </div>

                      <div className="mt-1 text-[10.5px] leading-[1.6] text-slate-500">
                        {artifact.description}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Chip tone="live">{artifact.type}</Chip>

                      <span className="mono text-[9px] text-slate-600">
                        {formatRelativeTime(artifact.createdAt)}
                      </span>
                    </div>
                  </button>

                  {open && content !== undefined && (
                    <pre className="code-block mt-3 max-h-[420px]">
                      {typeof content === "string"
                        ? content
                        : safeStringify(content, 2)}
                    </pre>
                  )}

                  {artifact.workId && (
                    <Link
                      to={`/work/${artifact.workId}`}
                      className="button-quiet mt-2.5 inline-flex"
                    >
                      Open the work that produced this
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
