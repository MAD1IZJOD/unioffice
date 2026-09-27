import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchWorld,
  formatRelativeTime,
  type WorldAgent,
  type WorldSnapshot,
} from "../lib/api";
import { useCan } from "../lib/access";
import { useLiveResource } from "../lib/live";

import { Connecting, Failure, Quiet } from "../components/primitives";

import { agentLine, deskStateOf, HANDOFF_LABEL, momentAgentId, momentLine } from "../world/describe";
import { Inspector, StatePill } from "../world/Inspector";
import { planFloor, pathBetween } from "../world/layout";
import { handoffKey, momentsBetween, type Reading, type WorldMoment } from "../world/moments";
import { Scene, type Travel, type WorldSelection } from "../world/Scene";

import "../styles/world.css";

/**
 * The world: the workforce as an office.
 *
 * A second way into the same company, not a second company. Every desk,
 * every lit screen and every parcel crossing the floor is a fact the server
 * reported, and everything that moves is a change the page watched happen
 * between two live readings - so opening the page, coming back to it or
 * losing the connection shows the office as it is, never a replay of what
 * the page imagines went on while it was away.
 *
 * It reads the same live channel as the rest of the shell, so watching the
 * office opens no connection of its own.
 */

const MAX_LOG = 20;
const MAX_TRAVELS = 8;
const MOTION_KEY = "unioffice.world.motion";

interface LogEntry {
  key: string;
  line: string;
  at: string;
  select?: WorldSelection;
}

export default function World() {
  const world = useLiveResource<WorldSnapshot>(useCallback(() => fetchWorld(), []), { fallbackPollMs: 15_000 });
  const canConfigure = useCan("agents.configure");

  const [view, setView] = useState<"map" | "list">("map");
  const [motion, setMotion] = useState(initialMotion);
  const [follow, setFollow] = useState(false);
  const [selection, setSelection] = useState<WorldSelection>();
  const [focus, setFocus] = useState<{ agentId: string; nonce: number }>();

  /* Readings, and what changed between them -------------------------------- */
  //
  // Worked out while rendering, from values this component already has -
  // React's documented alternative to an effect - so a change is told in the
  // same paint that shows it.
  const [status, setStatus] = useState(world.status);
  const [connection, setConnection] = useState(0);
  const [seen, setSeen] = useState<WorldSnapshot>();
  const [reading, setReading] = useState<Reading>();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [travels, setTravels] = useState<Travel[]>([]);
  const [announcement, setAnnouncement] = useState("");

  let currentConnection = connection;

  if (world.status !== status) {
    setStatus(world.status);

    // Each time the channel comes back it is a new connection, and nothing
    // from before the drop is told as though it had been watched.
    if (world.status === "live") {
      currentConnection = connection + 1;
      setConnection(currentConnection);
    }
  }

  const snapshot = world.data;
  const plan = useMemo(
    () => (snapshot ? planFloor(snapshot.rooms.map((room) => ({ id: room.id, agentIds: room.agentIds }))) : undefined),
    [snapshot],
  );

  if (snapshot && plan && snapshot !== seen) {
    const next: Reading = {
      snapshot,
      receivedAt: Date.parse(snapshot.generatedAt),
      live: world.status === "live",
      connection: currentConnection,
    };

    const moments = momentsBetween(reading, next);

    setSeen(snapshot);
    setReading(next);

    if (moments.length > 0) {
      setLog((current) => [...moments.map((moment) => entryOf(moment, snapshot)).reverse(), ...current].slice(0, MAX_LOG));
      setAnnouncement(moments.map((moment) => momentLine(moment, snapshot)).join(" "));

      if (motion) {
        setTravels((current) => [...current, ...travelsOf(moments, plan)].slice(-MAX_TRAVELS));
      }

      const followed = moments.map(momentAgentId).find((id) => id !== undefined);
      if (follow && followed) setFocus((current) => ({ agentId: followed, nonce: (current?.nonce ?? 0) + 1 }));
    }
  }

  const travelled = useCallback((key: string) => {
    setTravels((current) => current.filter((travel) => travel.key !== key));
  }, []);

  const toggleMotion = () => {
    const next = !motion;
    setMotion(next);
    if (!next) setTravels([]);

    try {
      window.localStorage.setItem(MOTION_KEY, next ? "on" : "off");
    } catch {
      // A browser that will not store it just forgets the choice next time.
    }
  };

  const center = (agentId: string) => {
    setView("map");
    setFocus((current) => ({ agentId, nonce: (current?.nonce ?? 0) + 1 }));
  };

  /* States of the page ------------------------------------------------------ */
  if (world.loading && !snapshot) {
    return (
      <div className="mx-auto max-w-[1240px]">
        <Connecting what="Opening the office…" />
      </div>
    );
  }

  if (!snapshot || !plan) {
    return (
      <div className="mx-auto max-w-[1240px] pt-4">
        <Failure
          headline="The office could not be opened"
          detail={world.error?.message ?? "The API returned nothing."}
          consequence="Nothing about the work itself is affected. Missions run on the server whether or not anyone is watching."
          action={
            <button type="button" onClick={world.reload} className="button-ghost">
              Try again
            </button>
          }
        />
      </div>
    );
  }

  const count = (pick: (agent: WorldAgent) => boolean) => snapshot.agents.filter(pick).length;
  const working = count((agent) => agent.presence === "working");
  const waiting = count((agent) => agent.presence === "waiting");
  const inPlay = snapshot.handoffs.filter((handoff) => handoff.state !== "delivered");

  return (
    <div className={`world fade-up${motion ? "" : " world-still"}`}>
      <header className="world-head">
        <div className="min-w-0">
          <div className="t-eyebrow mb-3">Workforce</div>
          <h2 className="world-title">World</h2>
          <p className="world-summary">
            {snapshot.agents.length} {snapshot.agents.length === 1 ? "agent" : "agents"} in {snapshot.rooms.length}{" "}
            {snapshot.rooms.length === 1 ? "room" : "rooms"}
            <span className="world-summary-sep" aria-hidden="true">·</span>
            {working} working
            <span className="world-summary-sep" aria-hidden="true">·</span>
            {waiting} waiting on a decision
            <span className="world-summary-sep" aria-hidden="true">·</span>
            {inPlay.length} {inPlay.length === 1 ? "handoff" : "handoffs"} in play
          </p>
        </div>

        <div className="world-controls">
          <LiveMark status={world.status} generatedAt={snapshot.generatedAt} />

          <div className="world-toggle" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>Map</button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
          </div>

          <button type="button" className="world-switch" aria-pressed={motion} onClick={toggleMotion}>
            Motion {motion ? "on" : "off"}
          </button>

          <button type="button" className="world-switch" aria-pressed={follow} onClick={() => setFollow((value) => !value)}>
            Follow activity
          </button>
        </div>
      </header>

      {world.status === "offline" && (
        <p className="world-notice" role="status">
          Not live right now. This is the office as it was {formatRelativeTime(snapshot.generatedAt)}; it will
          catch up when the connection returns, without replaying anything it missed.
        </p>
      )}

      {snapshot.agents.length === 0 ? (
        <Quiet
          line="Nobody works here yet."
          detail="The office fills as agents are added to the workforce. Nothing is drawn that is not there."
          action={canConfigure ? <Link to="/workforce" className="button-ghost">The workforce</Link> : undefined}
        />
      ) : (
        <div className={`world-body${selection ? " world-body-inspecting" : ""}`}>
          {view === "map" ? (
            <Scene
              snapshot={snapshot}
              plan={plan}
              selection={selection}
              onSelect={setSelection}
              travels={travels}
              onTravelled={travelled}
              focus={focus}
            />
          ) : (
            <Roster snapshot={snapshot} onSelect={setSelection} />
          )}

          {selection && (
            <Inspector
              snapshot={snapshot}
              selection={selection}
              onSelect={setSelection}
              onClose={() => setSelection(undefined)}
              onCenter={center}
            />
          )}
        </div>
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <section className="world-log" aria-labelledby="world-log-title">
        <h3 id="world-log-title" className="world-section-label">Seen while you watched</h3>
        {log.length === 0 ? (
          <p className="world-meta">
            Nothing has changed since you opened the office. What changes from here is listed as it happens.
          </p>
        ) : (
          <ol className="world-log-list">
            {log.map((entry) => (
              <li key={entry.key}>
                <time className="world-meta" dateTime={entry.at}>{formatRelativeTime(entry.at)}</time>
                {entry.select ? (
                  <button type="button" className="world-link-button" onClick={() => setSelection(entry.select)}>
                    {entry.line}
                  </button>
                ) : (
                  <span>{entry.line}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <details className="world-legend">
        <summary>What the office shows</summary>
        <ul>
          <li><b>A lit screen and moving hands</b> — the agent is on a step right now.</li>
          <li><b>A lock on the screen</b> — on a step in a mission you cannot open.</li>
          <li><b>A red bubble</b> — held until a person decides.</li>
          <li><b>Three dots</b> — the planner writing a mission's plan.</li>
          <li><b>Zz and a dimmed figure</b> — paused; faded — unavailable.</li>
          <li><b>A dashed route ending in a parcel</b> — one step's result became another agent's input, and that work is still in play.</li>
          <li><b>A parcel or slips crossing the floor</b> — a handoff, or a plan giving out steps, that happened while you watched. Agents never leave their desks.</li>
          <li>Nothing else moves. An idle agent sits still, and an empty room stays empty.</li>
        </ul>
      </details>
    </div>
  );
}

/**
 * The same office as a list: every room, who is in it and what they are
 * doing, and the work that is changing hands. Nothing on the map is missing
 * here, so someone who does not use the map - or does not want motion - is
 * told everything it would have shown.
 */
function Roster({ snapshot, onSelect }: { snapshot: WorldSnapshot; onSelect: (selection: WorldSelection) => void }) {
  const inPlay = snapshot.handoffs.filter((handoff) => handoff.state !== "delivered");

  return (
    <div className="world-roster">
      {snapshot.rooms.map((room) => (
        <section key={room.id} className="world-roster-room" aria-label={room.name}>
          <h4 className="world-roster-name">
            <button type="button" className="world-link-button" onClick={() => onSelect({ kind: "room", id: room.id })}>
              {room.name}
            </button>
          </h4>
          {room.agentIds.length === 0 ? (
            <p className="world-meta">Nobody works here.</p>
          ) : (
            <ul className="world-list">
              {room.agentIds.map((id) => {
                const agent = snapshot.agents.find((entry) => entry.id === id);
                if (!agent) return null;

                return (
                  <li key={agent.id} className="world-roster-agent">
                    <button type="button" className="world-link-button" onClick={() => onSelect({ kind: "agent", id: agent.id })}>
                      {agent.name}
                    </button>
                    <StatePill state={deskStateOf(agent)} />
                    <span className="world-meta">{agentLine(agent)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      <section className="world-roster-room" aria-label="Work changing hands">
        <h4 className="world-roster-name">Work changing hands</h4>
        {inPlay.length === 0 ? (
          <p className="world-meta">No work is changing hands right now.</p>
        ) : (
          <ul className="world-list">
            {inPlay.map((handoff) => (
              <li key={handoffKey(handoff)} className="world-roster-agent">
                <button type="button" className="world-link-button" onClick={() => onSelect({ kind: "handoff", key: handoffKey(handoff) })}>
                  {handoff.from.name} → {handoff.to.name}
                </button>
                <span className="world-state">{HANDOFF_LABEL[handoff.state]}</span>
                <span className="world-meta">{handoff.missionName}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="world-roster-room" aria-label="Missions under way">
        <h4 className="world-roster-name">Mission board</h4>
        {snapshot.missions.length === 0 ? (
          <p className="world-meta">Nothing under way.</p>
        ) : (
          <ul className="world-list">
            {snapshot.missions.map((mission) => (
              <li key={mission.id} className="world-roster-agent">
                <button type="button" className="world-link-button" onClick={() => onSelect({ kind: "mission", id: mission.id })}>
                  {mission.name}
                </button>
                <span className="world-meta">{mission.completedSteps}/{mission.steps} steps</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LiveMark({ status, generatedAt }: { status: "connecting" | "live" | "offline"; generatedAt: string }) {
  return (
    <span className={`pulse pulse-${status}`} title={`Read ${formatRelativeTime(generatedAt)}`}>
      <span className="pulse-dot" aria-hidden="true" />
      {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Not live"}
    </span>
  );
}

function entryOf(moment: WorldMoment, snapshot: WorldSnapshot): LogEntry {
  const select: WorldSelection | undefined =
    moment.kind === "handoff"
      ? { kind: "handoff", key: handoffKey(moment.handoff) }
      : moment.kind === "assigned"
        ? { kind: "mission", id: moment.missionId }
        : { kind: "agent", id: moment.agentId };

  return { key: moment.key, line: momentLine(moment, snapshot), at: snapshot.generatedAt, select };
}

/** The trips a set of moments makes across the floor. Only handoffs and plans travel. */
function travelsOf(moments: WorldMoment[], plan: ReturnType<typeof planFloor>): Travel[] {
  const trips: Travel[] = [];

  for (const moment of moments) {
    if (moment.kind === "handoff") {
      const points = pathBetween(plan, moment.handoff.from.id, moment.handoff.to.id);
      if (points) trips.push({ key: moment.key, kind: "parcel", points, delay: 0 });
    }

    if (moment.kind === "assigned" && moment.fromAgentId) {
      moment.toAgentIds.forEach((agentId, index) => {
        const points = pathBetween(plan, moment.fromAgentId!, agentId);
        if (points) trips.push({ key: `${moment.key}:${agentId}`, kind: "slip", points, delay: index * 220 });
      });
    }
  }

  return trips;
}

function initialMotion(): boolean {
  try {
    const stored = window.localStorage.getItem(MOTION_KEY);
    if (stored === "on") return true;
    if (stored === "off") return false;
  } catch {
    // Unavailable storage falls through to the system preference.
  }

  return !(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

