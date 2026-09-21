import type {
  Agent,
  AgentId,
  ApprovalRequest,
  Artifact,
  ArtifactId,
  Event,
  Task,
  TaskId,
  Work,
} from "@unioffice/core";

import { clip, describeEvent, plural } from "./mission-reading.js";
import { publicFailureReason } from "./public-failure.js";

/**
 * A mission as an operation people can watch, rather than as rows.
 *
 * Three readings, all of them computed from records something else already
 * wrote - the event log, the task rows, the artifacts, the approvals. Nothing
 * here queries anything: the room has these in hand by the time it calls,
 * which is the only honest way to add a reading without adding a read.
 *
 *   the timeline   what happened, in order, in sentences
 *   the handoffs   where one specialist's finished work became another's input
 *   the outcome    whether the result is actually worth acting on
 *
 * The third is the one that matters most and is the easiest to get wrong. A
 * mission that executed perfectly can still have produced an answer nobody
 * should act on - because a step could not use the tool it was supposed to,
 * because it ran without the procedure it was planned around, because the
 * agent that took it was the closest match rather than the right one. Every
 * one of those is a fact the execution path already recorded, so the outcome
 * is derived from them and never from reading the model's prose for words
 * like "insufficient". A limitation is something the system knows it did,
 * not something guessed from what it said.
 */

/* --------------------------------------------------------------------------
   Timeline
   -------------------------------------------------------------------------- */

/**
 * What was going on at a moment. Deliberately not collapsed into "processing":
 * waiting for a person and being stuck behind a dependency look identical in a
 * progress bar and could not be more different to whoever has to act.
 */
export type TimelineState =
  | "queued"
  | "planning"
  | "running"
  | "waiting"
  | "resumed"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export interface TimelineEntry {
  at: Date;
  state: TimelineState;
  /** One sentence, in a person's words. */
  sentence: string;
  /** Who it was about, when it was about someone. */
  agent?: { id: AgentId; name: string };
  /** The step it concerned, by its number in the plan. Never an id. */
  step?: number;
}

/* --------------------------------------------------------------------------
   Handoffs
   -------------------------------------------------------------------------- */

/**
 * One specialist's finished work becoming another's input.
 *
 * This is not a presentational flourish: when a step runs, the executor hands
 * it the completed results of the steps it depends on, and that is exactly
 * what a handoff is here. It exists only where the dependency is real, the
 * upstream step actually finished, and the two steps are held by different
 * people - so nothing is dressed up as collaboration that was one agent
 * carrying on by itself.
 */
export interface Handoff {
  from: { id: AgentId; name: string };
  to: { id: AgentId; name: string };
  /** The step that produced it, and the step now using it. */
  fromStep: { number: number; title: string };
  toStep: { number: number; title: string };
  /** What was delivered, named as the artifact it really is. */
  delivered?: { artifactId: ArtifactId; name: string };
  /** Where the receiving step has got to. */
  state: "in_progress" | "waiting" | "delivered" | "stalled";
  /** One sentence describing the transition. */
  sentence: string;
  at: Date;
}

/* --------------------------------------------------------------------------
   Outcome
   -------------------------------------------------------------------------- */

export type OutcomeStatus =
  | "running"
  | "completed"
  | "completed_with_limitations"
  | "blocked"
  | "failed"
  | "cancelled";

/**
 * How much weight the result will carry.
 *
 * Four words, never a percentage, and never inferred from how much the model
 * wrote. It falls out of the limitations below: a mission that did everything
 * it set out to do is high, one that could not use a tool it needed is
 * limited, and one nobody can judge is unknown.
 */
export type Confidence = "high" | "moderate" | "limited" | "unknown";

/** Something the system knows it did that bears on the answer's worth. */
export interface Limitation {
  /**
   * tool_unavailable   - a step could not use a tool the work called for
   * procedure_missing  - a step ran without the way of working it was planned around
   * partial_match      - the agent that took a step was the closest available, not an exact fit
   * decision_refused   - a person refused a step
   * knowledge_withheld - a rule kept company knowledge out of the planning
   * step_failed        - a step did not finish
   */
  kind:
    | "tool_unavailable"
    | "procedure_missing"
    | "partial_match"
    | "decision_refused"
    | "knowledge_withheld"
    | "step_failed";
  /** One sentence a person can act on. */
  detail: string;
  /**
   * The steps it concerned, by their number in the plan. Empty when it is
   * about the mission rather than about a step. The same limitation hitting
   * several steps is one entry naming all of them rather than the identical
   * sentence repeated, which is what it looked like on a real mission.
   */
  steps: number[];
}

export interface MissionOutcome {
  status: OutcomeStatus;
  /** The status as a person reads it: "Finished with limitations". */
  label: string;
  /** One line on what it means for them. */
  summary: string;
  confidence: Confidence;
  /** Why the confidence is what it is. */
  confidenceReason: string;
  limitations: Limitation[];
  /** Steps that never ran, when something stopped the mission. */
  unfinished: string[];
  finishedAt?: Date;
}

export interface MissionNarrative {
  timeline: TimelineEntry[];
  handoffs: Handoff[];
  outcome: MissionOutcome;
}

export interface NarrativeInput {
  work: Work;
  tasks: Task[];
  events: Event[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  agents: Agent[];
  /** Knowledge a rule kept out of planning, as the plan recorded it. */
  withheldKnowledge?: number;
}

/**
 * The three readings, from rows the caller already holds.
 *
 * A plain function rather than a service class: it owns no state, reaches
 * nothing, and is called from inside a read that has already authorized
 * itself. Making it a class would only give it somewhere to hide a query.
 */
export function readNarrative(input: NarrativeInput): MissionNarrative {
  const { work, tasks, events, artifacts, approvals, agents } = input;

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  // Steps are referred to by their place in the plan, everywhere. A task id
  // is the right thing to store and the wrong thing to say out loud.
  const ordered = [...tasks].sort(byCreation);
  const numberOf = new Map(ordered.map((task, index) => [task.id, index + 1]));

  return {
    timeline: buildTimeline(work, events, agentsById, numberOf),
    handoffs: buildHandoffs(ordered, numberOf, agentsById, artifacts),
    outcome: readOutcome(input, ordered, numberOf),
  };
}

/* --------------------------------------------------------------------------
   Timeline
   -------------------------------------------------------------------------- */

/**
 * The event log, read as a story.
 *
 * The sentences are the ones the mission record already uses, so the timeline
 * and every other surface say the same thing about the same event. What is
 * added is the state each moment was in, which is what lets waiting for a
 * person look different from working - and an event nothing can be said about
 * is left out rather than rendered as its own type name.
 */
function buildTimeline(
  work: Work,
  events: Event[],
  agents: Map<AgentId, Agent>,
  numberOf: Map<TaskId, number>,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const event of [...events].sort(byTime)) {
    const state = stateOfEvent(event);
    if (!state) continue;

    const sentence = describeEvent(event, agents);
    if (!sentence) continue;

    const agent = event.agentId ? agents.get(event.agentId) : undefined;

    entries.push({
      at: event.timestamp,
      state,
      sentence,
      agent: agent ? { id: agent.id, name: agent.name } : undefined,
      step: event.taskId ? numberOf.get(event.taskId) : undefined,
    });
  }

  // A mission that has been opened and nothing else still has a beginning,
  // and a timeline that starts at "plan written" loses it.
  if (!events.some((event) => event.type === "work.created")) {
    entries.unshift({
      at: work.createdAt,
      state: "queued",
      sentence: "The mission was opened",
    });
  }

  return entries;
}

/**
 * Which state an event put the mission in. Events that are bookkeeping rather
 * than narrative - a tool call, an agent row being edited - have none, and
 * are left out of the story entirely.
 */
function stateOfEvent(event: Event): TimelineState | undefined {
  switch (event.type) {
    case "work.created":
      return "queued";
    case "work.planning_started":
    case "work.planning_completed":
      return "planning";
    case "work.queued":
      return event.payload.reason === "approval_resumed" || event.payload.reason === "retry"
        ? "resumed"
        : "queued";
    case "work.started":
    case "work.retried":
    case "task.started":
      return "running";
    case "task.completed":
    case "artifact.created":
      return "completed";
    case "work.completed":
      return "completed";
    case "approval.requested":
    case "governance.approval_required":
      return "waiting";
    case "approval.approved":
      return "resumed";
    case "approval.rejected":
    case "governance.denied":
      return "blocked";
    case "task.failed":
    case "work.failed":
      return "failed";
    case "work.cancelled":
    case "task.cancelled":
      return "cancelled";
    case "external.read":
    case "external.write":
      return "running";
    default:
      return undefined;
  }
}

/* --------------------------------------------------------------------------
   Handoffs
   -------------------------------------------------------------------------- */

/**
 * Where one person's finished work became another's input.
 *
 * Built from the dependency edges the planner wrote and the results the
 * executor actually produced - the same pair the executor itself uses when it
 * hands a step its dependencies' output. Three things all have to be true, and
 * the third is what keeps this honest: the edge exists, the upstream step
 * finished, and the two steps are held by different agents. One agent doing
 * two steps in a row is not a handoff, however much it would flatter the
 * product to draw it as one.
 */
function buildHandoffs(
  ordered: Task[],
  numberOf: Map<TaskId, number>,
  agents: Map<AgentId, Agent>,
  artifacts: Artifact[],
): Handoff[] {
  const byId = new Map(ordered.map((task) => [task.id, task]));
  const handoffs: Handoff[] = [];

  for (const receiving of ordered) {
    const to = receiving.assignedAgentId ? agents.get(receiving.assignedAgentId) : undefined;
    if (!to) continue;

    for (const dependencyId of receiving.dependsOn) {
      const producing = byId.get(dependencyId);
      if (!producing || producing.status !== "completed") continue;

      const from = producing.assignedAgentId ? agents.get(producing.assignedAgentId) : undefined;
      if (!from || from.id === to.id) continue;

      const artifact = artifacts.find((entry) => entry.taskId === producing.id);
      const state = handoffState(receiving);

      handoffs.push({
        from: { id: from.id, name: from.name },
        to: { id: to.id, name: to.name },
        fromStep: { number: numberOf.get(producing.id) ?? 0, title: clip(producing.title, 120) },
        toStep: { number: numberOf.get(receiving.id) ?? 0, title: clip(receiving.title, 120) },
        delivered: artifact ? { artifactId: artifact.id, name: clip(artifact.name, 120) } : undefined,
        state,
        sentence: handoffSentence(from.name, to.name, producing, receiving, state),
        at: producing.completedAt ?? producing.updatedAt,
      });
    }
  }

  return handoffs.sort(byTimeOf);
}

function handoffState(receiving: Task): Handoff["state"] {
  switch (receiving.status) {
    case "running":
      return "in_progress";
    case "waiting":
      return "waiting";
    case "completed":
      return "delivered";
    default:
      return "stalled";
  }
}

function handoffSentence(
  from: string,
  to: string,
  producing: Task,
  receiving: Task,
  state: Handoff["state"],
): string {
  const what = quoted(clip(producing.title, 80));

  switch (state) {
    case "in_progress":
      return `${from} finished ${what}. ${to} is working from it now.`;
    case "waiting":
      return `${from} finished ${what}. ${to} is held until someone decides.`;
    case "delivered":
      return `${from} finished ${what}, and ${to} used it to finish ${quoted(clip(receiving.title, 80))}.`;
    default:
      return `${from} finished ${what}. ${to} has not picked it up yet.`;
  }
}

/* --------------------------------------------------------------------------
   Outcome
   -------------------------------------------------------------------------- */

const LABEL: Record<OutcomeStatus, string> = {
  running: "Still running",
  completed: "Finished",
  completed_with_limitations: "Finished with limitations",
  blocked: "Blocked",
  failed: "Stopped",
  cancelled: "Cancelled",
};

/**
 * Whether the result is worth acting on.
 *
 * Execution succeeding and the answer being sound are two different
 * questions, and the product used to only be able to answer the first. Every
 * limitation below is read from a field the execution path wrote down at the
 * time - never from the text of the answer, which is exactly the kind of
 * inference that produces a confident-sounding lie about confidence.
 */
function readOutcome(
  input: NarrativeInput,
  ordered: Task[],
  numberOf: Map<TaskId, number>,
): MissionOutcome {
  const { work, approvals } = input;
  const limitations: Limitation[] = [];

  for (const task of ordered) {
    const step = numberOf.get(task.id);
    const execution = recordOf(task.metadata.execution);
    const routing = recordOf(task.metadata.routing);
    const delegation = recordOf(task.metadata.delegation);

    // The executor records whether a step actually called the tools the work
    // required of it. False means the answer was reached some other way.
    const metadata = recordOf(execution?.metadata);
    if (metadata?.requiredToolsSatisfied === false) {
      const required = strings(metadata.requiredTools);
      limitations.push({
        kind: "tool_unavailable",
        steps: step === undefined ? [] : [step],
        detail: required.length > 0
          ? `${quoted(clip(task.title, 80))} was meant to use ${readableList(required)} and did not, so its figures were not computed.`
          : `${quoted(clip(task.title, 80))} did not use the tool the work called for.`,
      });
    }

    // A step that ran without the procedure it was planned around.
    const note = text(execution?.skillNote) ?? text(routing?.skillNote);
    if (note) {
      limitations.push({ kind: "procedure_missing", steps: step === undefined ? [] : [step], detail: clip(note, 240) });
    }

    // The delegator settled for the closest available agent rather than one
    // that held everything the step asked for.
    const unmatched = strings(delegation?.unmatchedCapabilities);
    if (unmatched.length > 0) {
      limitations.push({
        kind: "partial_match",
        steps: step === undefined ? [] : [step],
        detail: `${quoted(clip(task.title, 80))} went to the closest available agent, which does not have ${readableList(unmatched.map(readable))}.`,
      });
    }

    if (task.status === "failed") {
      limitations.push({
        kind: "step_failed",
        steps: step === undefined ? [] : [step],
        detail: `${quoted(clip(task.title, 80))} did not finish.`,
      });
    }
  }

  for (const approval of approvals) {
    if (approval.status !== "rejected") continue;
    limitations.push({
      kind: "decision_refused",
      steps: [],
      detail: `A person refused ${quoted(clip(approval.action, 80))}, so that part of the work did not happen.`,
    });
  }

  if ((input.withheldKnowledge ?? 0) > 0) {
    const count = input.withheldKnowledge!;
    limitations.push({
      kind: "knowledge_withheld",
      steps: [],
      detail: `A company rule kept ${count} ${plural(count, "piece")} of company knowledge out of the planning.`,
    });
  }

  const collapsed = collapse(limitations);

  const unfinished = ordered
    .filter((task) => task.status !== "completed" && task.status !== "failed")
    .map((task) => clip(task.title, 120));

  const status = statusOf(work, ordered, approvals, collapsed);
  const confidence = confidenceOf(status, collapsed);

  return {
    status,
    label: LABEL[status],
    summary: summaryOf(status, collapsed, unfinished, work),
    confidence,
    confidenceReason: confidenceReasonOf(confidence, status, collapsed),
    limitations: collapsed,
    unfinished: status === "completed" || status === "completed_with_limitations" ? [] : unfinished,
    finishedAt: work.completedAt,
  };
}

/**
 * The same limitation reaching several steps, said once.
 *
 * A mission where no step could be given a procedure reported the identical
 * sentence per step, which read like several different problems and inflated
 * the count in the summary. One entry naming every step it touched is both
 * shorter and more accurate about how many things are actually wrong.
 */
function collapse(limitations: Limitation[]): Limitation[] {
  const byText = new Map<string, Limitation>();

  for (const limitation of limitations) {
    const key = `${limitation.kind}::${limitation.detail}`;
    const seen = byText.get(key);

    if (seen) {
      seen.steps = [...new Set([...seen.steps, ...limitation.steps])].sort((a, b) => a - b);
      continue;
    }

    byText.set(key, { ...limitation, steps: [...limitation.steps] });
  }

  return [...byText.values()];
}

function statusOf(
  work: Work,
  ordered: Task[],
  approvals: ApprovalRequest[],
  limitations: Limitation[],
): OutcomeStatus {
  if (work.status === "cancelled") return "cancelled";
  if (work.status === "failed") return "failed";

  // Waiting on a person is not a failure and not a finish. It is the one
  // state where the mission is entirely fine and entirely stopped.
  if (work.status === "waiting_approval" || approvals.some((approval) => approval.status === "pending")) {
    return "blocked";
  }

  if (work.status !== "completed") return "running";

  return limitations.length > 0 ? "completed_with_limitations" : "completed";
}

/**
 * How much weight to put on the answer.
 *
 * Only the limitations decide it, and only the ones that actually bear on
 * whether the numbers are right. A rule withholding knowledge shapes the
 * approach; a step that never called the calculator it was told to use shapes
 * the answer, and those cannot count the same.
 */
function confidenceOf(status: OutcomeStatus, limitations: Limitation[]): Confidence {
  if (status === "failed" || status === "cancelled" || status === "blocked") return "unknown";
  if (status === "running") return "unknown";
  if (limitations.length === 0) return "high";

  const severe = limitations.some(
    (limitation) => limitation.kind === "tool_unavailable" || limitation.kind === "step_failed",
  );

  return severe ? "limited" : "moderate";
}

function confidenceReasonOf(
  confidence: Confidence,
  status: OutcomeStatus,
  limitations: Limitation[],
): string {
  switch (confidence) {
    case "high":
      return "Every step did what it was meant to, with what it was meant to use.";
    case "moderate":
      return `The work finished, but ${limitations.length} ${plural(limitations.length, "thing")} about how it ran ${limitations.length === 1 ? "affects" : "affect"} how complete the answer is.`;
    case "limited":
      return "Part of this answer was not produced the way it was supposed to be, so check it before acting on it.";
    default:
      return status === "running"
        ? "This is not finished, so there is nothing to judge yet."
        : "This did not reach an answer, so there is nothing to judge.";
  }
}

function summaryOf(
  status: OutcomeStatus,
  limitations: Limitation[],
  unfinished: string[],
  work: Work,
): string {
  switch (status) {
    case "completed":
      return "The mission did what it set out to do.";
    case "completed_with_limitations":
      return `The mission finished, but ${limitations.length} ${plural(limitations.length, "thing")} ${limitations.length === 1 ? "limits" : "limit"} what the result can be used for.`;
    case "blocked":
      return "The mission is fine and entirely stopped: it is waiting on a person.";
    case "failed":
      return publicFailureReason(text(work.metadata.executionError) ?? text(work.metadata.planningError))
        ?? "The mission stopped before it reached an answer.";
    case "cancelled":
      return unfinished.length > 0
        ? `The mission was cancelled with ${unfinished.length} ${plural(unfinished.length, "step")} unfinished.`
        : "The mission was cancelled.";
    default:
      return "The mission is still running.";
  }
}

/* --------------------------------------------------------------------------
   Reading the rows
   -------------------------------------------------------------------------- */

function byCreation(left: Task, right: Task): number {
  return left.createdAt.getTime() - right.createdAt.getTime();
}

function byTime(left: Event, right: Event): number {
  return left.timestamp.getTime() - right.timestamp.getTime();
}

function byTimeOf(left: Handoff, right: Handoff): number {
  return left.at.getTime() - right.at.getTime();
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function quoted(value: string): string {
  return `“${value}”`;
}

function readableList(values: string[]): string {
  if (values.length === 0) return "it";
  if (values.length === 1) return values[0]!;
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

/** financial_analysis -> "financial analysis". */
function readable(value: string): string {
  return value.replace(/_/g, " ");
}
