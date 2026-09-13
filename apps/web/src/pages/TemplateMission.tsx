import { ArrowLeft, LoaderCircle, Zap } from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  fetchMissionTemplate,
  fetchWorkspaces,
  startTemplateMission,
  TEMPLATE_INPUT_LIMITS,
  type MissionTemplateField,
  type MissionTemplateView,
  type WorkItem,
  type WorkspaceSummary,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  Chip,
  EmptyState,
  ErrorState,
  Failure,
  Skeleton,
  StatusPill,
} from "../components/primitives";

import { WorkspaceMark } from "../components/WorkspaceMark";
import {
  COMPLEXITY_DETAIL,
  COMPLEXITY_LABEL,
  validateTemplateInput,
  type TemplateFieldKey as FieldKey,
} from "../lib/templates";

/**
 * Configuring a mission from a template.
 *
 * The template asks the questions its kind of mission needs; the answers
 * become a normal mission. Starting it opens the execution room, which runs
 * the plan, governance and the queue exactly as it does for any mission, so
 * the person watches the operation begin where it will keep being shown.
 */

const PRIORITIES: Array<{ id: WorkItem["priority"]; label: string }> = [
  { id: "low", label: "Low" },
  { id: "normal", label: "Normal" },
  { id: "high", label: "High" },
  { id: "critical", label: "Critical" },
];

export default function TemplateMission() {
  const { templateId = "" } = useParams();
  const navigate = useNavigate();

  const [values, setValues] = useState<Record<FieldKey, string>>({
    name: "",
    objective: "",
    context: "",
    desiredOutcome: "",
    constraints: "",
  });
  const [priority, setPriority] = useState<WorkItem["priority"]>("normal");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  const view = useResource<MissionTemplateView>(
    useCallback(() => fetchMissionTemplate(templateId), [templateId]),
    { enabled: Boolean(templateId) },
  );

  const workspaces = useResource<WorkspaceSummary[]>(
    useCallback(() => fetchWorkspaces(), []),
  );

  const errors = validateTemplateInput(values);
  const valid = Object.keys(errors).length === 0;

  function update(key: FieldKey, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function start() {
    setAttempted(true);

    if (!valid || starting) return;

    setStarting(true);
    setError(undefined);

    try {
      const work = await startTemplateMission(templateId, {
        ...values,
        priority,
        workspaceId: workspaceId ?? undefined,
      });

      // The execution room plans it and puts it on the queue, the same way it
      // does for every newly opened mission.
      navigate(`/missions/${work.id}`, { state: { autostart: true } });
    } catch (caught) {
      setError((caught as Error).message);
      setStarting(false);
    }
  }

  if (view.loading) {
    return (
      <div className="template-sheet" aria-busy="true">
        <div className="t-eyebrow mb-5">Start from a template</div>
        <Skeleton rows={6} />
      </div>
    );
  }

  if (view.error || !view.data) {
    const notFound = view.error instanceof ApiError && view.error.status === 404;

    return (
      <div className="template-sheet">
        {notFound ? (
          <EmptyState
            title="That template does not exist"
            description="It may have been renamed. Every template the company can start is listed on the mission page."
            action={<Link to="/missions/new" className="button-ghost">See the templates</Link>}
          />
        ) : (
          <ErrorState
            message={view.error?.message ?? "The template could not be read."}
            offline={view.error?.isOffline}
            onRetry={view.reload}
          />
        )}
      </div>
    );
  }

  const { template, likelyTeam, planner, governance } = view.data;
  const show = (key: FieldKey) => (attempted ? errors[key] : undefined);

  return (
    <div className="template-sheet fade-up">
      <Link to="/missions/new" className="template-back">
        <ArrowLeft size={12} />
        All templates
      </Link>

      <div className="t-eyebrow mb-4">Start from a template</div>

      <h2 className="mission-ask">
        {template.name}
        <span className="mission-ask-quiet">{template.outcome}.</span>
      </h2>

      <p className="mission-ask-detail">{template.purpose}</p>

      <div className="template-layout">
        <form
          className="min-w-0"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <TemplateInput
            id="template-objective"
            field={template.objective}
            value={values.objective}
            limit={TEMPLATE_INPUT_LIMITS.objective}
            rows={2}
            required
            disabled={starting}
            error={show("objective")}
            onChange={(value) => update("objective", value)}
          />

          <TemplateInput
            id="template-outcome"
            field={template.desiredOutcome}
            value={values.desiredOutcome}
            limit={TEMPLATE_INPUT_LIMITS.desiredOutcome}
            rows={2}
            required
            disabled={starting}
            error={show("desiredOutcome")}
            onChange={(value) => update("desiredOutcome", value)}
          />

          <TemplateInput
            id="template-context"
            field={template.context}
            value={values.context}
            limit={TEMPLATE_INPUT_LIMITS.context}
            rows={4}
            disabled={starting}
            error={show("context")}
            onChange={(value) => update("context", value)}
          />

          <TemplateInput
            id="template-constraints"
            field={template.constraints}
            value={values.constraints}
            limit={TEMPLATE_INPUT_LIMITS.constraints}
            rows={2}
            disabled={starting}
            error={show("constraints")}
            onChange={(value) => update("constraints", value)}
          />

          <TemplateInput
            id="template-name"
            field={{
              label: "Name it (optional)",
              placeholder: `${template.name} — ${new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}`,
              hint: "A short label for the mission list. The objective stays the headline.",
            }}
            value={values.name}
            limit={TEMPLATE_INPUT_LIMITS.name}
            rows={1}
            disabled={starting}
            error={show("name")}
            onChange={(value) => update("name", value)}
          />

          {(workspaces.data?.length ?? 0) > 0 && (
            <div className="mission-field">
              <span className="mission-field-label">Where it runs</span>

              <div className="config-choices mt-3">
                <button
                  type="button"
                  disabled={starting}
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
                      disabled={starting}
                      onClick={() => setWorkspaceId(entry.workspace.id)}
                      className={`config-choice${workspaceId === entry.workspace.id ? " config-choice-on" : ""}`}
                    >
                      <WorkspaceMark slug={entry.workspace.slug} size={12} />
                      {entry.workspace.name}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="mission-field">
            <span className="mission-field-label">How much it matters</span>

            <div className="mission-weights">
              {PRIORITIES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  disabled={starting}
                  onClick={() => setPriority(entry.id)}
                  className={`mission-weight${priority === entry.id ? " mission-weight-on" : ""}`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mt-6">
              <Failure
                headline="The mission was not started"
                detail={error}
                consequence="Nothing was recorded. Nothing is running."
              />
            </div>
          )}

          <div className="mission-launch">
            <button
              type="submit"
              disabled={starting || (attempted && !valid)}
              className="button-primary"
            >
              {starting ? <LoaderCircle size={13} className="spin-slow" /> : <Zap size={13} />}
              {starting ? "Starting…" : "Start mission"}
            </button>

            <p className="mission-launch-note">
              Nothing runs until the plan exists. You will see it being written.
            </p>
          </div>
        </form>

        <aside className="template-aside">
          <section className="template-aside-section">
            <div className="t-eyebrow mb-3">Who is likely to take part</div>

            {planner && (
              <div className="template-member">
                <span className="template-member-name">{planner.name}</span>
                <span className="t-machine">plans and routes the work</span>
              </div>
            )}

            {likelyTeam.length === 0 ? (
              <p className="t-meta">Nobody on the roster holds this template's disciplines yet. The planner will route to the closest match.</p>
            ) : (
              likelyTeam.map((member) => (
                <div key={member.agentId} className="template-member">
                  <span className="template-member-name">{member.name}</span>
                  <span className="t-machine">{member.matchedCapabilities.map((capability) => capability.replace(/_/g, " ")).join(" · ")}</span>
                </div>
              ))
            )}
          </section>

          <section className="template-aside-section">
            <div className="t-eyebrow mb-3">What happens when you start</div>
            <ol className="template-steps">
              <li>{planner?.name ?? "The orchestrator"} writes the plan from your answers.</li>
              <li>Each step is routed to an agent that actually holds the capability.</li>
              <li>Governance checks every step and tool call as it runs.</li>
              <li>You are asked only if a step needs a person.</li>
              <li>The work runs on the durable queue; the execution room shows it live.</li>
            </ol>
          </section>

          <section className="template-aside-section">
            <div className="t-eyebrow mb-3">Governance</div>
            {governance.gatingPolicies.length === 0 ? (
              <p className="t-meta">No active rule currently gates this team. The plan can still ask for a person on a step it judges consequential.</p>
            ) : (
              <div className="space-y-2">
                {governance.gatingPolicies.map((policy) => (
                  <div key={policy.id} className="flex items-center justify-between gap-3">
                    <span className="text-[11.5px] text-[#a7b0bd]">{policy.name}</span>
                    <StatusPill tone={policy.effect === "deny" ? "error" : "warning"}>
                      {policy.effect === "deny" ? "never" : "ask a person"}
                    </StatusPill>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="template-aside-section">
            <div className="t-eyebrow mb-3">Scope</div>
            <Chip tone="idle">{COMPLEXITY_LABEL[template.complexity]}</Chip>
            <p className="t-meta mt-2">{COMPLEXITY_DETAIL[template.complexity]}. The actual plan is the orchestrator's to decide.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function TemplateInput({
  id,
  field,
  value,
  limit,
  rows,
  required = false,
  disabled,
  error,
  onChange,
}: {
  id: string;
  field: MissionTemplateField;
  value: string;
  limit: number;
  rows: number;
  required?: boolean;
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const over = value.trim().length > limit;

  return (
    <div className="mission-field">
      <label className="mission-field-label" htmlFor={id}>
        {field.label}
        {required && <span className="template-required"> required</span>}
      </label>

      <textarea
        id={id}
        rows={rows}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder}
        className={`mission-input mission-input-small${error ? " template-input-invalid" : ""}`}
      />

      <p id={`${id}-hint`} className={`mission-hint${error ? " template-hint-error" : ""}`}>
        {error ?? field.hint}
        <span className={`template-count${over ? " template-count-over" : ""}`}>
          {value.trim().length}/{limit}
        </span>
      </p>
    </div>
  );
}
