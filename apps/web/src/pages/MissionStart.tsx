import { ArrowRight, LoaderCircle, Plus, Zap } from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  createWork,
  fetchAgents,
  type AgentSummary,
  type WorkItem,
} from "../lib/api";

import { useResource } from "../lib/useResource";
import { orchestratorOf } from "../lib/mission";
import { Failure } from "../components/primitives";

/**
 * Opening a mission.
 *
 * This is a page and not a modal because it is the one thing in the product a
 * person comes here to do, and because the objective deserves to be set at the
 * size the company will treat it. Everything past the objective is optional and
 * stays out of sight until it is asked for - the first interaction is a
 * sentence, not a form.
 */

const PRIORITIES: Array<{ id: WorkItem["priority"]; label: string; note: string }> = [
  { id: "low", label: "Low", note: "Whenever there is room." },
  { id: "normal", label: "Normal", note: "The usual order of things." },
  { id: "high", label: "High", note: "Ahead of the ordinary queue." },
  { id: "critical", label: "Critical", note: "Before anything else." },
];

/**
 * Starters are real objectives this company can actually carry: two of them
 * exercise tools it genuinely has, and one is pure knowledge work. Nothing
 * here promises a capability the workforce does not hold.
 */
const STARTERS = [
  "Calculate our total monthly operating cost from salaries 48200, cloud 9350, lease 12500 and licences 3875, then explain what it means for runway.",
  "Tell me what day of the week 25 December 2027 falls on and how many days away it is.",
  "Draft a one-page competitor brief covering positioning, pricing and the gap we should attack.",
];

export default function MissionStart() {
  const navigate = useNavigate();

  const [objective, setObjective] = useState("");
  const [briefing, setBriefing] = useState("");
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [priority, setPriority] = useState<WorkItem["priority"]>("normal");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();

  // Only to name the agent that will do the planning, so the page can say who
  // picks the objective up rather than saying "the system".
  const roster = useResource<AgentSummary[]>(
    useCallback(() => fetchAgents(), []),
  );

  const planner = orchestratorOf(roster.data ?? []);
  const ready = objective.trim().length > 0 && !opening;

  async function open() {
    if (!ready) return;

    setOpening(true);
    setError(undefined);

    try {
      const work = await createWork({
        objective: objective.trim(),
        priority,
        briefing: briefing.trim() || undefined,
      });

      // The mission surface takes it from here: it runs the planning and the
      // queueing itself, so the person watches the operation start on the page
      // that will keep showing it rather than at a spinner on this one.
      navigate(`/missions/${work.id}`, { state: { autostart: true } });
    } catch (caught) {
      setError((caught as Error).message);
      setOpening(false);
    }
  }

  return (
    <div className="mission-brief-sheet fade-up">
      <div className="t-eyebrow mb-5">Open a mission</div>

      <h2 className="mission-ask">
        Tell the company
        <span className="mission-ask-quiet">what needs to happen.</span>
      </h2>

      <p className="mission-ask-detail">
        {planner
          ? `${planner} turns it into a plan, routes each task to whoever holds the right capability, and the workforce executes it. You are asked only when a step needs a person.`
          : "It becomes a plan, each task goes to whoever holds the right capability, and the workforce executes it. You are asked only when a step needs a person."}
      </p>

      <div className="mission-field">
        <label className="mission-field-label" htmlFor="mission-objective">
          The objective
        </label>

        <textarea
          id="mission-objective"
          autoFocus
          rows={3}
          value={objective}
          disabled={opening}
          onChange={(event) => setObjective(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void open();
            }
          }}
          placeholder="Prepare a plan for launching our new product next month."
          className="mission-input"
        />

        <p className="mission-hint">
          One outcome, in your own words. Ctrl + Enter opens it.
        </p>
      </div>

      {briefingOpen ? (
        <div className="mission-field">
          <label className="mission-field-label" htmlFor="mission-briefing">
            Anything it should know
          </label>

          <textarea
            id="mission-briefing"
            autoFocus
            rows={4}
            value={briefing}
            disabled={opening}
            onChange={(event) => setBriefing(event.target.value)}
            placeholder="Constraints, figures, background — whatever the objective alone leaves out."
            className="mission-input mission-input-small"
          />

          <p className="mission-hint">
            This is read at planning time, so it shapes the tasks that get
            written rather than sitting in a field nobody looks at.
          </p>
        </div>
      ) : (
        <button
          type="button"
          className="button-quiet mt-6"
          onClick={() => setBriefingOpen(true)}
          disabled={opening}
        >
          <Plus size={12} />
          Add context
        </button>
      )}

      <div className="mission-field">
        <span className="mission-field-label">How much it matters</span>

        <div className="mission-weights">
          {PRIORITIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={opening}
              title={entry.note}
              onClick={() => setPriority(entry.id)}
              className={`mission-weight${priority === entry.id ? " mission-weight-on" : ""}`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <p className="mission-hint">
          {PRIORITIES.find((entry) => entry.id === priority)?.note}
        </p>
      </div>

      {error && (
        <div className="mt-6">
          <Failure
            headline="The mission was not opened"
            detail={error}
            consequence="Nothing was recorded. Nothing is running."
            action={
              <button type="button" onClick={open} className="button-ghost">
                Try again
              </button>
            }
          />
        </div>
      )}

      <div className="mission-launch">
        <button
          type="button"
          onClick={open}
          disabled={!ready}
          className="button-primary"
        >
          {opening ? (
            <LoaderCircle size={13} className="spin-slow" />
          ) : (
            <Zap size={13} />
          )}
          {opening ? "Opening…" : "Open the mission"}
        </button>

        <Link to="/missions" className="button-quiet">
          Every mission
          <ArrowRight size={11} />
        </Link>

        <p className="mission-launch-note">
          Nothing runs until the plan exists. You will see it being written.
        </p>
      </div>

      <div className="mission-starters">
        <div className="t-eyebrow mb-2">Or start from one of these</div>

        {STARTERS.map((starter) => (
          <button
            key={starter}
            type="button"
            disabled={opening}
            onClick={() => setObjective(starter)}
            className="mission-starter"
          >
            {starter}
          </button>
        ))}
      </div>
    </div>
  );
}
