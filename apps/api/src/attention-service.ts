import type {
  AgentId,
  ApprovalRequest,
  ExecutionJob,
  KnowledgeConflict,
  MemoryId,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

import type { WorkSummary } from "@unioffice/database";

import { configurationShortfall } from "./configuration-shortfall.js";
import { clip, plural, type MissionReading } from "./mission-reading.js";
import { publicFailureReason } from "./public-failure.js";

/**
 * What needs a person, and what is merely worth knowing.
 *
 * Every entry is a row or a reading of rows: a pending approval, a mission the
 * backend marked failed, a mission that has stopped moving without anyone
 * being told, a step assigned to an agent that is out of service, knowledge
 * that disagrees with itself, lessons nobody has decided on, a queue job that
 * is recovering. Nothing is synthesised to keep the list from being empty,
 * because empty is the correct and common answer.
 *
 * Three severities, because they ask different things of a person:
 *
 *   action - something is stopped and will stay stopped until someone acts;
 *   review - nothing is blocked, but a person should look;
 *   watch  - the system is handling it and is only saying so.
 *
 * A person can mark a stopped or stalled mission as seen. It then leaves the
 * queue until something about the mission changes, which is what lets the
 * queue genuinely empty - an attention list that can never be cleared becomes
 * a list nobody reads.
 *
 * And every entry is answered for the person reading it. Whether they may
 * actually carry out the one thing the entry asks for is decided here, by the
 * same permission rules the routes enforce, because a queue that offers a
 * viewer an Approve button is not telling them what they need to do - it is
 * telling them something untrue. An entry they cannot act on keeps its place
 * and its explanation, and says plainly whose it is instead.
 */

/**
 * What acting on an entry asks of a person.
 *
 * An approval is its own kind because deciding one depends on more than a
 * permission: a step a governance policy stopped is an owner's or an admin's
 * to decide even when a member may decide ordinary steps.
 */
export type AttentionNeed =
  | { of: "approval"; workspaceId?: WorkspaceId; governedByPolicy: boolean }
  | {
      of: "permission";
      permission: "missions.operate" | "knowledge.curate" | "agents.configure";
      workspaceId?: WorkspaceId;
    };

/** Allowed, or not and whose it is. One sentence, never a role name alone. */
export type AttentionVerdict =
  | { allowed: true }
  | { allowed: false; handoff: string };

/**
 * Who the queue is being built for.
 *
 * The queue knows what each entry asks for; it does not know the caller. This
 * is the one seam between them, so the shaping rules stay testable without a
 * membership and the permission rules stay in one place.
 */
export interface AttentionAuthority {
  decide(need: AttentionNeed): AttentionVerdict;
}

/** An authority that allows everything. Only ever correct for a test. */
export const ALLOWS_EVERYTHING: AttentionAuthority = { decide: () => ({ allowed: true }) };

export type AttentionKind =
  | "decision"
  | "governance"
  | "configuration"
  | "failure"
  | "stalled"
  | "agent_unavailable"
  | "interrupted"
  | "conflict"
  | "lessons"
  | "recovering"
  /** A continuous mission that stopped itself and starts no runs until someone looks. */
  | "schedule";

export type AttentionSeverity = "action" | "review" | "watch";

export type AttentionLevel = "critical" | "high" | "normal" | "low";

export type AttentionSource =
  | "approval"
  | "governance"
  | "execution"
  | "planning"
  | "queue"
  | "workforce"
  | "knowledge"
  | "schedule";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  level: AttentionLevel;
  /** Which part of the system raised it. */
  source: AttentionSource;

  /** What it is, in a few words. */
  label: string;
  /** Why it is here. */
  detail: string;
  /** What happens next, or what a person can do about it. */
  consequence: string;
  /** The one thing to do about it, and where that is done. */
  action: { label: string; path: string };
  /**
   * Whether this person may carry out that action. When false the action is
   * still where it always was - a page they can read - but nothing on any
   * surface may offer it to them as a control.
   */
  actionable: boolean;
  /** When they may not act: whose this is. Absent when it is theirs. */
  handoff?: string;
  /** Whether a person can mark it as seen. */
  acknowledgeable: boolean;

  workId?: WorkId;
  objective?: string;
  taskId?: string;
  agentId?: string;

  /**
   * When the entry is about a continuous mission's run: which one. A person
   * reads "Run 3 of Competitor pricing watch" rather than wondering why the
   * same objective keeps asking for them.
   */
  run?: { continuousMissionId: string; name: string; sequence: number };
  /** The continuous mission an entry is about, when it is about one. */
  continuousMissionId?: string;

  at: Date;
}

export interface AttentionQueue {
  items: AttentionItem[];
  /**
   * How many are stopped until this person acts. Entries stopped until
   * somebody else acts are counted separately: a badge that told a viewer
   * four things needed them would be counting other people's work.
   */
  actionCount: number;
  /** How many are stopped, but on somebody else. */
  waitingOnOthersCount: number;
  /** How many a person should look at, with nothing blocked. */
  reviewCount: number;
  /** How many are the system telling you what it is doing. */
  watchCount: number;
  /** Everything found, which can exceed what is returned. */
  total: number;
}

export interface AttentionInput {
  approvals: ApprovalRequest[];
  worksById: Map<WorkId, WorkSummary>;
  /** Readings of every mission that is not finished, and of failed ones. */
  missions: Array<{ work: WorkSummary; reading: MissionReading }>;
  jobs: ExecutionJob[];
  /** Failed missions a policy stopped, with the policy that did. */
  denials: Map<WorkId, { policyName?: string; summary?: string }>;
  conflicts: Array<{
    conflict: KnowledgeConflict;
    left?: { id: MemoryId; title: string; workspaceId?: WorkspaceId };
    right?: { id: MemoryId; title: string; workspaceId?: WorkspaceId };
  }>;
  /** Lessons each mission proposed that nobody has kept or discarded. */
  lessons: Array<{ workId: WorkId; count: number; at: Date }>;
  /** Agent ids that exist in the organization, for linking to them. */
  agentIds: Set<AgentId>;
  /**
   * Continuous missions that stopped themselves - after repeated failed runs,
   * or because the person they run for lost access - and will start nothing
   * until someone looks. A person pausing one is not listed: they know.
   */
  schedules?: Array<{
    id: string;
    name: string;
    workspaceId?: WorkspaceId;
    reason: "repeated_failures" | "owner_access";
    at: Date;
  }>;
  /** Who this queue is for. Every entry's action is answered against it. */
  authority: AttentionAuthority;
}

export const DEFAULT_ATTENTION_LIMIT = 25;

const SEVERITY_RANK: Record<AttentionSeverity, number> = { action: 0, review: 1, watch: 2 };

const LEVEL_RANK: Record<AttentionLevel, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/**
 * Within a severity and level: a decision is holding up a live operation right
 * now; a policy stop, a failure or a stall has already stopped and will wait.
 */
const KIND_RANK: Record<AttentionKind, number> = {
  decision: 0,
  agent_unavailable: 1,
  governance: 2,
  // Above an ordinary failure: it is the one stop that will happen again to
  // every mission needing the same thing, so fixing it clears more than one.
  configuration: 3,
  // A schedule that stopped itself stops every future run of that work, so it
  // sits with configuration, above a single mission's failure.
  schedule: 4,
  failure: 5,
  stalled: 6,
  interrupted: 7,
  conflict: 8,
  lessons: 9,
  recovering: 10,
};

/**
 * An entry before it has been answered for anyone. `need` says what carrying
 * out its action asks of a person; absent means the action is only navigation
 * and asks nothing, which is why a retrying job never tells anybody that
 * somebody else must handle it.
 */
type AttentionDraft = Omit<AttentionItem, "actionable" | "handoff"> & { need?: AttentionNeed };

export function buildAttentionQueue(
  input: AttentionInput,
  limit = DEFAULT_ATTENTION_LIMIT,
): AttentionQueue {
  const items: AttentionItem[] = [
    ...input.approvals.map((approval) => decisionItem(approval, input.worksById.get(approval.workId))),
    ...input.missions.flatMap(({ work, reading }) => missionItems(work, reading, input)),
    ...input.jobs.flatMap((job) => recoveringItem(job, input.worksById.get(job.workId))),
    ...input.conflicts.flatMap(conflictItem),
    ...input.lessons.flatMap((entry) => lessonsItem(entry, input.worksById.get(entry.workId))),
    ...(input.schedules ?? []).map(scheduleItem),
  ]
    .map((draft) => answer(draft, input.authority))
    .sort(order);

  const stopped = items.filter((item) => item.severity === "action");

  return {
    items: items.slice(0, Math.max(0, limit)),
    actionCount: stopped.filter((item) => item.actionable).length,
    waitingOnOthersCount: stopped.filter((item) => !item.actionable).length,
    reviewCount: items.filter((item) => item.severity === "review").length,
    watchCount: items.filter((item) => item.severity === "watch").length,
    total: items.length,
  };
}

/**
 * One entry, answered for the person reading the queue.
 *
 * Marking a mission as seen is an operator's act as much as retrying it is,
 * so it is withheld from anyone who may not operate missions there rather
 * than offered and then refused by the route.
 */
function answer(draft: AttentionDraft, authority: AttentionAuthority): AttentionItem {
  const { need, ...item } = draft;
  const verdict = need ? authority.decide(need) : ({ allowed: true } as const);

  // Setting an entry aside is an operator's act whatever the entry itself
  // asks for: someone who may grant an agent a tool is not thereby someone
  // who may declare a mission's problem seen.
  const acknowledgeable = item.acknowledgeable &&
    authority.decide({
      of: "permission",
      permission: "missions.operate",
      workspaceId: need?.workspaceId,
    }).allowed;

  return verdict.allowed
    ? { ...item, acknowledgeable, actionable: true }
    : { ...item, acknowledgeable, actionable: false, handoff: verdict.handoff };
}

function order(left: AttentionItem, right: AttentionItem): number {
  return (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
    LEVEL_RANK[left.level] - LEVEL_RANK[right.level] ||
    KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
    right.at.getTime() - left.at.getTime() ||
    left.id.localeCompare(right.id)
  );
}

/** A problem on a critical mission is a critical problem. */
function levelFor(base: AttentionLevel, work: WorkSummary | undefined): AttentionLevel {
  return work?.priority === "critical" && LEVEL_RANK[base] > LEVEL_RANK.critical ? "critical" : base;
}

/** "the calculator", "the calculator and web search", "the a, b and c". */
function readableList(values: string[]): string {
  const names = values.map((value) => clip(value.replace(/[_-]+/g, " "), 60));

  if (names.length === 0) return "that tool";
  if (names.length === 1) return `the ${names[0]}`;

  return `the ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function missionPath(workId: WorkId): string {
  return `/missions/${workId}`;
}

/** Whether a person has already said they saw the mission in this state. */
function seen(work: WorkSummary, at: Date): boolean {
  return Boolean(work.acknowledgedAt && work.acknowledgedAt.getTime() >= at.getTime());
}

/**
 * Whether a governance policy is what stopped this step.
 *
 * Read from the approval alone. The task can also carry the policy that asked
 * for it, and the task's own metadata is not loaded here - so a step governed
 * only at the task level reads as an ordinary one, and a member is offered
 * the review rather than told it is an owner's. The approval surface makes
 * the real decision with the task in hand and refuses it there; nothing here
 * ever grants anything.
 */
function governedByPolicy(approval: ApprovalRequest): boolean {
  const metadata = approval.metadata;

  return (
    typeof metadata.policyId === "string" ||
    typeof metadata.skill === "string" ||
    Array.isArray(metadata.externalWrites)
  );
}

function decisionItem(approval: ApprovalRequest, work: WorkSummary | undefined): AttentionDraft {
  return {
    need: {
      of: "approval",
      workspaceId: work?.workspaceId,
      governedByPolicy: governedByPolicy(approval),
    },
    id: `approval:${approval.id}`,
    kind: "decision",
    severity: "action",
    level: levelFor("high", work),
    source: "approval",
    label: clip(approval.action, 140),
    detail: clip(approval.reason, 280),
    consequence:
      "The mission is stopped here. Approving puts it back on the queue; rejecting means the step is not taken.",
    action: { label: "Review", path: missionPath(approval.workId) },
    acknowledgeable: false,
    workId: approval.workId,
    objective: work ? clip(work.objective, 200) : undefined,
    taskId: approval.taskId,
    agentId: approval.agentId,
    ...runOf(work),
    at: approval.createdAt,
  };
}

/** The run an entry's mission is, when a continuous mission started it. */
function runOf(work: WorkSummary | undefined): Pick<AttentionItem, "run" | "continuousMissionId"> {
  return work?.run
    ? { run: work.run, continuousMissionId: work.run.continuousMissionId }
    : {};
}

/**
 * A continuous mission that stopped itself.
 *
 * Resuming it is operating missions in its workspace, the same permission the
 * route checks, so a viewer is told whose it is rather than offered a control.
 */
function scheduleItem(schedule: NonNullable<AttentionInput["schedules"]>[number]): AttentionDraft {
  const failures = schedule.reason === "repeated_failures";

  return {
    need: { of: "permission", permission: "missions.operate", workspaceId: schedule.workspaceId },
    id: `schedule:${schedule.id}`,
    kind: "schedule",
    severity: "action",
    level: "high",
    source: "schedule",
    label: `“${clip(schedule.name, 100)}” stopped running`,
    detail: failures
      ? "Its last runs failed one after another, so it paused itself rather than keep failing on schedule."
      : "The person it runs for can no longer start missions there, so it paused itself rather than act on their old permission.",
    consequence: failures
      ? "No more runs start until someone looks at why they failed and resumes it."
      : "No more runs start until someone who may start missions there takes it on and resumes it.",
    action: { label: "Review schedule", path: `/schedules/${schedule.id}` },
    acknowledgeable: false,
    continuousMissionId: schedule.id,
    at: schedule.at,
  };
}

function missionItems(
  work: WorkSummary,
  reading: MissionReading,
  input: AttentionInput,
): AttentionDraft[] {
  // Every mission entry asks the same thing of a person: run, retry, resume
  // or set aside the mission. That is one permission, in its workspace.
  const shared = {
    need: {
      of: "permission",
      permission: "missions.operate",
      workspaceId: work.workspaceId,
    } as const satisfies AttentionNeed,
    workId: work.id,
    objective: clip(work.objective, 200),
    ...runOf(work),
  };

  if (reading.phase === "failed") {
    const at = work.completedAt ?? work.updatedAt;
    if (seen(work, at)) return [];

    if (work.interrupted) {
      return [{
        ...shared,
        id: `interrupted:${work.id}`,
        kind: "interrupted",
        severity: "action",
        level: levelFor("normal", work),
        source: "execution",
        label: "Interrupted mid-run",
        detail: reading.failure ?? shared.objective,
        consequence: "Finished steps were kept. Resuming picks up from the first one that did not.",
        action: { label: "Resume", path: missionPath(work.id) },
        acknowledgeable: true,
        at,
      }];
    }

    const denial = input.denials.get(work.id);

    if (denial) {
      return [{
        ...shared,
        id: `governance:${work.id}`,
        kind: "governance",
        severity: "action",
        level: levelFor("high", work),
        source: "governance",
        label: `Stopped by ${denial.policyName ? clip(denial.policyName, 80) : "a policy"}`,
        detail: denial.summary ? clip(denial.summary, 280) : reading.failure ?? shared.objective,
        consequence:
          "A policy refused a step, so nothing after it ran. Change the policy or the plan before retrying.",
        action: { label: "Inspect", path: missionPath(work.id) },
        acknowledgeable: true,
        at,
      }];
    }

    const shortfall = configurationShortfall(reading.failure);

    if (shortfall) {
      return [{
        ...shared,
        // Changing the workforce is what clears this, not running the mission
        // again, so this entry asks for that rather than for an operator.
        need: { of: "permission", permission: "agents.configure", workspaceId: work.workspaceId },
        id: `configuration:${work.id}`,
        kind: "configuration",
        severity: "action",
        level: levelFor("high", work),
        source: "workforce",
        label: shortfall.kind === "workforce"
          ? "Nobody is set up to do this work"
          : `Nobody is set up to use ${readableList(shortfall.tools)}`,
        detail: reading.failure ?? shared.objective,
        consequence: shortfall.kind === "workforce"
          ? "Every mission stops here until somebody works here. Retrying changes nothing on its own."
          : "Every mission needing this stops the same way. Grant it to an agent, then retry the mission.",
        action: { label: "Set up the workforce", path: "/workforce" },
        acknowledgeable: true,
        at,
      }];
    }

    return [{
      ...shared,
      id: `failure:${work.id}`,
      kind: "failure",
      severity: "action",
      level: levelFor("high", work),
      source: work.planningError && !work.executionError ? "planning" : "execution",
      label: reading.stage === "Stopped while planning" ? "Planning failed" : "Mission stopped",
      detail: reading.failure ?? "It stopped without recording why.",
      consequence: "Nothing finished was lost. A retry resumes from the first step that did not complete.",
      action: { label: "Inspect", path: missionPath(work.id) },
      acknowledgeable: true,
      at,
    }];
  }

  // A decision is raised from the approval itself, which names the step.
  if (!reading.blocked || reading.blocked.kind === "approval") return [];

  if (reading.blocked.kind === "agent_unavailable") {
    const agentId = reading.blocked.agentId;

    return [{
      ...shared,
      id: `agent:${work.id}`,
      kind: "agent_unavailable",
      severity: "action",
      level: levelFor("high", work),
      source: "workforce",
      label: "Assigned to an agent who cannot work",
      detail: reading.blocked.reason,
      consequence: "That step cannot start until the agent is active again or the mission is re-planned.",
      action: agentId && input.agentIds.has(agentId)
        ? { label: "Review agent", path: `/workforce/${agentId}` }
        : { label: "Open mission", path: missionPath(work.id) },
      acknowledgeable: false,
      agentId,
      at: reading.lastActivityAt,
    }];
  }

  if (seen(work, reading.lastActivityAt)) return [];

  return [{
    ...shared,
    id: `stalled:${work.id}`,
    kind: "stalled",
    severity: "action",
    level: levelFor("high", work),
    source: "queue",
    label: "Stalled",
    detail: reading.blocked.reason,
    consequence:
      "Nothing will move this on its own. Open it to plan, run or retry it, or mark it as seen if it no longer matters.",
    action: { label: "Open mission", path: missionPath(work.id) },
    acknowledgeable: true,
    at: reading.lastActivityAt,
  }];
}

/**
 * A queued job that has already used an attempt is the queue picking a mission
 * back up - the one recovery the system performs by itself. It needs nobody.
 */
function recoveringItem(job: ExecutionJob, work: WorkSummary | undefined): AttentionDraft[] {
  if (job.status !== "queued") return [];
  if (job.attempts === 0 && !job.lastError) return [];

  // A job whose mission is not in view cannot be shown as a mission, and an
  // entry pointing at nothing is worse than one fewer line.
  if (!work) return [];

  return [{
    id: `recovering:${job.id}`,
    kind: "recovering",
    severity: "watch",
    level: "low",
    source: "queue",
    label: job.reason === "recovered"
      ? "Picked back up after a worker stopped"
      : `Retrying on attempt ${job.attempts + 1}`,
    detail: publicFailureReason(job.lastError) ?? clip(work.objective, 200),
    consequence: "UNIOFFICE is handling this. A worker resumes it without you.",
    action: { label: "Watch it", path: missionPath(job.workId) },
    acknowledgeable: false,
    workId: job.workId,
    objective: clip(work.objective, 200),
    at: job.updatedAt,
  }];
}

function conflictItem(entry: AttentionInput["conflicts"][number]): AttentionDraft[] {
  // Both sides are read inside the organization; a side that could not be
  // read is not described with a guess.
  if (!entry.left || !entry.right) return [];

  return [{
    need: {
      of: "permission",
      permission: "knowledge.curate",
      // Both sides were already checked to be within reach; either names the
      // workspace the settling would happen in.
      workspaceId: entry.left.workspaceId ?? entry.right.workspaceId,
    },
    id: `conflict:${entry.conflict.id}`,
    kind: "conflict",
    severity: "review",
    level: "normal",
    source: "knowledge",
    label: "Company knowledge disagrees",
    detail: `“${clip(entry.left.title, 110)}” and “${clip(entry.right.title, 110)}”`,
    consequence: "Planning is handed both, marked as disagreeing, until a person settles it.",
    action: { label: "Settle it", path: `/brain/${entry.left.id}` },
    acknowledgeable: false,
    at: entry.conflict.detectedAt,
  }];
}

function lessonsItem(
  entry: AttentionInput["lessons"][number],
  work: WorkSummary | undefined,
): AttentionDraft[] {
  if (!work || entry.count === 0) return [];

  return [{
    need: {
      of: "permission",
      permission: "knowledge.curate",
      workspaceId: work.workspaceId,
    },
    id: `lessons:${work.id}`,
    kind: "lessons",
    severity: "review",
    level: "low",
    source: "knowledge",
    label: `${entry.count} ${plural(entry.count, "lesson")} waiting for a decision`,
    detail: clip(work.objective, 200),
    consequence: "Until someone keeps or discards them, later missions only get them as unverified leads.",
    action: { label: "Decide", path: `${missionPath(work.id)}#debrief` },
    acknowledgeable: false,
    workId: work.id,
    objective: clip(work.objective, 200),
    at: entry.at,
  }];
}
