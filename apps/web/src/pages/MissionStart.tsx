import { ArrowRight, LoaderCircle, Plus, Zap } from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  createWork,
  fetchAgents,
  fetchMissionTemplates,
  fetchWorkspaces,
  type AgentSummary,
  type MissionTemplateView,
  type WorkItem,
  type WorkspaceSummary,
} from "../lib/api";

import { useCan } from "../lib/access";
import { useResource } from "../lib/useResource";
import { orchestratorOf } from "../lib/mission";
import { EmptyState, ErrorState, Failure, Skeleton } from "../components/primitives";
import { TemplateCard } from "../components/templates/TemplateCard";
import { WorkspaceMark } from "../components/WorkspaceMark";

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

export default function MissionStart() {
  const navigate = useNavigate();

  // A mission opened from inside a workspace arrives with it already chosen,
  // which is the difference between "where does this belong" being a question
  // and being a fact you carried in with you.
  const [params] = useSearchParams();

  const [objective, setObjective] = useState("");
  const [briefing, setBriefing] = useState("");
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [priority, setPriority] = useState<WorkItem["priority"]>("normal");
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    params.get("workspace"),
  );
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();

  // Whether this person may open a mission where it is about to go. A viewer,
  // or a member without a working grant in the chosen workspace, is told so
  // before typing an objective the API would refuse.
  const canCreate = useCan("missions.create", workspaceId);

  // Only to name the agent that will do the planning, so the page can say who
  // picks the objective up rather than saying "the system".
  const roster = useResource<AgentSummary[]>(
    useCallback(() => fetchAgents(), []),
  );

  const workspaces = useResource<WorkspaceSummary[]>(
    useCallback(() => fetchWorkspaces(), []),
  );

  const templates = useResource<MissionTemplateView[]>(
    useCallback(() => fetchMissionTemplates(), []),
  );

  const planner = orchestratorOf(roster.data ?? []);
  const ready = objective.trim().length > 0 && !opening && canCreate;

  async function open() {
    if (!ready) return;

    setOpening(true);
    setError(undefined);

    try {
      const work = await createWork({
        objective: objective.trim(),
        priority,
        briefing: briefing.trim() || undefined,
        workspaceId: workspaceId ?? undefined,
      });

      // Nothing runs yet. The brief takes it from here: it has the plan
      // written on the server, shows what was understood and whether the
      // company can actually do it, and only then offers to start it. An
      // objective going straight to a worker was how a misread request, or a
      // workforce short of a tool, first became visible in the result.
      navigate(`/missions/${work.id}/brief`);
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
          ? `${planner} turns it into a plan and routes each step to whoever can actually do it. You see what that plan is, and what it needs, before anything runs.`
          : "It becomes a plan, and each step goes to whoever can actually do it. You see what that plan is, and what it needs, before anything runs."}
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

      {(workspaces.data?.length ?? 0) > 0 && (
        <div className="mission-field">
          <span className="mission-field-label">Where it runs</span>

          <div className="config-choices mt-3">
            <button
              type="button"
              disabled={opening}
              onClick={() => setWorkspaceId(null)}
              className={`config-choice${workspaceId === null ? " config-choice-on" : ""}`}
            >
              The whole company
            </button>

            {(workspaces.data ?? [])
              .filter((entry) => entry.workspace.status === "active")
              .map((entry) => (
                <button
                  key={entry.workspace.id}
                  type="button"
                  disabled={opening}
                  onClick={() => setWorkspaceId(entry.workspace.id)}
                  className={`config-choice${
                    workspaceId === entry.workspace.id ? " config-choice-on" : ""
                  }`}
                >
                  <WorkspaceMark slug={entry.workspace.slug} size={12} />
                  {entry.workspace.name}
                </button>
              ))}
          </div>

          <p className="mission-hint">
            {workspaceId === null
              ? "Anyone on the roster can be given this work."
              : `Only agents in ${
                  workspaces.data?.find(
                    (entry) => entry.workspace.id === workspaceId,
                  )?.workspace.name ?? "that workspace"
                }, and agents belonging to no workspace, can be given any of it.`}
          </p>
        </div>
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
          {canCreate
            ? "Nothing runs until the plan exists. You will see it being written."
            : workspaceId
              ? "Your access to this workspace lets you see its missions, not open them."
              : "Your role lets you see missions, not open them."}
        </p>
      </div>

      <section className="templates" id="templates" aria-labelledby="templates-title">
        <div className="templates-head">
          <span id="templates-title" className="templates-title">
            Or start from a template
          </span>
          <span className="t-machine">
            Kinds of mission the company knows how to brief
          </span>
        </div>

        {templates.loading ? (
          <div className="py-5" aria-busy="true">
            <Skeleton rows={4} />
          </div>
        ) : templates.error ? (
          <ErrorState
            message={templates.error.message}
            offline={templates.error.isOffline}
            onRetry={templates.reload}
          />
        ) : (templates.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No templates are available"
            description="You can still describe the mission in your own words above."
          />
        ) : (
          <div className="templates-grid">
            {templates.data!.map((view, index) => (
              <TemplateCard key={view.template.id} view={view} index={index} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
