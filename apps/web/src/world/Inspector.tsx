import { useCallback, type Ref } from "react";

import { ArrowRight, Crosshair, X } from "lucide-react";
import { Link } from "react-router-dom";

import { fetchAgentProfile, formatRelativeTime, type AgentProfile, type WorldAgent, type WorldSnapshot } from "../lib/api";
import { useCan } from "../lib/access";
import { useResource } from "../lib/useResource";
import { capabilityLabel, disciplineOf, profileOf } from "../lib/workforce";

import { agentLine, DESK_LABEL, deskStateOf, HANDOFF_LABEL, lastLine, missionStatusWord, type DeskState } from "./describe";
import { Runs } from "./Desk";
import { handoffKey } from "./moments";
import type { WorldSelection } from "./Scene";
import { figureRuns, lookOf } from "./sprites";

/**
 * What the world knows about the thing that was clicked, and where to go to
 * do something about it.
 *
 * A click on the map is not an authorization and nothing here changes
 * anything. Every action is a link into the page that already owns it -
 * the mission's room, the approvals queue, the agent's profile - where the
 * server checks the person's role again before anything happens. A link is
 * offered only when the person's role could use it.
 */
export function Inspector({
  snapshot,
  selection,
  onSelect,
  onClose,
  onCenter,
  ref,
}: {
  snapshot: WorldSnapshot;
  selection: WorldSelection;
  onSelect: (selection: WorldSelection) => void;
  onClose: () => void;
  onCenter: (agentId: string) => void;
  /** The panel itself, so the map can keep what it shows clear of it. */
  ref?: Ref<HTMLElement>;
}) {
  let body: React.ReactNode = null;
  let title = "";

  if (selection.kind === "agent") {
    const agent = snapshot.agents.find((entry) => entry.id === selection.id);
    title = agent?.name ?? "Agent";
    body = agent
      ? <AgentPanel agent={agent} snapshot={snapshot} onSelect={onSelect} onCenter={onCenter} />
      : <Gone what="This agent is no longer in your view of the company." />;
  }

  if (selection.kind === "room") {
    const room = snapshot.rooms.find((entry) => entry.id === selection.id);
    title = room?.name ?? "Room";
    body = room ? <RoomPanel roomId={room.id} snapshot={snapshot} onSelect={onSelect} /> : <Gone what="This room is no longer in your view." />;
  }

  if (selection.kind === "handoff") {
    const handoff = snapshot.handoffs.find((entry) => handoffKey(entry) === selection.key);
    title = "Work changing hands";
    body = handoff ? <HandoffPanel handoffKeyValue={selection.key} snapshot={snapshot} onSelect={onSelect} /> : <Gone what="This handoff is no longer in play. Its mission's record still has it." />;
  }

  if (selection.kind === "mission") {
    const mission = snapshot.missions.find((entry) => entry.id === selection.id);
    title = mission?.name ?? "Mission";
    body = mission ? <MissionPanel missionId={mission.id} snapshot={snapshot} onSelect={onSelect} /> : <Gone what="This mission is no longer under way." />;
  }

  return (
    <aside ref={ref} className="world-inspector" aria-label={`Details: ${title}`}>
      <header className="world-inspector-head">
        <h3 className="world-inspector-title">{title}</h3>
        <button type="button" className="button-quiet world-inspector-close" onClick={onClose} aria-label="Close details">
          <X size={14} />
        </button>
      </header>
      <div className="world-inspector-body">{body}</div>
    </aside>
  );
}

function AgentPanel({
  agent,
  snapshot,
  onSelect,
  onCenter,
}: {
  agent: WorldAgent;
  snapshot: WorldSnapshot;
  onSelect: (selection: WorldSelection) => void;
  onCenter: (agentId: string) => void;
}) {
  const state = deskStateOf(agent);
  const profile = profileOf(agent);
  const room = snapshot.rooms.find((entry) => entry.id === agent.roomId);
  const missionId = agent.current?.missionId ?? agent.planning?.missionId;
  const mission = missionId ? snapshot.missions.find((entry) => entry.id === missionId) : undefined;
  const canDecide = useCan("approvals.decide", mission?.workspaceId ?? null);
  const last = lastLine(agent);

  const handoffs = snapshot.handoffs.filter(
    (handoff) => handoff.state !== "delivered" && (handoff.from.id === agent.id || handoff.to.id === agent.id),
  );

  return (
    <>
      <div className="world-portrait">
        <svg className="world-portrait-figure" viewBox="0 0 12 13" width={60} height={65} aria-hidden="true">
          <Runs runs={figureRuns(lookOf(agent.id, disciplineOf(agent)))} />
        </svg>
        <div className="min-w-0">
          <div className="world-portrait-role">{profile.label}</div>
          <div className="world-portrait-room">{room?.name ?? "—"}</div>
          <StatePill state={state} />
        </div>
      </div>

      <p className="world-line">{agentLine(agent)}</p>

      {agent.current?.since && state !== "elsewhere" && (
        <p className="world-meta">Since {formatRelativeTime(agent.current.since)}</p>
      )}

      {last && <p className="world-meta">{last}</p>}

      {handoffs.length > 0 && (
        <div className="world-section">
          <div className="world-section-label">Work changing hands</div>
          <ul className="world-list">
            {handoffs.map((handoff) => (
              <li key={handoffKey(handoff)}>
                <button type="button" className="world-link-button" onClick={() => onSelect({ kind: "handoff", key: handoffKey(handoff) })}>
                  {handoff.from.id === agent.id ? `To ${handoff.to.name}` : `From ${handoff.from.name}`}
                  <span className="world-meta"> · step {handoff.fromStep.number} → {handoff.toStep.number}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {agent.capabilities.length > 0 && (
        <div className="world-section">
          <div className="world-section-label">Can do</div>
          <p className="world-meta">{agent.capabilities.map(capabilityLabel).join(" · ")}</p>
        </div>
      )}

      {/* Keyed, so one agent's tools are never shown under another's name while the next are read. */}
      <Equipment key={agent.id} agentId={agent.id} />

      <div className="world-actions">
        {state === "waiting" && missionId && canDecide && (
          <Link to="/approvals" className="button-primary">
            Review the decision
            <ArrowRight size={13} />
          </Link>
        )}
        {missionId && (
          <Link to={`/missions/${missionId}`} className={state === "waiting" && canDecide ? "button-ghost" : "button-primary"}>
            Open the mission
            <ArrowRight size={13} />
          </Link>
        )}
        {agent.lastOutcome?.outcome === "failed" && agent.lastOutcome.missionId !== missionId && (
          <Link to={`/missions/${agent.lastOutcome.missionId}`} className="button-ghost">
            See what stopped
          </Link>
        )}
        <Link to={`/workforce/${agent.id}`} className="button-ghost">
          Open profile
        </Link>
        <button type="button" className="button-quiet" onClick={() => onCenter(agent.id)}>
          <Crosshair size={12} />
          Show on map
        </button>
      </div>

      {state === "waiting" && missionId && !canDecide && (
        <p className="world-meta">Your role can follow this decision but not make it.</p>
      )}
    </>
  );
}

const TOOL_ACCESS: Record<AgentProfile["governance"]["tools"][number]["access"], string> = {
  allowed: "Allowed",
  requires_approval: "Needs approval",
  denied: "Denied",
};

/**
 * What the agent may use and knows how to do.
 *
 * Read from the agent's profile - the same read, under the same access, as
 * the profile page - because the world's snapshot carries only what the
 * office draws. Names and plain answers only; the policy behind each tool
 * is on the profile.
 */
function Equipment({ agentId }: { agentId: string }) {
  const profile = useResource<AgentProfile>(useCallback(() => fetchAgentProfile(agentId), [agentId]));

  if (profile.loading) return <p className="world-meta">Reading tools and skills…</p>;
  if (!profile.data) return <p className="world-meta">Tools and skills could not be read. The profile has them.</p>;

  const { governance, skills } = profile.data;

  return (
    <>
      <div className="world-section">
        <div className="world-section-label">Tools</div>
        {governance.tools.length === 0 ? (
          <p className="world-meta">Holds no tools, so it is never given a step that needs one.</p>
        ) : (
          <ul className="world-list" aria-label="Tools">
            {governance.tools.map((tool) => (
              <li key={tool.toolId}>
                <span className="world-line">{tool.name}</span>
                <span className="world-meta">{TOOL_ACCESS[tool.access]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="world-section">
        <div className="world-section-label">Skills</div>
        {skills.length === 0 ? (
          <p className="world-meta">Holds no skills.</p>
        ) : (
          <ul className="world-list" aria-label="Skills">
            {skills.map((skill) => (
              <li key={skill.slug}>
                <span className="world-line">{skill.name}</span>
                <span className="world-meta">{skill.usable ? "Can use" : "Cannot use yet"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function RoomPanel({
  roomId,
  snapshot,
  onSelect,
}: {
  roomId: string;
  snapshot: WorldSnapshot;
  onSelect: (selection: WorldSelection) => void;
}) {
  const room = snapshot.rooms.find((entry) => entry.id === roomId)!;
  const people = room.agentIds
    .map((id) => snapshot.agents.find((agent) => agent.id === id))
    .filter((agent): agent is WorldAgent => agent !== undefined);

  // The hall's missions are the company-wide ones; a workspace's are its own.
  const missions = snapshot.missions.filter((mission) =>
    room.kind === "hall" ? mission.workspaceId === undefined : mission.workspaceId === room.id);

  return (
    <>
      <p className="world-line">
        {room.kind === "hall"
          ? "Agents who work in every workspace sit here."
          : "Agents who belong to this workspace sit here."}
      </p>

      <div className="world-section">
        <div className="world-section-label">Who works here</div>
        {people.length === 0 ? (
          <p className="world-meta">Nobody works here yet.</p>
        ) : (
          <ul className="world-list">
            {people.map((agent) => (
              <li key={agent.id}>
                <button type="button" className="world-link-button" onClick={() => onSelect({ kind: "agent", id: agent.id })}>
                  {agent.name}
                </button>
                <StatePill state={deskStateOf(agent)} />
                <span className="world-meta">{agentLine(agent)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="world-section">
        <div className="world-section-label">Under way here</div>
        {missions.length === 0 ? (
          <p className="world-meta">No mission is under way here.</p>
        ) : (
          <ul className="world-list">
            {missions.map((mission) => (
              <li key={mission.id}>
                <button type="button" className="world-link-button" onClick={() => onSelect({ kind: "mission", id: mission.id })}>
                  {mission.name}
                </button>
                <span className="world-meta">{missionStatusWord(mission)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {room.kind === "workspace" && (
        <div className="world-actions">
          <Link to={`/workspaces/${room.id}`} className="button-ghost">
            Open the workspace
            <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </>
  );
}

function HandoffPanel({
  handoffKeyValue,
  snapshot,
  onSelect,
}: {
  handoffKeyValue: string;
  snapshot: WorldSnapshot;
  onSelect: (selection: WorldSelection) => void;
}) {
  const handoff = snapshot.handoffs.find((entry) => handoffKey(entry) === handoffKeyValue)!;

  return (
    <>
      <p className="world-line">{handoff.sentence}</p>

      <dl className="world-facts">
        <dt>From</dt>
        <dd>
          <button type="button" className="world-link-button" onClick={() => onSelect({ kind: "agent", id: handoff.from.id })}>
            {handoff.from.name}
          </button>
          <span className="world-meta"> · step {handoff.fromStep.number}, “{handoff.fromStep.title}”</span>
        </dd>
        <dt>To</dt>
        <dd>
          <button type="button" className="world-link-button" onClick={() => onSelect({ kind: "agent", id: handoff.to.id })}>
            {handoff.to.name}
          </button>
          <span className="world-meta"> · step {handoff.toStep.number}, “{handoff.toStep.title}”</span>
        </dd>
        <dt>Now</dt>
        <dd>{HANDOFF_LABEL[handoff.state]}</dd>
        <dt>Mission</dt>
        <dd>{handoff.missionName}</dd>
        {handoff.delivered && (
          <>
            <dt>Result</dt>
            <dd>{handoff.delivered.name}</dd>
          </>
        )}
      </dl>

      <p className="world-meta">
        One step's finished result became the next step's input, as the mission's plan
        said it would. Nobody met: the parcel on the map stands for the work, and both
        agents stay at their desks.
      </p>

      <div className="world-actions">
        {/* The result opens in the mission room's own sheet, which reads it
            again under the viewer's access - nothing is shown from here. */}
        {handoff.delivered && (
          <Link
            to={`/missions/${handoff.missionId}?artifact=${encodeURIComponent(handoff.delivered.artifactId)}`}
            className="button-primary"
          >
            Open the result
            <ArrowRight size={13} />
          </Link>
        )}
        <Link to={`/missions/${handoff.missionId}`} className={handoff.delivered ? "button-ghost" : "button-primary"}>
          Open the mission record
          <ArrowRight size={13} />
        </Link>
      </div>
    </>
  );
}

function MissionPanel({
  missionId,
  snapshot,
  onSelect,
}: {
  missionId: string;
  snapshot: WorldSnapshot;
  onSelect: (selection: WorldSelection) => void;
}) {
  const mission = snapshot.missions.find((entry) => entry.id === missionId)!;
  const people = mission.agentIds
    .map((id) => snapshot.agents.find((agent) => agent.id === id))
    .filter((agent): agent is WorldAgent => agent !== undefined);
  const room = mission.workspaceId ? snapshot.rooms.find((entry) => entry.id === mission.workspaceId) : undefined;

  return (
    <>
      <p className="world-line">
        {missionStatusWord(mission)}. {mission.steps > 0 ? `${mission.completedSteps} of ${mission.steps} steps done.` : "No steps yet."}
      </p>

      {room && <p className="world-meta">In {room.name}</p>}

      <div className="world-section">
        <div className="world-section-label">Holding its steps</div>
        {people.length === 0 ? (
          <p className="world-meta">Nobody yet.</p>
        ) : (
          <ul className="world-list">
            {people.map((agent) => (
              <li key={agent.id}>
                <button type="button" className="world-link-button" onClick={() => onSelect({ kind: "agent", id: agent.id })}>
                  {agent.name}
                </button>
                <StatePill state={deskStateOf(agent)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="world-actions">
        <Link to={`/missions/${mission.id}`} className="button-primary">
          Open the mission
          <ArrowRight size={13} />
        </Link>
        {mission.status === "queued" && mission.steps > 0 && (
          <Link to={`/missions/${mission.id}/brief`} className="button-ghost">
            Read its brief
          </Link>
        )}
      </div>
    </>
  );
}

export function StatePill({ state }: { state: DeskState }) {
  return <span className={`world-state world-state-${state}`}>{DESK_LABEL[state]}</span>;
}

function Gone({ what }: { what: string }) {
  return <p className="world-meta">{what}</p>;
}
