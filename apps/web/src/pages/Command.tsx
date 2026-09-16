import {
  ArrowRight,
  Brain,
  CircleAlert,
  CircleDot,
  Clock,
  RotateCcw,
  Scale,
  ShieldAlert,
  UserX,
  Zap,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";

import {
  acknowledgeMission,
  formatRelativeTime,
  type AttentionItem,
  type AttentionQueue,
  type MissionCard,
  type MissionControl,
} from "../lib/api";

import { useCan } from "../lib/access";
import { attentionTime, attentionTone } from "../lib/attention";

import {
  elapsedLabel,
  freshnessOf,
  missionTitle,
  outcomeTone,
  phaseLabel,
  phaseTone,
  sourceLabel,
  teamStateTone,
  useMissionControl,
  useNow,
} from "../lib/missionControl";

import { describeControl } from "../lib/statement";
import { toneClass, type Tone } from "../lib/tone";

import {
  Chapter,
  Connecting,
  Failure,
  Quiet,
  StatusPill,
} from "../components/primitives";

import { SignalField } from "../components/SignalField";

/**
 * The Command Center: Mission Control.
 *
 * Opening UNI-OFFICE should answer, within seconds and without scrolling,
 * whether the company needs you. So the page is built on exceptions:
 *
 *   1. The statement says, at display size, whether anything needs you.
 *   2. Needs you - what is stopped until a person acts, with the action.
 *   3. Missions - what is running, and what is blocked and why.
 *   4. What finished, what happened, and what the company knows.
 *
 * Normal execution stays quiet: a running mission is a calm row, and an empty
 * "Needs you" is a full sentence rather than a blank. Everything on the page
 * comes from one read the shell shares, kept current by the live channel.
 */

const ATTENTION_ICON: Record<AttentionItem["kind"], LucideIcon> = {
  decision: ShieldAlert,
  governance: Scale,
  failure: CircleAlert,
  stalled: Clock,
  agent_unavailable: UserX,
  interrupted: RotateCcw,
  conflict: Brain,
  lessons: Brain,
  recovering: RotateCcw,
};

export default function Command() {
  const control = useMissionControl();
  const now = useNow();
  const data = control.data;

  if (!data) {
    if (control.error) {
      return (
        <div className="mx-auto max-w-[1340px] pt-6">
          <Failure
            headline={control.error.isOffline ? "The company is unreachable" : "Mission Control could not be read"}
            detail={control.error.message}
            consequence={
              control.error.isOffline
                ? "Nothing is lost. Missions already on the queue keep running on the worker; this page just cannot see them."
                : "Nothing was changed by this request."
            }
            action={
              <button type="button" onClick={control.reload} className="button-ghost">
                Try again
              </button>
            }
          />
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-[1340px] pt-6" aria-busy="true">
        <Connecting what="Reading the state of the company…" />
      </div>
    );
  }

  const statement = describeControl(data);
  const freshness = freshnessOf(data.generatedAt, now, Boolean(control.error));

  return (
    <div className="fade-up">
      <header className={`dispatch dispatch-${statement.mood}`}>
        <SignalField
          mood={statement.mood}
          activity={data.outcomes.length}
          agents={data.workforce.total}
          executing={data.summary.running}
        />

        <div className="dispatch-inner">
          <div className="command-channel">
            <span className={`pulse pulse-${control.status}`} title="How this page is being kept current">
              <span className="pulse-dot" aria-hidden="true" />
              {control.status === "live"
                ? "Watching live"
                : control.status === "connecting"
                  ? "Connecting"
                  : "Checking on a timer"}
            </span>

            <span className={`control-freshness${freshness.stale ? " control-freshness-stale" : ""}`}>
              {freshness.label}
            </span>
          </div>

          <h2 className="statement">
            {statement.headline.map((line) => (
              <span key={line} className="statement-line">
                {line}
              </span>
            ))}
          </h2>

          <p className="statement-detail">{statement.detail}</p>

          <div className="control-launch">
            <Link to="/missions/new" className="button-primary">
              <Zap size={13} />
              Start mission
            </Link>
            <Link to="/missions/new#templates" className="button-ghost">
              From a template
            </Link>
          </div>

          <div className="dispatch-meta">
            <DispatchStat label="Running" value={data.summary.running} tone="active" live={data.summary.running > 0} />
            <DispatchStat
              label="Blocked"
              value={data.summary.blocked}
              tone={data.summary.blocked > 0 ? "error" : "idle"}
              live={data.summary.blocked > 0}
            />
            <DispatchStat label="Needs you" value={data.summary.needsYou} tone="warning" live={data.summary.needsYou > 0} />
            <DispatchStat label="Finished today" value={data.summary.finishedToday} tone="live" />
            {data.summary.failedToday > 0 && (
              <DispatchStat label="Stopped today" value={data.summary.failedToday} tone="error" />
            )}
          </div>

          <Workforce workforce={data.workforce} />
        </div>
      </header>

      <div className="mx-auto max-w-[1340px] pt-7">
        {freshness.stale && control.error && (
          <div className="control-stale callout callout-warning" role="status">
            Showing the company as it was {formatRelativeTime(data.generatedAt)}. The last refresh failed:{" "}
            {control.error.message}
            <button type="button" onClick={control.reload} className="button-quiet ml-2">
              Try again
            </button>
          </div>
        )}

        <NeedsYou queue={data.attention} onChanged={control.reload} />

        <Chapter
          index="01"
          title="Missions"
          action={
            <Link to="/missions" className="button-quiet">
              Every mission
              <ArrowRight size={11} />
            </Link>
          }
        />

        <div className="control-grid">
          <section className="min-w-0" aria-labelledby="running-title">
            <div className="section-head">
              <h3 id="running-title" className="section-head-title">
                Running
                <span className="section-head-count">{data.summary.running}</span>
              </h3>
            </div>

            {data.running.length === 0 ? (
              <Quiet
                line="Nothing is running."
                detail="Start a mission and its plan, its team and each step appear here as they happen."
                action={<Link to="/missions/new" className="button-ghost">Start mission</Link>}
              />
            ) : (
              <div className="ledger">
                {data.running.map((card, index) => (
                  <MissionRow key={card.id} card={card} index={index} />
                ))}
              </div>
            )}
          </section>

          <section className="min-w-0" aria-labelledby="blocked-title">
            <div className="section-head">
              <h3 id="blocked-title" className="section-head-title">
                Blocked
                <span className="section-head-count">{data.summary.blocked}</span>
              </h3>
            </div>

            {data.blocked.length === 0 ? (
              <Quiet
                line="Nothing is blocked."
                detail={
                  data.summary.setAside > 0
                    ? `${data.summary.setAside} stalled ${data.summary.setAside === 1 ? "mission was" : "missions were"} marked as seen and ${data.summary.setAside === 1 ? "is" : "are"} set aside.`
                    : "A mission waiting on a decision, stuck on the queue or assigned to an agent who cannot work shows up here."
                }
              />
            ) : (
              <div className="ledger">
                {data.blocked.map((card, index) => (
                  <MissionRow key={card.id} card={card} index={index} />
                ))}
              </div>
            )}
          </section>
        </div>

        <Chapter
          index="02"
          title="Recently finished"
          action={
            <Link to="/artifacts" className="button-quiet">
              Everything produced
            </Link>
          }
        />

        {data.finished.length === 0 ? (
          <Quiet
            line="Nothing has finished yet."
            detail="Finished and stopped missions land here with how they ended."
          />
        ) : (
          <div className="ledger">
            {data.finished.map((card) => (
              <FinishedRow key={card.id} card={card} />
            ))}
          </div>
        )}

        <div className="grid gap-x-9 gap-y-0 lg:grid-cols-2">
          <section className="min-w-0" aria-label="What happened">
            <Chapter
              index="03"
              title="What happened"
              action={
                <Link to="/activity" className="button-quiet">
                  Full history
                </Link>
              }
            />

            <Outcomes outcomes={data.outcomes} />
          </section>

          <section className="min-w-0" aria-label="What the company knows">
            <Chapter
              index="04"
              title="What the company knows"
              action={
                <Link to="/brain" className="button-quiet">
                  Company brain
                </Link>
              }
            />

            <Signals signals={data.signals} />
          </section>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Needs you
   -------------------------------------------------------------------------- */

const COLLAPSED = { action: 5, review: 3, watch: 2 };

function NeedsYou({
  queue,
  onChanged,
}: {
  queue: AttentionQueue;
  onChanged: () => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState<{ id: string; message: string }>();

  if (queue.total === 0) {
    return (
      <section className="needs needs-clear" aria-labelledby="needs-title">
        <h3 id="needs-title" className="needs-clear-title">Nothing needs you</h3>
        <p className="needs-clear-detail">
          Everything is running on its own. Anything that stops, stalls or needs a decision appears here.
        </p>
      </section>
    );
  }

  async function markSeen(item: AttentionItem) {
    if (!item.workId) return;

    setBusy(item.id);
    setFailure(undefined);

    try {
      await acknowledgeMission(item.workId);
      await onChanged();
    } catch (error) {
      setFailure({ id: item.id, message: (error as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  const groups: Array<{ severity: AttentionItem["severity"]; title: string; className: string }> = [
    { severity: "action", title: "Needs you", className: "attention-band-group" },
    { severity: "review", title: "Worth a look — nothing is blocked", className: "attention-band-group attention-band-review" },
    { severity: "watch", title: "Handling itself — nothing for you to do", className: "attention-band-group attention-band-watching" },
  ];

  const hidden = queue.items.filter((item, _index, all) =>
    !expanded && all.filter((other) => other.severity === item.severity).indexOf(item) >= COLLAPSED[item.severity]).length;
  const beyond = queue.total - queue.items.length;

  return (
    <section className="attention-band needs" aria-labelledby="needs-title">
      <h3 id="needs-title" className="sr-only">Needs you</h3>

      {groups.map((group) => {
        const items = queue.items.filter((item) => item.severity === group.severity);
        if (items.length === 0) return null;

        const visible = expanded ? items : items.slice(0, COLLAPSED[group.severity]);

        return (
          <div key={group.severity} className={group.className} role="group" aria-label={group.title}>
            <div className="attention-band-head">
              <span className="attention-band-eyebrow">{group.title}</span>
              <span className="t-machine">
                {group.severity === "action" ? queue.actionCount : group.severity === "review" ? queue.reviewCount : queue.watchCount}
              </span>
            </div>

            {visible.map((item) => (
              <AttentionEntry
                key={item.id}
                item={item}
                busy={busy}
                failure={failure?.id === item.id ? failure.message : undefined}
                onMarkSeen={() => void markSeen(item)}
              />
            ))}
          </div>
        );
      })}

      {(hidden > 0 || expanded || beyond > 0) && (
        <div className="needs-more">
          {(hidden > 0 || expanded) && (
            <button type="button" className="button-quiet" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
          {beyond > 0 && <span className="t-machine">{beyond} more beyond these</span>}
        </div>
      )}
    </section>
  );
}

function AttentionEntry({
  item,
  busy,
  failure,
  onMarkSeen,
}: {
  item: AttentionItem;
  busy?: string;
  failure?: string;
  onMarkSeen: () => void;
}) {
  const Icon = ATTENTION_ICON[item.kind];
  const canOperate = useCan("missions.operate");

  return (
    <div className={`attention-row needs-row ${toneClass[attentionTone(item)]}`} role="article" aria-label={item.label}>
      <Icon size={14} className="attention-row-icon" />

      <span className="min-w-0 flex-1">
        <span className="attention-row-label">{item.label}</span>
        {item.objective && item.objective !== item.detail && (
          <span className="needs-objective">{item.objective}</span>
        )}
        <span className="attention-row-detail">{item.detail}</span>
        <span className="attention-row-consequence">{item.consequence}</span>
        <span className="needs-tags">
          <span>{sourceLabel(item.source)}</span>
          {item.level === "critical" && <span className="needs-tag-critical">critical</span>}
          <span>{attentionTime(item)}</span>
        </span>
        {failure && <span className="needs-error" role="alert">{failure}</span>}
      </span>

      <span className="needs-actions">
        <Link to={item.action.path} className={item.severity === "action" ? "button-ghost" : "button-quiet"}>
          {item.action.label}
          <ArrowRight size={11} />
        </Link>

        {canOperate && item.acknowledgeable && item.workId && (
          <button type="button" className="button-quiet" disabled={Boolean(busy)} onClick={onMarkSeen}>
            {busy === item.id ? "Marking…" : "Mark as seen"}
          </button>
        )}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Missions
   -------------------------------------------------------------------------- */

function MissionRow({ card, index }: { card: MissionCard; index: number }) {
  const tone = phaseTone(card.phase);
  const progress = card.progress.total > 0 ? Math.round((card.progress.completed / card.progress.total) * 100) : 0;
  const elapsed = elapsedLabel(card);

  return (
    // The whole row opens the mission through its title link, stretched over
    // the row, so the names of the agents on it can each open their own
    // workforce profile without one link sitting inside another.
    <article className="ledger-row mission-row" aria-label={missionTitle(card)}>
      <span className={`ledger-rail ${toneClass[tone]}${card.phase === "running" ? " op-rail-running" : ""}`} />

      <span className="ledger-index">{String(index + 1).padStart(2, "0")}</span>

      <span className="min-w-0">
        <Link to={`/missions/${card.id}`} className="mission-row-link">
          <span className="ledger-title">{missionTitle(card)}</span>
        </Link>
        {card.name && <span className="mission-row-objective">{card.objective}</span>}

        <span className="mission-row-stage">{card.stage}</span>
        {card.blocked && card.blocked.reason !== card.stage && (
          <span className={`mission-row-blocked ${toneClass[tone]}`}>{card.blocked.reason}</span>
        )}

        <span className="ledger-meta">
          {card.team.length > 0 && (
            <span className="mission-row-team">
              {card.team.map((member) => (
                <Link
                  key={member.agentId}
                  to={`/workforce/${member.agentId}`}
                  className={`team-chip team-chip-link ${toneClass[teamStateTone(member.state)]}`}
                  title={`${member.name}: ${member.state}`}
                >
                  <span className="pill-dot" aria-hidden="true" />
                  {member.name}
                </Link>
              ))}
            </span>
          )}
          {card.progress.total > 0 && (
            <span>
              {card.progress.completed}/{card.progress.total} steps
            </span>
          )}
          {elapsed && <span>{elapsed}</span>}
          {card.template && <span>{card.template}</span>}
          {card.priority !== "normal" && <span className="uppercase">{card.priority}</span>}
        </span>

        {card.progress.total > 0 && (
          <span className="ledger-pace" aria-hidden="true">
            <span className="ledger-pace-fill" style={{ width: `${progress}%` }} />
          </span>
        )}

        {card.latest && (
          <span className="mission-row-latest">
            {card.latest.text} · {formatRelativeTime(card.latest.at)}
          </span>
        )}
      </span>

      <span className="ledger-status">
        <StatusPill tone={tone} pulse={card.phase === "running"}>
          {phaseLabel(card.phase)}
        </StatusPill>
      </span>
    </article>
  );
}

function FinishedRow({ card }: { card: MissionCard }) {
  const tone = phaseTone(card.phase);
  const elapsed = elapsedLabel(card);

  return (
    <Link to={`/missions/${card.id}`} className="ledger-row">
      <span className={`ledger-rail ${toneClass[tone]}`} />

      <span className="ledger-index" aria-hidden="true">
        {card.phase === "completed" ? "✓" : "✕"}
      </span>

      <span className="min-w-0">
        <span className="ledger-title">{missionTitle(card)}</span>

        <span className="ledger-meta">
          <span className={card.failure ? "mission-row-failure" : undefined}>{card.failure ?? card.stage}</span>
          <span>{formatRelativeTime(card.completedAt ?? card.lastActivityAt)}</span>
          {elapsed && <span>{elapsed}</span>}
        </span>
      </span>

      <span className="ledger-status">
        <StatusPill tone={tone}>{phaseLabel(card.phase)}</StatusPill>
      </span>
    </Link>
  );
}

/* --------------------------------------------------------------------------
   What happened, and what the company knows
   -------------------------------------------------------------------------- */

function Outcomes({ outcomes }: { outcomes: MissionControl["outcomes"] }) {
  if (outcomes.length === 0) {
    return (
      <Quiet
        line="Nothing has happened yet."
        detail="Finished missions, decisions and knowledge the company keeps are recorded here — not every step."
      />
    );
  }

  return (
    <ul className="outcome-list">
      {outcomes.map((outcome) => (
        <li key={outcome.id} className="stream-row">
          <CircleDot size={9} className={`stream-dot ${toneClass[outcomeTone(outcome.kind)]}`} />

          <span className="min-w-0 flex-1">
            {outcome.path ? (
              <Link to={outcome.path} className="outcome-text">{outcome.text}</Link>
            ) : (
              <span className="outcome-text">{outcome.text}</span>
            )}
            {outcome.detail && <span className="outcome-detail">{outcome.detail}</span>}
            {outcome.note && <span className="outcome-note">{outcome.note}</span>}
          </span>

          <span className="t-machine shrink-0">{formatRelativeTime(outcome.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function Signals({ signals }: { signals: MissionControl["signals"] }) {
  const empty =
    signals.decisions.length === 0 &&
    signals.lessons.length === 0 &&
    signals.awaiting.total === 0 &&
    signals.conflicts.length === 0;

  if (empty) {
    return (
      <Quiet
        line="The company has not recorded any knowledge yet."
        detail="Decisions, lessons and anything that disagrees are summarised here as missions teach the company."
      />
    );
  }

  return (
    <div>
      {signals.conflicts.length > 0 && (
        <SignalGroup title="Disagrees with itself" tone="warning">
          {signals.conflicts.map((conflict) => (
            <Link key={conflict.id} to={`/brain/${conflict.left.id}`} className="signal-line">
              <span>“{conflict.left.title}”</span>
              <span className="signal-vs">vs</span>
              <span>“{conflict.right.title}”</span>
            </Link>
          ))}
        </SignalGroup>
      )}

      {signals.awaiting.total > 0 && (
        <SignalGroup
          title={`${signals.awaiting.atLeast ? "At least " : ""}${signals.awaiting.total} proposed, waiting for a decision`}
        >
          {signals.awaiting.missions.map((mission) => (
            <Link key={mission.workId} to={`/missions/${mission.workId}#debrief`} className="signal-line">
              <span>{mission.count} from “{mission.objective}”</span>
            </Link>
          ))}
        </SignalGroup>
      )}

      {signals.decisions.length > 0 && (
        <SignalGroup title="Recent decisions">
          {signals.decisions.map((signal) => (
            <Link key={signal.id} to={`/brain/${signal.id}`} className="signal-line">
              <span>{signal.title}</span>
              <span className="signal-meta">{formatRelativeTime(signal.createdAt)}</span>
            </Link>
          ))}
        </SignalGroup>
      )}

      {signals.lessons.length > 0 && (
        <SignalGroup title="Recent lessons">
          {signals.lessons.map((signal) => (
            <Link key={signal.id} to={`/brain/${signal.id}`} className="signal-line">
              <span>{signal.title}</span>
              <span className="signal-meta">
                {signal.status === "proposed" ? "proposed · " : ""}
                {formatRelativeTime(signal.createdAt)}
              </span>
            </Link>
          ))}
        </SignalGroup>
      )}
    </div>
  );
}

function SignalGroup({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "warning";
  children: ReactNode;
}) {
  return (
    <div className={`signal-group${tone ? ` signal-group-${tone}` : ""}`} role="group" aria-label={title}>
      <div className="signal-group-title">{title}</div>
      {children}
    </div>
  );
}

function Workforce({ workforce }: { workforce: MissionControl["workforce"] }) {
  return (
    <p className="control-workforce">
      <Link to="/workforce">
        {workforce.total} {workforce.total === 1 ? "agent" : "agents"}
      </Link>
      {" · "}
      {workforce.working} working
      {workforce.unavailable.length > 0 && (
        <>
          {" · "}
          <span className="control-workforce-unavailable">
            {workforce.unavailable.map((agent) => `${agent.name} ${agent.status}`).join(", ")}
          </span>
        </>
      )}
    </p>
  );
}

function DispatchStat({
  label,
  value,
  tone,
  live = false,
}: {
  label: string;
  value: ReactNode;
  tone: Tone;
  live?: boolean;
}) {
  return (
    <div className={`dispatch-stat ${toneClass[tone]}`}>
      <div className={`dispatch-stat-value${live ? " dispatch-stat-value-live" : ""}`}>{value}</div>
      <div className="dispatch-stat-label">{label}</div>
    </div>
  );
}
