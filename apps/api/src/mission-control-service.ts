import type {
  Agent,
  AgentId,
  ApprovalRequest,
  Event,
  EventType,
  ExecutionJob,
  KnowledgeConflict,
  Memory,
  MemoryId,
  OrganizationId,
  WorkId,
} from "@unioffice/core";

import { isExecutionJobActive } from "@unioffice/core";

import type {
  AgentRepository,
  ApprovalRepository,
  ExecutionJobRepository,
  KnowledgeLinkRepository,
  KnowledgeSearchRepository,
  MemoryRepository,
  OperationalReadRepository,
  TaskSummary,
  WorkRepository,
  WorkSummary,
} from "@unioffice/database";

import {
  buildAttentionQueue,
  DEFAULT_ATTENTION_LIMIT,
  type AttentionInput,
  type AttentionQueue,
} from "./attention-service.js";

import type { EventRecorder } from "./event-recorder.js";

import {
  clip,
  DEFAULT_STALLED_AFTER_MS,
  describeEvent,
  isTerminal,
  MEANINGFUL_EVENT_TYPES,
  plural,
  readMission,
  type MissionPhase,
  type MissionReading,
} from "./mission-reading.js";

import { publicFailureReason } from "./public-failure.js";

/**
 * Mission Control: the company's operational state in one read.
 *
 * What is running, what is blocked and why, what finished, what needs a
 * person, what the company recently decided and learned. Every part is read
 * from rows in a bounded number of queries - two waves, whatever the size of
 * the company - and every value leaving here is one a person can be shown:
 * short labels, cleaned failure reasons, counts. Plans, briefings, tool inputs
 * and outputs, and raw errors stay on the server.
 *
 * The attention queue the shell badge and drawer read is built from the same
 * state by the same code, so the Command Center and the rail can never
 * disagree about what needs you.
 */

export class MissionNotFoundError extends Error {
  constructor(message = "Mission not found.") {
    super(message);
    this.name = "MissionNotFoundError";
  }
}

export class MissionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionStateError";
  }
}

export interface MissionControlDependencies {
  reads: OperationalReadRepository;
  works: Pick<WorkRepository, "findById" | "update">;
  approvals: Pick<ApprovalRepository, "findPendingByOrganization">;
  jobs: Pick<ExecutionJobRepository, "findByOrganization" | "findActiveByWork">;
  agents: Pick<AgentRepository, "findByOrganization">;
  memories: Pick<MemoryRepository, "query"> & Pick<KnowledgeSearchRepository, "findByIds">;
  links: Pick<KnowledgeLinkRepository, "findConflicts">;
  eventRecorder: Pick<EventRecorder, "record">;
}

export interface MissionCard {
  id: WorkId;
  objective: string;
  /** A short name, when the mission was started from a template with one. */
  name?: string;
  template?: string;
  status: WorkSummary["status"];
  phase: MissionPhase;
  priority: WorkSummary["priority"];
  workspaceId?: string;
  stage: string;
  currentSteps: string[];
  progress: MissionReading["progress"];
  team: MissionReading["team"];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  lastActivityAt: Date;
  /** How long it has been running, or how long it ran. */
  elapsedMs?: number;
  blocked?: { kind: string; reason: string };
  failure?: string;
  acknowledged: boolean;
  latest?: { text: string; at: Date };
}

export type OutcomeKind =
  | "mission_completed"
  | "mission_failed"
  | "artifacts"
  | "decision"
  | "knowledge";

export interface Outcome {
  id: string;
  kind: OutcomeKind;
  text: string;
  /** The mission it belongs to, when it belongs to one. */
  detail?: string;
  /** A short secondary line: a step count, a cleaned failure reason. */
  note?: string;
  path?: string;
  at: Date;
}

export interface KnowledgeSignal {
  id: MemoryId;
  title: string;
  type: Memory["type"];
  status: Memory["status"];
  createdAt: Date;
  workId?: WorkId;
}

export interface MissionControlView {
  organizationId: OrganizationId;
  generatedAt: Date;
  summary: {
    running: number;
    blocked: number;
    needsYou: number;
    finishedToday: number;
    failedToday: number;
    /** Stalled missions a person marked as seen, kept out of the way. */
    setAside: number;
    /** Missions ever opened, within the window read. */
    total: number;
  };
  running: MissionCard[];
  blocked: MissionCard[];
  finished: MissionCard[];
  attention: AttentionQueue;
  outcomes: Outcome[];
  signals: {
    decisions: KnowledgeSignal[];
    lessons: KnowledgeSignal[];
    awaiting: {
      total: number;
      /** True when there are at least this many, possibly more. */
      atLeast: boolean;
      missions: Array<{ workId: WorkId; objective: string; count: number }>;
    };
    conflicts: Array<{
      id: string;
      reason: string;
      left: { id: MemoryId; title: string };
      right: { id: MemoryId; title: string };
    }>;
  };
  workforce: {
    total: number;
    active: number;
    working: number;
    unavailable: Array<{ agentId: AgentId; name: string; status: Agent["status"] }>;
    /** Who is on the roster, for finding an agent from anywhere in the shell. */
    roster: Array<{
      agentId: AgentId;
      name: string;
      type: Agent["type"];
      status: Agent["status"];
      capabilities: string[];
    }>;
  };
}

/* Windows. Every read is bounded, whatever the size of the company. */
const WORK_WINDOW = 300;
const JOB_WINDOW = 300;
const OPEN_MISSIONS_READ = 60;
const FAILED_MISSIONS_READ = 30;
const FINISHED_SHOWN = 8;
const RUNNING_SHOWN = 12;
const BLOCKED_SHOWN = 12;
const MISSION_EVENTS_READ = 300;
const OUTCOME_EVENTS_READ = 60;
const OUTCOMES_SHOWN = 12;
const PROPOSED_READ = 100;
const CONFLICTS_READ = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const OUTCOME_EVENT_TYPES: EventType[] = [
  "work.completed",
  "work.failed",
  "artifact.created",
  "approval.approved",
  "approval.rejected",
  "knowledge.approved",
  "knowledge.merged",
  "knowledge.superseded",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OperationalState {
  organizationId: OrganizationId;
  now: Date;
  works: WorkSummary[];
  worksById: Map<WorkId, WorkSummary>;
  approvals: ApprovalRequest[];
  jobs: ExecutionJob[];
  agents: Agent[];
  agentsById: Map<AgentId, Agent>;
  open: Array<{ work: WorkSummary; reading: MissionReading }>;
  failed: Array<{ work: WorkSummary; reading: MissionReading }>;
  finished: Array<{ work: WorkSummary; reading: MissionReading }>;
  latestByWork: Map<WorkId, Event>;
  attentionInput: AttentionInput;
  proposed: Memory[];
  conflicts: AttentionInput["conflicts"];
}

export class MissionControlService {
  private readonly stalledAfterMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly deps: MissionControlDependencies,
    options: { stalledAfterMs?: number; now?: () => Date } = {},
  ) {
    this.stalledAfterMs = options.stalledAfterMs ?? DEFAULT_STALLED_AFTER_MS;
    this.now = options.now ?? (() => new Date());
  }

  /** What needs a person, ranked. The shell's badge and drawer read this. */
  async getAttention(
    organizationId: OrganizationId,
    options: { limit?: number } = {},
  ): Promise<AttentionQueue> {
    const state = await this.load(organizationId);

    return buildAttentionQueue(state.attentionInput, Math.min(options.limit ?? DEFAULT_ATTENTION_LIMIT, 100));
  }

  async getMissionControl(organizationId: OrganizationId): Promise<MissionControlView> {
    const [state, decisions, lessons, outcomeEvents] = await Promise.all([
      this.load(organizationId),
      this.deps.memories.query({ organizationId, types: ["decision"], statuses: ["active"], limit: 4 }),
      this.deps.memories.query({ organizationId, types: ["lesson"], statuses: ["active", "proposed"], limit: 4 }),
      this.deps.reads.findEventsByTypes(organizationId, { types: OUTCOME_EVENT_TYPES, limit: OUTCOME_EVENTS_READ }),
    ]);

    const { now } = state;
    const card = (entry: { work: WorkSummary; reading: MissionReading }) =>
      toCard(entry.work, entry.reading, state.latestByWork.get(entry.work.id), state.agentsById, now);

    const blockedEntries = state.open.filter(({ work, reading }) =>
      reading.blocked && !(reading.blocked.kind === "stalled" && acknowledged(work, reading.lastActivityAt)));
    const setAside = state.open.filter(({ work, reading }) =>
      reading.blocked?.kind === "stalled" && acknowledged(work, reading.lastActivityAt)).length;
    const runningEntries = state.open.filter(({ reading }) => !reading.blocked);

    const attention = buildAttentionQueue(state.attentionInput, DEFAULT_ATTENTION_LIMIT);
    const working = new Set(
      state.open.flatMap(({ reading }) => reading.team.filter((member) => member.state === "working").map((member) => member.agentId)),
    );

    return {
      organizationId,
      generatedAt: now,
      summary: {
        running: runningEntries.length,
        blocked: blockedEntries.length,
        needsYou: attention.actionCount,
        finishedToday: state.works.filter((work) => work.status === "completed" && withinDay(work, now)).length,
        failedToday: state.works.filter((work) => work.status === "failed" && withinDay(work, now)).length,
        setAside,
        total: state.works.length,
      },
      running: runningEntries.sort(runningOrder).slice(0, RUNNING_SHOWN).map(card),
      blocked: blockedEntries.sort(blockedOrder).slice(0, BLOCKED_SHOWN).map(card),
      finished: state.finished.map(card),
      attention,
      outcomes: outcomesOf(outcomeEvents, state.worksById),
      signals: {
        decisions: decisions.map(signalOf),
        lessons: lessons.map(signalOf),
        awaiting: awaitingOf(state.proposed, state.worksById),
        conflicts: state.conflicts.flatMap((entry) =>
          entry.left && entry.right
            ? [{
                id: entry.conflict.id,
                reason: clip(entry.conflict.reason, 200),
                left: entry.left,
                right: entry.right,
              }]
            : []),
      },
      workforce: {
        total: state.agents.length,
        active: state.agents.filter((agent) => agent.status === "active").length,
        working: working.size,
        unavailable: state.agents
          .filter((agent) => agent.status !== "active")
          .map((agent) => ({ agentId: agent.id, name: agent.name, status: agent.status })),
        roster: state.agents.map((agent) => ({
          agentId: agent.id,
          name: agent.name,
          type: agent.type,
          status: agent.status,
          capabilities: agent.capabilities.slice(0, 20),
        })),
      },
    };
  }

  /**
   * A person has seen a stopped or stalled mission and does not need to be
   * told again. It leaves the attention queue until something about it
   * changes - a new failure, a new stall - and nothing else about the mission
   * is touched.
   *
   * Only a mission that is genuinely not moving can be marked: one waiting for
   * a decision is answered by deciding, and one still on the queue or running
   * resolves itself.
   */
  async acknowledge(
    organizationId: OrganizationId,
    workId: WorkId,
    by: string,
  ): Promise<{ workId: WorkId; acknowledgedAt: Date }> {
    const work = await this.deps.works.findById(workId);

    if (!work || work.organizationId !== organizationId) {
      throw new MissionNotFoundError();
    }

    if (work.status === "completed") {
      throw new MissionStateError("A finished mission has nothing to mark as seen.");
    }

    if (work.status === "waiting_approval") {
      throw new MissionStateError("This mission is waiting for a decision. Approve or reject the step instead.");
    }

    if (!isTerminal(work.status)) {
      const [job, tasks] = await Promise.all([
        this.deps.jobs.findActiveByWork(work.id),
        this.deps.reads.findTaskSummaries([work.id]),
      ]);

      if (job) {
        throw new MissionStateError("This mission is on the queue and will move on its own.");
      }

      const lastActivity = Math.max(work.updatedAt.getTime(), ...tasks.map((task) => task.updatedAt.getTime()));

      if (this.now().getTime() - lastActivity <= this.stalledAfterMs) {
        throw new MissionStateError("This mission is still moving. Only a stalled mission can be marked as seen.");
      }
    }

    const acknowledgedAt = this.now();

    // Only metadata changes, and updatedAt is left alone on purpose: marking a
    // mission as seen is not activity, and must not make a stall look fresh.
    await this.deps.works.update({
      ...work,
      metadata: {
        ...work.metadata,
        acknowledged: { at: acknowledgedAt.toISOString(), by },
      },
    });

    await this.deps.eventRecorder.record({
      organizationId,
      workId: work.id,
      actorType: "user",
      actorId: by,
      type: "work.acknowledged",
      payload: { status: work.status },
    });

    return { workId: work.id, acknowledgedAt };
  }

  /* ----------------------------------------------------------------------
     One consistent read of the company
     ---------------------------------------------------------------------- */

  private async load(organizationId: OrganizationId): Promise<OperationalState> {
    const now = this.now();

    const [works, approvals, jobs, agents, openConflicts, proposed] = await Promise.all([
      this.deps.reads.findWorkSummaries(organizationId, WORK_WINDOW),
      this.deps.approvals.findPendingByOrganization(organizationId),
      this.deps.jobs.findByOrganization(organizationId, JOB_WINDOW),
      this.deps.agents.findByOrganization(organizationId),
      this.deps.links.findConflicts(organizationId, { status: "open", limit: CONFLICTS_READ }),
      this.deps.memories.query({ organizationId, statuses: ["proposed"], limit: PROPOSED_READ }),
    ]);

    // Repositories already scope by organization. These filters are the second
    // line: nothing from another tenant is classified even if a store slips.
    const ownWorks = works.filter((work) => work.organizationId === organizationId);
    const ownApprovals = approvals.filter((approval) => approval.organizationId === organizationId);
    const ownJobs = jobs.filter((job) => job.organizationId === organizationId);
    const ownAgents = agents.filter((agent) => agent.organizationId === organizationId);

    const worksById = new Map(ownWorks.map((work) => [work.id, work]));
    const agentsById = new Map(ownAgents.map((agent) => [agent.id, agent]));

    const open = ownWorks.filter((work) => !isTerminal(work.status)).slice(0, OPEN_MISSIONS_READ);
    const failed = ownWorks.filter((work) => work.status === "failed").slice(0, FAILED_MISSIONS_READ);
    const finished = ownWorks
      .filter((work) => isTerminal(work.status))
      .sort((left, right) => finishedAt(right).getTime() - finishedAt(left).getTime())
      .slice(0, FINISHED_SHOWN);

    const ids = [...new Set([...open, ...failed, ...finished].map((work) => work.id))];
    const failedIds = failed.map((work) => work.id);
    const conflictSideIds = [...new Set(openConflicts.flatMap((conflict) => [conflict.memoryId, conflict.conflictingMemoryId]))];

    const [tasks, missionEvents, stepFailures, sides] = await Promise.all([
      ids.length > 0 ? this.deps.reads.findTaskSummaries(ids) : Promise.resolve([] as TaskSummary[]),
      ids.length > 0
        ? this.deps.reads.findEventsByTypes(organizationId, { types: MEANINGFUL_EVENT_TYPES, workIds: ids, limit: MISSION_EVENTS_READ })
        : Promise.resolve([] as Event[]),
      failedIds.length > 0
        ? this.deps.reads.findEventsByTypes(organizationId, { types: ["task.failed"], workIds: failedIds, limit: 100 })
        : Promise.resolve([] as Event[]),
      conflictSideIds.length > 0 ? this.deps.memories.findByIds(organizationId, conflictSideIds) : Promise.resolve([] as Memory[]),
    ]);

    // Tasks carry no organization; they were asked for by ids read inside it.
    const tasksByWork = new Map<WorkId, TaskSummary[]>();
    for (const task of tasks) {
      if (!worksById.has(task.workId)) continue;
      tasksByWork.set(task.workId, [...(tasksByWork.get(task.workId) ?? []), task]);
    }

    const activeJobByWork = new Map<WorkId, ExecutionJob>();
    for (const job of ownJobs) {
      if (!isExecutionJobActive(job)) continue;
      const current = activeJobByWork.get(job.workId);
      if (!current || job.createdAt > current.createdAt) activeJobByWork.set(job.workId, job);
    }

    const approvalsByWork = new Map<WorkId, ApprovalRequest[]>();
    for (const approval of ownApprovals) {
      approvalsByWork.set(approval.workId, [...(approvalsByWork.get(approval.workId) ?? []), approval]);
    }

    const read = (work: WorkSummary) => ({
      work,
      reading: readMission({
        work,
        tasks: tasksByWork.get(work.id) ?? [],
        job: activeJobByWork.get(work.id),
        approvals: approvalsByWork.get(work.id) ?? [],
        agents: agentsById,
        now,
        stalledAfterMs: this.stalledAfterMs,
      }),
    });

    const openReadings = open.map(read);
    const failedReadings = failed.map(read);
    const finishedReadings = finished.map(read);

    const latestByWork = new Map<WorkId, Event>();
    for (const event of missionEvents) {
      if (event.organizationId !== organizationId || !event.workId) continue;
      if (!latestByWork.has(event.workId) && describeEvent(event, agentsById)) {
        latestByWork.set(event.workId, event);
      }
    }

    const denials = new Map<WorkId, { policyName?: string; summary?: string }>();
    for (const event of stepFailures) {
      if (event.organizationId !== organizationId || !event.workId || denials.has(event.workId)) continue;

      const governance = event.payload.governance as { outcome?: unknown; policyName?: unknown } | undefined;
      if (governance?.outcome !== "denied") continue;

      denials.set(event.workId, {
        policyName: typeof governance.policyName === "string" ? governance.policyName : undefined,
        summary: typeof event.payload.error === "string" ? event.payload.error : undefined,
      });
    }

    const sideById = new Map(sides.filter((memory) => memory.organizationId === organizationId).map((memory) => [memory.id, memory]));
    const conflicts = openConflicts
      .filter((conflict) => conflict.organizationId === organizationId)
      .map((conflict) => ({
        conflict,
        left: sideOf(sideById.get(conflict.memoryId)),
        right: sideOf(sideById.get(conflict.conflictingMemoryId)),
      }));

    const ownProposed = proposed.filter((memory) =>
      memory.organizationId === organizationId && memory.type !== "experience");

    return {
      organizationId,
      now,
      works: ownWorks,
      worksById,
      approvals: ownApprovals,
      jobs: ownJobs,
      agents: ownAgents,
      agentsById,
      open: openReadings,
      failed: failedReadings,
      finished: finishedReadings,
      latestByWork,
      proposed: ownProposed,
      conflicts,
      attentionInput: {
        approvals: ownApprovals,
        worksById,
        missions: [...openReadings, ...failedReadings],
        jobs: ownJobs,
        denials,
        conflicts,
        lessons: lessonsByWork(ownProposed, worksById),
        agentIds: new Set(agentsById.keys()),
      },
    };
  }
}

/* --------------------------------------------------------------------------
   Shaping
   -------------------------------------------------------------------------- */

function toCard(
  work: WorkSummary,
  reading: MissionReading,
  latest: Event | undefined,
  agents: Map<AgentId, Agent>,
  now: Date,
): MissionCard {
  const started = work.startedAt ?? work.createdAt;
  const latestText = latest ? describeEvent(latest, agents) : undefined;

  return {
    id: work.id,
    objective: clip(work.objective, 280),
    name: work.missionName ? clip(work.missionName, 120) : undefined,
    template: work.templateName ? clip(work.templateName, 80) : undefined,
    status: work.status,
    phase: reading.phase,
    priority: work.priority,
    workspaceId: work.workspaceId,
    stage: reading.stage,
    currentSteps: reading.currentSteps,
    progress: reading.progress,
    team: reading.team,
    createdAt: work.createdAt,
    startedAt: work.startedAt,
    completedAt: work.completedAt,
    lastActivityAt: reading.lastActivityAt,
    elapsedMs: isTerminal(work.status)
      ? work.completedAt ? Math.max(0, work.completedAt.getTime() - started.getTime()) : undefined
      : Math.max(0, now.getTime() - started.getTime()),
    blocked: reading.blocked ? { kind: reading.blocked.kind, reason: reading.blocked.reason } : undefined,
    failure: reading.failure,
    acknowledged: acknowledged(work, reading.phase === "failed" ? finishedAt(work) : reading.lastActivityAt),
    latest: latest && latestText ? { text: latestText, at: latest.timestamp } : undefined,
  };
}

const PHASE_ORDER: Partial<Record<MissionPhase, number>> = { running: 0, planning: 1, queued: 2 };

function runningOrder(
  left: { reading: MissionReading },
  right: { reading: MissionReading },
): number {
  return (PHASE_ORDER[left.reading.phase] ?? 3) - (PHASE_ORDER[right.reading.phase] ?? 3) ||
    right.reading.lastActivityAt.getTime() - left.reading.lastActivityAt.getTime();
}

const BLOCK_ORDER: Record<string, number> = { approval: 0, agent_unavailable: 1, stalled: 2 };

function blockedOrder(
  left: { reading: MissionReading },
  right: { reading: MissionReading },
): number {
  return (BLOCK_ORDER[left.reading.blocked?.kind ?? ""] ?? 3) - (BLOCK_ORDER[right.reading.blocked?.kind ?? ""] ?? 3) ||
    right.reading.lastActivityAt.getTime() - left.reading.lastActivityAt.getTime();
}

function finishedAt(work: WorkSummary): Date {
  return work.completedAt ?? work.updatedAt;
}

function withinDay(work: WorkSummary, now: Date): boolean {
  return now.getTime() - finishedAt(work).getTime() <= DAY_MS;
}

function acknowledged(work: WorkSummary, at: Date): boolean {
  return Boolean(work.acknowledgedAt && work.acknowledgedAt.getTime() >= at.getTime());
}

function sideOf(memory: Memory | undefined): { id: MemoryId; title: string } | undefined {
  return memory ? { id: memory.id, title: clip(memory.title, 160) } : undefined;
}

function signalOf(memory: Memory): KnowledgeSignal {
  return {
    id: memory.id,
    title: clip(memory.title, 160),
    type: memory.type,
    status: memory.status,
    createdAt: memory.createdAt,
    workId: memory.workId,
  };
}

function lessonsByWork(
  proposed: Memory[],
  worksById: Map<WorkId, WorkSummary>,
): AttentionInput["lessons"] {
  const byWork = new Map<WorkId, { workId: WorkId; count: number; at: Date }>();

  for (const memory of proposed) {
    if (!memory.workId || !worksById.has(memory.workId)) continue;

    const current = byWork.get(memory.workId) ?? { workId: memory.workId, count: 0, at: memory.createdAt };
    current.count += 1;
    if (memory.createdAt > current.at) current.at = memory.createdAt;
    byWork.set(memory.workId, current);
  }

  return [...byWork.values()];
}

function awaitingOf(
  proposed: Memory[],
  worksById: Map<WorkId, WorkSummary>,
): MissionControlView["signals"]["awaiting"] {
  const missions = lessonsByWork(proposed, worksById)
    .sort((left, right) => right.count - left.count || right.at.getTime() - left.at.getTime())
    .slice(0, 3)
    .map((entry) => ({
      workId: entry.workId,
      objective: clip(worksById.get(entry.workId)!.objective, 160),
      count: entry.count,
    }));

  return {
    total: proposed.length,
    atLeast: proposed.length >= PROPOSED_READ,
    missions,
  };
}

/**
 * Business outcomes, newest first.
 *
 * Every step of a mission writes an artifact, so artifacts are gathered per
 * mission and folded into the mission's own completion when both are in view;
 * otherwise a busy afternoon reads as a column of "artifact created".
 */
function outcomesOf(events: Event[], worksById: Map<WorkId, WorkSummary>): Outcome[] {
  const artifacts = new Map<WorkId, { count: number; latest: Event }>();
  const completed = new Set<WorkId>();

  for (const event of events) {
    if (!event.workId) continue;

    if (event.type === "artifact.created") {
      const current = artifacts.get(event.workId);
      artifacts.set(event.workId, { count: (current?.count ?? 0) + 1, latest: current?.latest ?? event });
    }

    if (event.type === "work.completed") completed.add(event.workId);
  }

  const outcomes: Outcome[] = [];
  const artifactsShown = new Set<WorkId>();

  for (const event of events) {
    const work = event.workId ? worksById.get(event.workId) : undefined;
    const detail = work ? clip(work.objective, 200) : undefined;
    const missionPath = event.workId && work ? `/missions/${event.workId}` : undefined;
    const title = typeof event.payload.title === "string" ? clip(event.payload.title, 140) : undefined;

    switch (event.type) {
      case "work.completed": {
        const steps = typeof event.payload.taskCount === "number" ? event.payload.taskCount : undefined;
        const made = event.workId ? artifacts.get(event.workId)?.count ?? 0 : 0;
        const notes = [
          steps !== undefined ? `${steps} ${plural(steps, "step")}` : undefined,
          made > 0 ? `${made} ${plural(made, "artifact")}` : undefined,
        ].filter(Boolean);

        outcomes.push({
          id: event.id,
          kind: "mission_completed",
          text: "Mission finished",
          detail,
          note: notes.length > 0 ? notes.join(" · ") : undefined,
          path: missionPath,
          at: event.timestamp,
        });
        break;
      }

      case "work.failed":
        outcomes.push({
          id: event.id,
          kind: "mission_failed",
          text: "Mission stopped",
          detail,
          note: publicFailureReason(
            typeof event.payload.error === "string" ? event.payload.error
              : typeof event.payload.reason === "string" ? event.payload.reason
              : undefined,
          ),
          path: missionPath,
          at: event.timestamp,
        });
        break;

      case "artifact.created": {
        if (!event.workId || completed.has(event.workId) || artifactsShown.has(event.workId)) break;
        artifactsShown.add(event.workId);

        const entry = artifacts.get(event.workId)!;
        const name = typeof entry.latest.payload.name === "string" ? clip(entry.latest.payload.name, 120) : undefined;

        outcomes.push({
          id: `artifacts:${event.workId}`,
          kind: "artifacts",
          text: entry.count > 1 ? `Produced ${entry.count} artifacts` : name ? `Produced “${name}”` : "Produced an artifact",
          detail,
          path: missionPath,
          at: entry.latest.timestamp,
        });
        break;
      }

      case "approval.approved":
      case "approval.rejected":
        outcomes.push({
          id: event.id,
          kind: "decision",
          text: `${event.type === "approval.approved" ? "Approved" : "Rejected"} ${title ? `“${title}”` : "a step"}`,
          detail,
          path: missionPath,
          at: event.timestamp,
        });
        break;

      case "knowledge.approved":
      case "knowledge.merged":
      case "knowledge.superseded": {
        const knowledgeId = typeof event.payload.knowledgeId === "string" && UUID.test(event.payload.knowledgeId)
          ? event.payload.knowledgeId
          : undefined;
        const verb = event.type === "knowledge.approved"
          ? "Kept as company knowledge"
          : event.type === "knowledge.merged" ? "Confirmed again" : "Replaced older knowledge with";

        outcomes.push({
          id: event.id,
          kind: "knowledge",
          text: title ? `${verb}: “${title}”` : verb,
          detail,
          path: knowledgeId ? `/brain/${knowledgeId}` : undefined,
          at: event.timestamp,
        });
        break;
      }

      default:
        break;
    }

    if (outcomes.length >= OUTCOMES_SHOWN) break;
  }

  return outcomes;
}
