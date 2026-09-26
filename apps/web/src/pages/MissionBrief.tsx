import { AlertTriangle, ArrowRight, Check, CircleDashed, Play, ShieldQuestion } from "lucide-react";

import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  executeWork,
  fetchMissionIntelligence,
  formatRelativeTime,
  prepareMission,
  type CheckState,
  type MissionIntelligence,
  type MissionKnowledgeContext,
  type PlanStep,
  type PreflightCheck,
  type PreflightState,
} from "../lib/api";

import { kindLabel, knowledgeStatusLabel } from "../lib/knowledge";
import { useResource } from "../lib/useResource";

import {
  Chapter,
  Connecting,
  Failure,
  StatusPill,
} from "../components/primitives";

import { toneClass, type Tone } from "../lib/tone";

/**
 * What UNIOFFICE understood, and whether it can do it.
 *
 * Between typing a sentence and a worker running it there used to be nothing
 * at all: the first thing a person learned about how their request had been
 * read was the result of acting on it. This is the page that sits in that
 * gap, and everything on it is the server's answer about a mission that
 * really exists - the steps below are the task rows a worker will pick up,
 * not a preview of them.
 *
 * It reads in the order a person actually asks:
 *
 *   the brief      this is what I understood you to want
 *   the preflight  this is whether the company can do it, right now
 *   the plan       this is how, and who
 *
 * Starting is a separate, deliberate request. The preflight is a reading of
 * this instant and says so; the server checks everything again when the
 * mission actually starts, so nothing here is trusted as permission.
 */

const CHECK_ICON: Record<CheckState, LucideIcon> = {
  ok: Check,
  warning: ShieldQuestion,
  blocked: AlertTriangle,
  unknown: CircleDashed,
};

const CHECK_TONE: Record<CheckState, Tone> = {
  ok: "live",
  warning: "warning",
  blocked: "error",
  unknown: "idle",
};

const STATE_TONE: Record<PreflightState, Tone> = {
  ready: "live",
  partially_ready: "warning",
  blocked: "error",
  unknown: "idle",
};

const STATE_LABEL: Record<PreflightState, string> = {
  ready: "Ready",
  partially_ready: "Ready, with a limit",
  blocked: "Blocked",
  unknown: "Not checked",
};

/** How long a plan takes to write, said honestly rather than as a spinner. */
const PREPARING = "Working out who should do this, and in what order. This usually takes a minute or two.";

export default function MissionBrief() {
  const { missionId = "" } = useParams();
  const navigate = useNavigate();

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();

  // Whether the verdict is on screen. On a phone the launch bar gives way -
  // it rests at the end of the page instead of riding the bottom edge - for
  // as long as any of the verdict is visible, so the bar can never sit over
  // the one statement it exists to act on. Sticky elements keep their place
  // in the flow either way, so nothing moves when it does.
  const [verdict, setVerdict] = useState<HTMLDivElement | null>(null);
  const [verdictInView, setVerdictInView] = useState(false);

  useEffect(() => {
    if (!verdict || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(([entry]) => setVerdictInView(entry?.isIntersecting ?? false));
    observer.observe(verdict);

    return () => observer.disconnect();
  }, [verdict]);

  const intelligence = useResource<MissionIntelligence>(
    useCallback(() => fetchMissionIntelligence(missionId), [missionId]),
    // Only while the plan is still being written does this need to be live;
    // the poll stops as soon as there is something to decide on.
    { pollMs: 5_000 },
  );

  const data = intelligence.data;
  const stage = data?.stage;
  const preparing = stage === "planning";

  // A mission that arrives here unplanned is planned once, on the server, and
  // the page then watches for the steps to appear. The ref keeps that to one
  // request under StrictMode and across the poll.
  const asked = useRef(false);

  useEffect(() => {
    if (stage !== "awaiting_plan" || asked.current || !missionId) return;
    asked.current = true;

    void prepareMission(missionId)
      .then(() => intelligence.reload())
      .catch(() => {
        // The page reads the mission's own state, so a failed request shows
        // up as the mission not being prepared rather than as a toast.
        asked.current = false;
      });
  }, [stage, missionId, intelligence]);

  async function start() {
    if (!data || starting) return;

    setStarting(true);
    setStartError(undefined);

    try {
      await executeWork(missionId);
      navigate(`/missions/${missionId}`);
    } catch (error) {
      setStartError((error as Error).message);
      setStarting(false);
    }
  }

  if (!data) {
    return (
      <div className="mission-intel mx-auto max-w-[1000px] fade-up">
        {intelligence.error ? (
          <Failure
            headline="This mission could not be read"
            detail={intelligence.error.message}
            consequence={
              intelligence.error.isOffline
                ? "The mission itself is unaffected. This page just cannot see it."
                : undefined
            }
            action={
              <>
                <button type="button" onClick={intelligence.reload} className="button-ghost">
                  Try again
                </button>
                <Link to="/missions" className="button-quiet">
                  Every mission
                </Link>
              </>
            }
          />
        ) : (
          <Connecting what="Reading the mission…" />
        )}
      </div>
    );
  }

  const { brief, preflight, plan } = data;

  // A mission already on its way is not a thing to decide about. It is shown
  // for reference, and the room is where it is actually watched.
  const decidable = stage === "planned" || stage === "planning_failed";

  return (
    <div className="mission-intel mx-auto max-w-[1000px] fade-up">
      <div className="t-eyebrow mb-4">Before this runs</div>

      <h2 className="intel-title">{brief.title}</h2>

      <div className="intel-lede">
        <span className="intel-lede-label">You asked for</span>
        <p className="intel-objective">{brief.objective}</p>
      </div>

      {brief.briefing && (
        <div className="intel-lede">
          <span className="intel-lede-label">You added</span>
          <p className="intel-briefing">{brief.briefing}</p>
        </div>
      )}

      <div className="intel-facts">
        {brief.workspace && <Fact label="Works in" value={brief.workspace.name} />}
        <Fact label="Priority" value={brief.priority} />
        {plan && <Fact label="Steps" value={String(plan.steps.length)} />}
        {plan && plan.approvalCount > 0 && <Fact label="Needs you" value={`${plan.approvalCount}`} />}
      </div>

      {preparing ? (
        <div className="intel-preparing" role="status">
          <Connecting what={PREPARING} />
        </div>
      ) : (
        <>
          <Chapter index="01" title="What this will achieve" />

          {brief.successCriteria.length === 0 ? (
            <p className="intel-note">
              Nothing has been worked out yet, so there is nothing to claim about what this will do.
            </p>
          ) : (
            <ul className="intel-criteria">
              {brief.successCriteria.map((line) => (
                <li key={line.text}>{line.text}</li>
              ))}
            </ul>
          )}

          {brief.workAreas.length > 0 && (
            <p className="intel-note">
              The work calls for {readable(brief.workAreas)}.
            </p>
          )}

          {brief.participants.length > 0 && (
            <div className="intel-cast">
              {brief.participants.map((participant) => (
                <Link key={participant.id} to={`/workforce/${participant.id}`} className="intel-cast-member">
                  <span className="intel-cast-name">{participant.name}</span>
                  <span className="intel-cast-role">{participant.role}</span>
                </Link>
              ))}
            </div>
          )}

          {brief.gaps.length > 0 && (
            <div className="intel-gaps">
              <div className="detail-label mb-2">What this does not know</div>
              <ul>
                {brief.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          )}

          <Chapter index="02" title="Can the company do it" />

          <div ref={setVerdict} className={`intel-verdict intel-verdict-${preflight.state}`}>
            <StatusPill tone={STATE_TONE[preflight.state]}>{STATE_LABEL[preflight.state]}</StatusPill>
            <p className="intel-verdict-line">{preflight.headline}</p>
            <p className="intel-verdict-detail">{preflight.detail}</p>
          </div>

          {preflight.checks.length > 0 && (
            <ul className="intel-checks">
              {preflight.checks.map((check) => (
                <Check_ key={check.id} check={check} />
              ))}
            </ul>
          )}

          {plan && (
            <>
              <Chapter index="03" title="How it will be done" />

              {plan.hasCycle && (
                <p className="intel-note intel-note-warning">
                  These steps wait on each other in a circle, so some of them could never begin.
                </p>
              )}

              <ol className="intel-plan">
                {plan.steps.map((step) => (
                  <Step key={step.number} step={step} />
                ))}
              </ol>

              {plan.expectedOutputs.length > 0 && (
                <div className="intel-outputs">
                  <div className="detail-label mb-2">What you get</div>
                  <ul>
                    {plan.expectedOutputs.map((output) => (
                      <li key={output}>{output}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Absent from an older API, where the heading alone would
                  promise an answer the server never gave. */}
              {data.knowledge && (
                <>
                  <Chapter index="04" title="What the company already knew" />
                  <KnowledgeUsed knowledge={data.knowledge} />
                </>
              )}
            </>
          )}
        </>
      )}

      {/* The launch bar. It stays in view while the plan is read, so the
          decision and what it commits to are never a scroll away; while the
          start request is in flight it says so, for exactly that long. */}
      <div
        className={`intel-commit${decidable && preflight.canStart ? " intel-commit-armed" : ""}${starting ? " intel-commit-starting" : ""}${verdictInView ? " intel-commit-yield" : ""}`}
      >
        {!preparing && plan && (
          <span className={`intel-commit-summary ${toneClass[STATE_TONE[preflight.state]]}`}>
            <span className="pill-dot" aria-hidden="true" />
            {plan.steps.length} {plan.steps.length === 1 ? "step" : "steps"}
            {plan.approvalCount > 0 && (
              <> · {plan.approvalCount} {plan.approvalCount === 1 ? "waits" : "wait"} for you</>
            )}
          </span>
        )}

        {startError && (
          <Failure
            headline="This mission could not be started"
            detail={startError}
            consequence="Nothing was started. The plan above is unchanged."
          />
        )}

        {decidable && preflight.canStart && (
          <>
            <button type="button" onClick={start} disabled={starting} className="button-primary">
              <Play size={13} />
              {starting ? "Starting…" : "Start mission"}
            </button>
            <p className="intel-commit-note">
              {preflight.state === "partially_ready"
                ? "It will run with the limit above."
                : "Nothing has run yet. This is what starts it."}
            </p>
          </>
        )}

        {decidable && !preflight.canStart && preflight.startNote && (
          <p className="intel-commit-note">{preflight.startNote}</p>
        )}

        {!decidable && !preparing && (
          <Link to={`/missions/${missionId}`} className="button-primary">
            Watch it run
            <ArrowRight size={11} />
          </Link>
        )}

        <Link to={`/missions/${missionId}`} className="button-quiet">
          {decidable ? "Open the mission instead" : "The execution room"}
        </Link>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   What the company already knew
   -------------------------------------------------------------------------- */

/**
 * The company knowledge this plan was built on.
 *
 * Everything here was handed to the planner when the plan was written, and
 * says so - with what it is, when the company established it, whether anyone
 * has vouched for it, and one click to the entry itself and the mission that
 * produced it. That provenance is the point. Knowledge that arrives in a plan
 * without a source is indistinguishable from something the model made up, and
 * the moment a person cannot tell those apart, neither is worth anything.
 *
 * An empty list is four different sentences depending on why it is empty,
 * because "the company knew nothing about this" is a real and useful thing to
 * learn, and saying it when a query merely failed is a lie.
 */
function KnowledgeUsed({ knowledge }: { knowledge: MissionKnowledgeContext }) {
  const withheld = knowledge.withheldCount > 0 && (
    <p className="intel-note">
      A company rule kept {knowledge.withheldCount}{" "}
      {knowledge.withheldCount === 1 ? "piece" : "pieces"} of company knowledge out of this plan.
    </p>
  );

  if (knowledge.used.length === 0) {
    return (
      <>
        <p className="intel-note">
          {knowledge.state === "available"
            ? "The company had nothing recorded about this, so the plan starts from your request alone."
            : knowledge.state === "unavailable"
              ? "What the company knew could not be read just now. The plan itself is unaffected."
              : "The company has not been asked yet. It is, once the plan is written."}
        </p>
        {withheld}
      </>
    );
  }

  return (
    <>
      <p className="intel-note">
        The planner was given {knowledge.used.length}{" "}
        {knowledge.used.length === 1 ? "piece" : "pieces"} of what the company already knows.
      </p>

      <ul className="intel-knowledge">
        {knowledge.used.map((entry) => (
          <li key={entry.id} className="intel-knowledge-entry">
            <Link to={`/brain/${entry.id}`} className="intel-knowledge-title">
              {entry.title}
            </Link>

            <span className="intel-knowledge-meta">
              <span>{kindLabel(entry.type)}</span>
              <span>{knowledgeStatusLabel(entry.status)}</span>
              <span>{formatRelativeTime(entry.establishedAt)}</span>
              {entry.disputed && <span className="intel-knowledge-disputed">disputed</span>}
            </span>

            {entry.status === "proposed" && (
              <span className="intel-knowledge-caveat">
                Nobody has vouched for this yet; the planner was given it as an unverified lead.
              </span>
            )}

            {entry.disputed && (
              <span className="intel-knowledge-caveat">
                Another piece of company knowledge disagrees with this, and nobody has settled it.
              </span>
            )}

            {entry.reasons.length > 0 && (
              <span className="intel-knowledge-why">Recalled because it {readable(entry.reasons)}.</span>
            )}

            {entry.sourceMissionId && (
              <Link to={`/missions/${entry.sourceMissionId}`} className="intel-knowledge-source">
                View source mission
                <ArrowRight size={11} />
              </Link>
            )}
          </li>
        ))}
      </ul>

      {withheld}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="intel-fact">
      <span className="intel-fact-label">{label}</span>
      <span className="intel-fact-value">{value}</span>
    </div>
  );
}

/** One preflight check. Named oddly so it does not shadow the lucide icon. */
function Check_({ check }: { check: PreflightCheck }) {
  const Icon = CHECK_ICON[check.state];

  return (
    <li className={`intel-check intel-check-${check.state}`}>
      <Icon size={14} strokeWidth={2} className={`tone-${CHECK_TONE[check.state]}`} aria-hidden="true" />

      <div className="min-w-0">
        <div className="intel-check-name">
          {check.name}
          {check.steps.length > 0 && (
            <span className="intel-check-steps">
              {check.steps.length === 1 ? `Step ${check.steps[0]}` : `Steps ${check.steps.join(", ")}`}
            </span>
          )}
        </div>

        <p className="intel-check-summary">{check.summary}</p>

        {check.fix && (
          <Link to={check.fix.path} className="button-quiet mt-2 inline-flex">
            {check.fix.label}
            <ArrowRight size={11} />
          </Link>
        )}
      </div>
    </li>
  );
}

function Step({ step }: { step: PlanStep }) {
  return (
    <li
      className={`intel-step${step.needsApproval ? " intel-step-gated" : ""}${step.agent ? "" : " intel-step-unassigned"}`}
    >
      <span className="intel-step-number" aria-hidden="true">{step.number}</span>

      <div className="min-w-0">
        <div className="intel-step-title">{step.title}</div>

        <div className="intel-step-meta">
          {step.agent ? (
            <Link to={`/workforce/${step.agent.id}`} className="intel-step-agent">
              {step.agent.name}
            </Link>
          ) : (
            <span className="intel-step-agent intel-step-agent-none">Nobody yet</span>
          )}

          {step.ability && <span className="intel-step-ability">{step.ability}</span>}

          {step.dependsOn.length > 0 && (
            <span className="intel-step-after">
              after {step.dependsOn.length === 1 ? `step ${step.dependsOn[0]}` : `steps ${step.dependsOn.join(" and ")}`}
            </span>
          )}

          {step.needsApproval && <StatusPill tone="warning">Waits for you</StatusPill>}
        </div>

        {step.why && <p className="intel-step-why">{step.why}</p>}

        {step.approvalReason && (
          <p className="intel-step-why intel-step-why-warning">{step.approvalReason}</p>
        )}

        {step.problem && <p className="intel-step-why intel-step-why-warning">{step.problem}</p>}

        <details className="tech-detail mt-2">
          <summary>How this was decided</summary>

          <dl className="intel-technical">
            {step.technical.selectionReason && (
              <>
                <dt>Routing</dt>
                <dd>{step.technical.selectionReason}</dd>
              </>
            )}

            {step.technical.skill && (
              <>
                <dt>Skill</dt>
                <dd>
                  {step.technical.skill.slug} v{step.technical.skill.version} ({step.technical.skill.scope})
                </dd>
              </>
            )}

            {step.technical.requiredTools.length > 0 && (
              <>
                <dt>Tools</dt>
                <dd>{step.technical.requiredTools.join(", ")}</dd>
              </>
            )}

            {step.technical.requiredCapabilities.length > 0 && (
              <>
                <dt>Capabilities</dt>
                <dd>{step.technical.requiredCapabilities.join(", ")}</dd>
              </>
            )}
          </dl>
        </details>
      </div>
    </li>
  );
}

function readable(values: string[]): string {
  if (values.length === 1) return values[0]!.toLowerCase();
  return `${values.slice(0, -1).join(", ").toLowerCase()} and ${values.at(-1)!.toLowerCase()}`;
}
