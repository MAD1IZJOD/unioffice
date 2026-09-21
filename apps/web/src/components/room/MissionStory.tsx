import { ArrowRight, Check, CircleDashed, CircleSlash, Clock3, LoaderCircle, RotateCcw, ShieldQuestion, TriangleAlert } from "lucide-react";

import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import type {
  ArtifactItem,
  Confidence,
  Handoff,
  MissionResult,
  OutcomeStatus,
  TimelineEntry,
  TimelineState,
} from "../../lib/api";

import { formatRelativeTime } from "../../lib/api";
import { toneClass, type Tone } from "../../lib/tone";
import { StatusPill } from "../primitives";
import { ResultBody } from "../ResultBody";

/**
 * A mission as an operation you watch, rather than a record you read.
 *
 * Three readings the server computes from the mission's own rows, shown here
 * and nowhere else invented. The timeline is the event log in sentences, the
 * handoffs are the dependency edges where work genuinely changed hands, and
 * the result says what the answer is worth rather than only that execution
 * finished. None of it is embellished: if the server did not say a thing
 * happened, this cannot draw it.
 */

/* --------------------------------------------------------------------------
   Timeline
   -------------------------------------------------------------------------- */

const STATE_ICON: Record<TimelineState, LucideIcon> = {
  queued: CircleDashed,
  planning: LoaderCircle,
  running: LoaderCircle,
  waiting: ShieldQuestion,
  resumed: RotateCcw,
  completed: Check,
  failed: TriangleAlert,
  cancelled: CircleSlash,
  blocked: ShieldQuestion,
};

const STATE_TONE: Record<TimelineState, Tone> = {
  queued: "idle",
  planning: "active",
  running: "active",
  waiting: "warning",
  resumed: "active",
  completed: "live",
  failed: "error",
  cancelled: "idle",
  blocked: "error",
};

/** How many entries a long mission shows before it has to be asked for more. */
const VISIBLE = 12;

export function MissionTimeline({ entries }: { entries: TimelineEntry[] }) {
  const [all, setAll] = useState(false);

  if (entries.length === 0) {
    return (
      <p className="story-empty">
        Nothing has happened yet. Every step, decision and result appears here as it happens.
      </p>
    );
  }

  // Newest first: what is going on now is the thing being looked for, and a
  // mission with forty entries should not be scrolled to find it.
  const newestFirst = [...entries].reverse();
  const shown = all ? newestFirst : newestFirst.slice(0, VISIBLE);
  const hidden = newestFirst.length - shown.length;

  return (
    <div className="story">
      <ol className="story-list">
        {shown.map((entry, index) => {
          const Icon = STATE_ICON[entry.state];

          return (
            <li key={`${entry.at}-${index}`} className={`story-entry ${toneClass[STATE_TONE[entry.state]]}`}>
              <span className="story-mark" aria-hidden="true">
                <Icon size={12} strokeWidth={2.2} className={entry.state === "running" || entry.state === "planning" ? "spin-slow" : undefined} />
              </span>

              <time className="story-time" dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>
                {clockOf(entry.at)}
              </time>

              <div className="min-w-0">
                <p className="story-sentence">{entry.sentence}</p>

                <div className="story-meta">
                  <span className="story-state">{LABEL_OF_STATE[entry.state]}</span>
                  {entry.step !== undefined && <span className="story-step">Step {entry.step}</span>}
                  {entry.agent && (
                    <Link to={`/workforce/${entry.agent.id}`} className="story-agent">
                      {entry.agent.name}
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className="button-quiet mt-3">
          Show {hidden} earlier {hidden === 1 ? "moment" : "moments"}
        </button>
      )}
    </div>
  );
}

const LABEL_OF_STATE: Record<TimelineState, string> = {
  queued: "Queued",
  planning: "Planning",
  running: "Working",
  waiting: "Waiting for you",
  resumed: "Resumed",
  completed: "Done",
  failed: "Stopped",
  cancelled: "Cancelled",
  blocked: "Blocked",
};

/* --------------------------------------------------------------------------
   Handoffs
   -------------------------------------------------------------------------- */

const HANDOFF_TONE: Record<Handoff["state"], Tone> = {
  in_progress: "active",
  waiting: "warning",
  delivered: "live",
  stalled: "idle",
};

const HANDOFF_LABEL: Record<Handoff["state"], string> = {
  in_progress: "In hand",
  waiting: "Held for a decision",
  delivered: "Used",
  stalled: "Not picked up",
};

export function MissionHandoffs({
  handoffs,
  artifacts,
  onOpenArtifact,
}: {
  handoffs: Handoff[];
  artifacts: ArtifactItem[];
  onOpenArtifact: (artifact: ArtifactItem) => void;
}) {
  if (handoffs.length === 0) {
    return (
      <p className="story-empty">
        Nothing has changed hands yet. When one specialist's finished work becomes another's starting
        point, it appears here.
      </p>
    );
  }

  return (
    <div className="handoffs">
      {handoffs.map((handoff, index) => {
        const artifact = handoff.delivered
          ? artifacts.find((entry) => entry.id === handoff.delivered!.artifactId)
          : undefined;

        return (
          <article key={`${handoff.fromStep.number}-${handoff.toStep.number}-${index}`} className="handoff">
            <header className="handoff-head">
              <Link to={`/workforce/${handoff.from.id}`} className="handoff-agent">
                {handoff.from.name}
              </Link>

              <ArrowRight size={13} className="handoff-arrow" aria-hidden="true" />

              <Link to={`/workforce/${handoff.to.id}`} className="handoff-agent">
                {handoff.to.name}
              </Link>

              <StatusPill tone={HANDOFF_TONE[handoff.state]}>{HANDOFF_LABEL[handoff.state]}</StatusPill>
            </header>

            <p className="handoff-sentence">{handoff.sentence}</p>

            <div className="handoff-foot">
              <span className="handoff-steps">
                Step {handoff.fromStep.number} → step {handoff.toStep.number}
              </span>

              {artifact ? (
                <button type="button" onClick={() => onOpenArtifact(artifact)} className="button-quiet">
                  View {handoff.delivered!.name}
                </button>
              ) : (
                handoff.delivered && <span className="handoff-steps">{handoff.delivered.name}</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
   The result
   -------------------------------------------------------------------------- */

const OUTCOME_TONE: Record<OutcomeStatus, Tone> = {
  running: "active",
  completed: "live",
  completed_with_limitations: "warning",
  blocked: "warning",
  failed: "error",
  cancelled: "idle",
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "High",
  moderate: "Moderate",
  limited: "Limited",
  unknown: "Unknown",
};

const CONFIDENCE_TONE: Record<Confidence, Tone> = {
  high: "live",
  moderate: "warning",
  limited: "error",
  unknown: "idle",
};

/**
 * The answer, read as an executive brief.
 *
 * What it says first is what it is worth - the status and the confidence -
 * because "finished" and "finished, but one step never used the calculator it
 * was told to" are different enough that leading with the prose would be
 * misleading. The prose is still here, under it, unchanged.
 */
export function MissionResultBrief({
  outcome,
  result,
  producedBy,
  artifacts,
  onOpenArtifact,
}: {
  outcome: MissionResult;
  /** What the last step actually produced, when it produced anything. */
  result?: { value: unknown; title: string; at?: string };
  producedBy?: string;
  artifacts: ArtifactItem[];
  onOpenArtifact: (artifact: ArtifactItem) => void;
}) {
  return (
    <section className={`brief brief-${outcome.status}`}>
      <header className="brief-head">
        <StatusPill tone={OUTCOME_TONE[outcome.status]}>{outcome.label}</StatusPill>

        {outcome.confidence !== "unknown" && (
          <span className={`brief-confidence ${toneClass[CONFIDENCE_TONE[outcome.confidence]]}`}>
            {CONFIDENCE_LABEL[outcome.confidence]} confidence
          </span>
        )}

        {outcome.finishedAt && (
          <span className="brief-when">
            <Clock3 size={11} />
            {formatRelativeTime(outcome.finishedAt)}
          </span>
        )}
      </header>

      <p className="brief-summary">{outcome.summary}</p>
      <p className="brief-confidence-reason">{outcome.confidenceReason}</p>

      {outcome.limitations.length > 0 && (
        <div className="brief-limits">
          <div className="detail-label mb-2">What limits this result</div>

          <ul>
            {outcome.limitations.map((limitation, index) => (
              <li key={`${limitation.kind}-${index}`}>
                {limitation.step !== undefined && <span className="brief-limit-step">Step {limitation.step}</span>}
                {limitation.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {outcome.unfinished.length > 0 && (
        <div className="brief-limits">
          <div className="detail-label mb-2">
            {outcome.unfinished.length} {outcome.unfinished.length === 1 ? "step" : "steps"} never ran
          </div>

          <ul>
            {outcome.unfinished.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div className="brief-answer">
          <div className="detail-label mb-2">What the company produced</div>

          <div className="delivery-body">
            <ResultBody value={result.value} />
          </div>

          <div className="delivery-foot">
            {producedBy && <span className="t-machine">{producedBy}</span>}
            <span className="t-machine">{result.title}</span>
            {result.at && <span className="t-machine">{formatRelativeTime(result.at)}</span>}
          </div>
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="brief-artifacts">
          <div className="detail-label mb-2">
            {artifacts.length} {artifacts.length === 1 ? "thing" : "things"} it left behind
          </div>

          <div className="brief-artifact-row">
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => onOpenArtifact(artifact)}
                className="brief-artifact"
              >
                {artifact.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** "09:42" in the reader's own clock. */
function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
