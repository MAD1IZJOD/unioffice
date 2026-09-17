// Typed client for the UNI-OFFICE API. No framework, no caching layer - the
// backend is small enough that typed fetch calls are the honest amount of
// infrastructure this needs right now.
//
// Every type here mirrors a real API response. Nothing in the web app should
// invent a shape the backend does not actually return.

import { accessToken, reportUnauthorized } from "./session";

export type WorkStatus =
  | "queued"
  | "planning"
  | "executing"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentPresence =
  | "working"
  | "waiting"
  | "blocked"
  | "available"
  | "disabled";

export interface ActivityEvent {
  id: string;
  type: string;
  timestamp: string;
  organizationId: string;
  workId?: string;
  taskId?: string;
  agentId?: string;
  actorType: "user" | "agent" | "system";
  payload: Record<string, unknown>;
}

/* --------------------------------------------------------------------------
   Company knowledge.

   What the company knows, where each piece came from, and what it has been
   used for. The backend decides relevance, lifecycle, conflicts and who may
   see what; every field here is read back from it.
   -------------------------------------------------------------------------- */

export type KnowledgeType =
  | "fact"
  | "decision"
  | "insight"
  | "policy"
  | "process"
  | "preference"
  | "lesson"
  | "assumption"
  | "reference"
  | "experience";

export type KnowledgeStatus = "proposed" | "active" | "archived";

export type KnowledgeSourceType =
  | "mission"
  | "task"
  | "artifact"
  | "user"
  | "agent"
  | "approval";

export interface KnowledgeItem {
  id: string;
  organizationId: string;
  workspaceId?: string;
  agentId?: string;
  workId?: string;
  taskId?: string;
  artifactId?: string;
  scope: string;
  type: KnowledgeType;
  status: KnowledgeStatus;
  title: string;
  content: string;
  source?: string;
  sourceType: KnowledgeSourceType;
  importance: number;
  confidence?: number;
  createdBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  supersedesId?: string;
  archivedAt?: string;
  embeddingModel?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

/** Company memory, as the surfaces that predate knowledge still name it. */
export type MemoryItem = KnowledgeItem;

export interface KnowledgeSearchResult {
  knowledge: KnowledgeItem;
  /** 0-1, present only when the search had a query. */
  relevance?: number;
  reasons: string[];
  stale: boolean;
  ageDays: number;
  /** The text is phrased as instructions to an AI. */
  flagged: boolean;
}

export interface KnowledgeSearchResponse {
  mode: "relevance" | "recent";
  items: KnowledgeSearchResult[];
}

export interface KnowledgeFilters {
  query?: string;
  types?: KnowledgeType[];
  statuses?: KnowledgeStatus[];
  /** A workspace id, or "company" for company-wide knowledge only. */
  workspaceId?: string;
  sourceType?: KnowledgeSourceType;
  minImportance?: number;
  createdAfter?: string;
  limit?: number;
  offset?: number;
}

export type KnowledgeConflictStatus = "open" | "resolved" | "dismissed";

export interface KnowledgeConflictItem {
  id: string;
  organizationId: string;
  memoryId: string;
  conflictingMemoryId: string;
  reason: string;
  signals: Record<string, unknown>;
  status: KnowledgeConflictStatus;
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  detectedAt: string;
}

export interface KnowledgeOverview {
  organizationId: string;
  generatedAt: string;
  counts: {
    proposed: number;
    active: number;
    archived: number;
    openConflicts: number;
    missionsInformed: number;
    recallsRecorded: number;
    stale: number;
  };
  byType: Partial<Record<KnowledgeType, number>>;
  byTypeSampleSize: number;
  recentlyLearned: KnowledgeItem[];
  awaitingReview: KnowledgeItem[];
  important: KnowledgeItem[];
  inUse: Array<{
    knowledge: KnowledgeItem;
    recallCount: number;
    missionCount: number;
    lastRecalledAt: string;
  }>;
  conflicts: Array<{
    conflict: KnowledgeConflictItem;
    left: KnowledgeItem;
    right: KnowledgeItem;
  }>;
  archived: KnowledgeItem[];
  retrieval: { semantic: boolean; embeddingModel?: string };
}

export interface KnowledgeDetail {
  knowledge: KnowledgeItem;
  freshness: { ageDays: number; stale: boolean; horizonDays: number | null };
  flags: string[];
  provenance: {
    sourceType: KnowledgeSourceType;
    createdBy?: string;
    reviewedBy?: string;
    reviewedAt?: string;
    mission?: { id: string; objective: string; status: WorkStatus; createdAt: string };
    task?: { id: string; title: string; status: TaskStatus };
    artifact?: { id: string; name: string; type: string };
    agent?: { id: string; name: string; capabilities: string[] };
    workspace?: { id: string; name: string };
    extraction?: { model?: string; rationale?: string; governance?: string };
  };
  related: {
    sameMission: KnowledgeItem[];
    sameArtifact: KnowledgeItem[];
    similar: Array<{ knowledge: KnowledgeItem; relevance: number; reasons: string[] }>;
    supersedes?: KnowledgeItem;
    supersededBy?: KnowledgeItem;
    /** Set when a person merged this entry into another that says the same. */
    mergedInto?: KnowledgeItem;
  };
  /** Later missions that arrived at this knowledge, recorded when merged in. */
  confirmations: Array<{
    mission?: { id: string; objective: string };
    wording?: string;
    mergedAt?: string;
  }>;
  usage: {
    recallCount: number;
    missions: Array<{
      mission: { id: string; objective: string; status: WorkStatus };
      stages: Array<"planning" | "execution">;
      lastRecalledAt: string;
      bestRank: number;
      reasons: string[];
    }>;
  };
  conflicts: Array<{
    conflict: KnowledgeConflictItem;
    counterpart?: KnowledgeItem;
  }>;
}

/** One entry exactly as an agent would be handed it. */
export interface RecalledKnowledge {
  ref: string;
  id: string;
  type: KnowledgeType;
  status: "active" | "proposed";
  title: string;
  content: string;
  source: string;
  recordedAt: string;
  reviewed: boolean;
  stale: boolean;
  confidence?: number;
  reasons: string[];
  conflictsWith?: string[];
  flags?: string[];
}

export interface RecallPreview {
  items: RecalledKnowledge[];
  withheldCount: number;
}

/** What became of one thing a mission taught the company. */
export type MissionDebriefOutcome =
  | "pending"
  | "kept"
  | "merged"
  | "replaced"
  | "discarded";

export interface MissionDebriefRelation {
  knowledge: KnowledgeItem;
  /** Measured by the backend: an embedding similarity or a detected conflict. */
  relation: "restates" | "contradicts" | "related";
  similarity?: number;
  /** Whether the backend would accept this entry as the one to merge into. */
  canMerge: boolean;
}

export interface MissionDebriefItem {
  knowledge: KnowledgeItem;
  outcome: MissionDebriefOutcome;
  mergedInto?: { id: string; title: string; status: KnowledgeStatus };
  replacedBy?: { id: string; title: string; status: KnowledgeStatus };
  replaces?: { id: string; title: string; status: KnowledgeStatus };
  evidence: {
    task?: { id: string; title: string };
    agent?: { id: string; name: string };
    artifact?: { id: string; name: string };
    rationale?: string;
  };
  related: MissionDebriefRelation[];
}

export interface MissionKnowledge {
  /** Each thing the mission taught, with its evidence and what became of it. */
  review: MissionDebriefItem[];
  learned: KnowledgeItem[];
  used: Array<{
    knowledge: KnowledgeItem;
    stages: Array<"planning" | "execution">;
    taskIds: string[];
    agentIds: string[];
    reasons: string[];
    fromThisMission: boolean;
  }>;
}

export interface CaptureReport {
  created: KnowledgeItem[];
  duplicates: string[];
  discarded: Array<{ title: string; reason: string }>;
  rejected: Array<{ title?: string; reason: string }>;
  skipped?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  type: "specialist" | "manager" | "orchestrator";
  status: "active" | "paused" | "disabled";
  capabilities: string[];
  toolIds: string[];
  /** The workspace this agent belongs to, when it belongs to one. */
  workspaceId?: string;
  metadata: Record<string, unknown>;
}

export interface WorkItem {
  id: string;
  organizationId: string;
  /** The workspace this mission runs inside, when it was scoped to one. */
  workspaceId?: string;
  objective: string;
  status: WorkStatus;
  priority: "low" | "normal" | "high" | "critical";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  metadata: Record<string, unknown>;
}

export interface ToolCallRecord {
  toolId: string;
  input: unknown;
  output?: unknown;
  error?: { code: string; message: string };
  status: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskItem {
  id: string;
  workId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedAgentId?: string;
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  metadata: {
    routing?: {
      requiredCapabilities?: string[];
      requiredTools?: string[];
      suggestedAgentType?: string;
    };
    delegation?: {
      delegation?: string;
      selectionReason?: string;
      capabilityFit?: string;
      matchedCapabilities?: string[];
      unmatchedCapabilities?: string[];
    };
    execution?: {
      status?: string;
      error?: { code: string; message: string };
      toolCalls?: ToolCallRecord[];
      metadata?: Record<string, unknown>;
    };
    approval?: {
      required?: boolean;
      reason?: string;
      status?: string;
    };
    plannerRef?: string;
    [key: string]: unknown;
  };
}

export interface ArtifactItem {
  id: string;
  workId?: string;
  taskId?: string;
  createdByAgentId?: string;
  name: string;
  type: string;
  description?: string;
  mimeType?: string;
  version: number;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface ApprovalItem {
  id: string;
  workId: string;
  taskId: string;
  agentId?: string;
  action: string;
  resource: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  metadata: Record<string, unknown>;
}

export type WorkspaceStatus = "active" | "archived";

export interface WorkspaceItem {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description?: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface WorkspaceSummary {
  workspace: WorkspaceItem;
  agentCount: number;
  workCount: number;
  activeWorkCount: number;
}

export interface WorkspaceDetail {
  workspace: WorkspaceItem;
  agents: AgentSummary[];
  work: WorkItem[];
  artifacts: ArtifactItem[];
  activity: ActivityEvent[];
}

export interface OrganizationItem {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "archived";
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface OrganizationOverview {
  organization: OrganizationItem;
  workspaces: WorkspaceSummary[];
  unassignedAgentCount: number;
  agentCount: number;
  workCount: number;
  activeWorkCount: number;
  activity: ActivityEvent[];
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  version: string;
  inputSchema: Record<string, unknown>;
}

export type ExecutionJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** The durable queue row backing this work item, when one is active. */
export interface ExecutionJobSummary {
  id: string;
  status: ExecutionJobStatus;
  reason: "requested" | "approval_resumed" | "retry" | "recovered";
  attempts: number;
  maxAttempts: number;
  claimedBy?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  createdAt: string;
}

/* --------------------------------------------------------------------------
   The execution room: one mission, read in one request.

   This replaced a client-side WorkDetail read that assembled the same page
   out of four requests. The /work/:id/detail endpoint it used is still
   served - it is a cheaper read than this one and worth keeping - but the
   web app has one description of a mission now rather than two that could
   drift apart.
   -------------------------------------------------------------------------- */

export type TaskReadiness =
  | "blocked"
  | "ready"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

export interface ExecutionNode {
  taskId: string;
  title: string;
  description: string;
  status: TaskStatus;
  readiness: TaskReadiness;
  assignedAgentId?: string;
  depth: number;
  dependsOn: string[];
  blocks: string[];
  blockedBy: string[];
  toolCallCount: number;
  requiredTools: string[];
  requiredCapabilities: string[];
  /** The skill the step follows, when it follows one. */
  skill?: { slug: string; name: string; version: number; scope: "system" | "organization" | "workspace" };
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  awaitingApproval: boolean;
}

export interface ExecutionLane {
  depth: number;
  taskIds: string[];
}

export interface ExecutionPlan {
  nodes: ExecutionNode[];
  lanes: ExecutionLane[];
  terminalTaskIds: string[];
  totalCount: number;
  completedCount: number;
  failedCount: number;
  progress: number;
  runningCount: number;
  widestLane: number;
  hasCycle: boolean;
}

export interface RoomMember {
  agent: AgentSummary;
  taskIds: string[];
  currentTaskId?: string;
  waitingOnTaskId?: string;
  running: number;
  completed: number;
  failed: number;
  toolCalls: number;
  artifactCount: number;
  selectionReason?: string;
  stretched: boolean;
}

export interface ExecutionRoom {
  work: WorkItem;
  workspace?: WorkspaceItem;
  tasks: TaskItem[];
  events: ActivityEvent[];
  artifacts: ArtifactItem[];
  approvals: ApprovalItem[];
  memories: MemoryItem[];
  executionJob?: ExecutionJobSummary | null;
  agents: AgentSummary[];
  orchestrator?: AgentSummary;
  cast: RoomMember[];
  plan: ExecutionPlan;
  tools: Array<{ id: string; name: string; description: string }>;
}

export interface AgentPresenceSummary extends AgentSummary {
  agentId: string;
  presence: AgentPresence;
  activeTask?: {
    id: string;
    workId: string;
    title: string;
    status: TaskStatus;
    startedAt?: string;
  };
  completedTaskCount: number;
  failedTaskCount: number;
  lastActiveAt?: string;
}

export type AttentionKind =
  | "decision"
  | "governance"
  | "failure"
  | "stalled"
  | "agent_unavailable"
  | "interrupted"
  | "conflict"
  | "lessons"
  | "recovering";

/**
 * `action` is stopped until a person does something. `review` blocks nothing
 * but wants a person's look. `watch` is the system recovering on its own. The
 * backend draws these lines; nothing here re-decides them.
 */
export type AttentionSeverity = "action" | "review" | "watch";

/* --------------------------------------------------------------------------
   Governance.

   What the company is allowed to do, who decided, and why. Every shape here
   mirrors a backend response - the browser renders decisions, it never makes
   one.
   -------------------------------------------------------------------------- */

export type PolicySubject =
  | "tool"
  | "task"
  | "knowledge_recall"
  | "knowledge_capture";

export type PolicyEffect = "allow" | "require_approval" | "deny";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type PolicyStatus = "draft" | "active" | "paused" | "archived";

export interface PolicyScope {
  agentIds: string[];
  toolIds: string[];
  workspaceIds: string[];
  capabilities: string[];
  /** Kinds of knowledge, for knowledge policies. Empty or absent is every kind. */
  knowledgeTypes?: string[];
}

export interface PolicyItem {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  subject: PolicySubject;
  scope: PolicyScope;
  effect: PolicyEffect;
  risk: RiskLevel;
  status: PolicyStatus;
  approvalPrompt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  metadata: Record<string, unknown>;
}

export type ToolAccess =
  | "allowed"
  | "requires_approval"
  | "denied"
  | "not_granted";

export interface GovernedAgent {
  agentId: string;
  name: string;
  type: AgentSummary["type"];
  status: AgentSummary["status"];
  capabilities: string[];
  tools: Array<{
    toolId: string;
    name: string;
    access: ToolAccess;
    risk: RiskLevel;
    policyNames: string[];
    explanation: string;
  }>;
  policyIds: string[];
  deniedCount: number;
  approvalRequiredCount: number;
}

export interface GovernedTool {
  toolId: string;
  name: string;
  description: string;
  risk: RiskLevel;
  grantedAgentCount: number;
  permittedAgentCount: number;
  policyIds: string[];
  policyNames: string[];
  callCount: number;
  blockedCount: number;
}

export interface GovernanceDecisionRecord {
  eventId: string;
  at: string;
  outcome: "allowed" | "approval_required" | "denied";
  action: string;
  risk: RiskLevel;
  summary: string;
  policyId?: string;
  policyName?: string;
  agentId?: string;
  agentName?: string;
  workId?: string;
  taskId?: string;
  reasons: Array<{
    policyId?: string;
    policyName: string;
    effect: string;
    risk: string;
    explanation: string;
  }>;
}

export interface GovernanceOverview {
  organizationId: string;
  generatedAt: string;
  policies: PolicyItem[];
  counts: {
    active: number;
    draft: number;
    paused: number;
    denying: number;
    gating: number;
    agentsGoverned: number;
    toolsGoverned: number;
    pendingApprovals: number;
    deniedRecently: number;
  };
  agents: GovernedAgent[];
  tools: GovernedTool[];
  decisions: GovernanceDecisionRecord[];
  changes: ActivityEvent[];
  pendingApprovals: ApprovalItem[];
}

export interface NewPolicy {
  name: string;
  description: string;
  subject: PolicySubject;
  effect: PolicyEffect;
  risk: RiskLevel;
  status?: PolicyStatus;
  scope?: Partial<PolicyScope>;
  approvalPrompt?: string;
}

export interface PolicyChanges {
  name?: string;
  description?: string;
  effect?: PolicyEffect;
  risk?: RiskLevel;
  status?: PolicyStatus;
  scope?: Partial<PolicyScope>;
  /** null clears the prompt; undefined leaves it alone. */
  approvalPrompt?: string | null;
}

export type AttentionLevel = "critical" | "high" | "normal" | "low";

export type AttentionSource =
  | "approval"
  | "governance"
  | "execution"
  | "planning"
  | "queue"
  | "workforce"
  | "knowledge";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  level: AttentionLevel;
  /** Which part of the system raised it. */
  source: AttentionSource;
  label: string;
  detail: string;
  consequence: string;
  /** The one thing to do about it, and where it is done. */
  action: { label: string; path: string };
  /** Whether a person can mark it as seen. */
  acknowledgeable: boolean;
  workId?: string;
  objective?: string;
  taskId?: string;
  agentId?: string;
  at: string;
}

export interface AttentionQueue {
  items: AttentionItem[];
  /** Stopped until a person acts. */
  actionCount: number;
  /** Worth a person's look; nothing is blocked. */
  reviewCount: number;
  /** The system saying what it is handling itself. */
  watchCount: number;
  total: number;
}

/* --------------------------------------------------------------------------
   Mission Control.

   The company's operational state in one read. Every value is shaped on the
   server for a person: failure reasons are cleaned, events are described in
   words, and nothing raw - plans, briefings, tool inputs - is included.
   -------------------------------------------------------------------------- */

export type MissionPhase =
  | "planning"
  | "queued"
  | "running"
  | "waiting_approval"
  | "stalled"
  | "completed"
  | "failed"
  | "cancelled";

export interface MissionCard {
  id: string;
  objective: string;
  name?: string;
  template?: string;
  status: WorkStatus;
  phase: MissionPhase;
  priority: "low" | "normal" | "high" | "critical";
  workspaceId?: string;
  stage: string;
  currentSteps: string[];
  progress: { total: number; completed: number; running: number; failed: number };
  team: Array<{
    agentId: string;
    name: string;
    state: "working" | "waiting" | "done" | "assigned" | "unavailable";
  }>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastActivityAt: string;
  elapsedMs?: number;
  blocked?: { kind: "approval" | "agent_unavailable" | "stalled"; reason: string };
  failure?: string;
  acknowledged: boolean;
  latest?: { text: string; at: string };
}

export interface MissionOutcome {
  id: string;
  kind: "mission_completed" | "mission_failed" | "artifacts" | "decision" | "knowledge";
  text: string;
  detail?: string;
  note?: string;
  path?: string;
  at: string;
}

export interface KnowledgeSignal {
  id: string;
  title: string;
  type: KnowledgeType;
  status: KnowledgeStatus;
  createdAt: string;
  workId?: string;
}

export interface MissionControl {
  organizationId: string;
  generatedAt: string;
  summary: {
    running: number;
    blocked: number;
    needsYou: number;
    finishedToday: number;
    failedToday: number;
    setAside: number;
    total: number;
  };
  running: MissionCard[];
  blocked: MissionCard[];
  finished: MissionCard[];
  attention: AttentionQueue;
  outcomes: MissionOutcome[];
  signals: {
    decisions: KnowledgeSignal[];
    lessons: KnowledgeSignal[];
    awaiting: {
      total: number;
      atLeast: boolean;
      missions: Array<{ workId: string; objective: string; count: number }>;
    };
    conflicts: Array<{
      id: string;
      reason: string;
      left: { id: string; title: string };
      right: { id: string; title: string };
    }>;
  };
  workforce: {
    total: number;
    active: number;
    working: number;
    unavailable: Array<{ agentId: string; name: string; status: "active" | "paused" | "disabled" }>;
    roster: Array<{
      agentId: string;
      name: string;
      type: "specialist" | "manager" | "orchestrator";
      status: "active" | "paused" | "disabled";
      capabilities: string[];
    }>;
  };
}

/** How far through its plan one mission is. */
export interface WorkPace {
  workId: string;
  total: number;
  completed: number;
  running: number;
  failed: number;
  progress: number;
}

export interface CompanyOverview {
  organizationId: string;
  generatedAt: string;
  work: {
    total: number;
    byStatus: Record<WorkStatus, number>;
    active: WorkItem[];
    recentlyCompleted: WorkItem[];
    /** Keyed by mission id, covering `active` and `recentlyCompleted`. */
    pace: Record<string, WorkPace>;
  };
  tasks: {
    total: number;
    running: number;
    waiting: number;
    completed: number;
    failed: number;
  };
  agents: AgentPresenceSummary[];
  approvals: ApprovalItem[];
  artifacts: ArtifactItem[];
  activity: ActivityEvent[];
  tools: Array<{
    id: string;
    name: string;
    description: string;
    authorizedAgentCount: number;
    callCount: number;
  }>;
}

export interface RetryResult {
  work: WorkItem;
  tasks: TaskItem[];
  mode: "replan" | "resume";
}

// The organization calls act in. Which organizations someone belongs to is the
// server's answer (from /me); this only remembers the one being shown. Left
// unset, the server uses the caller's oldest active membership.
let activeOrganizationId: string | undefined;

// Planning and execution both run a local model to completion, which takes
// minutes rather than seconds. A default fetch has no timeout at all, so a
// dead API would hang the page forever; these bounds are generous enough for
// real model work and still fail visibly.
const READ_TIMEOUT_MS = 30_000;
const MODEL_TIMEOUT_MS = 600_000;

function apiBaseUrl(): string {
  return (
    (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
    "http://127.0.0.1:4000"
  );
}

/**
 * A URL that opens the live channel once.
 *
 * EventSource takes a URL and nothing else - no headers, no body - and an
 * access token does not belong in a URL. So a signed-in request buys a
 * single-use ticket first, and the ticket goes in the URL instead. The work
 * id narrows the stream server-side so a mission's tab is not sent the whole
 * company's log.
 */
export async function streamUrl(options: { workId?: string } = {}): Promise<string> {
  const { ticket } = await post<{ ticket: string; expiresAt: string }>(
    "/stream/tickets",
    { organizationId: organizationId() },
    READ_TIMEOUT_MS,
  );

  const search = new URLSearchParams({ ticket });
  const organization = organizationId();

  if (organization) search.set("organizationId", organization);
  if (options.workId) search.set("workId", options.workId);

  return `${apiBaseUrl()}/stream?${search.toString()}`;
}

export function organizationId(): string | undefined {
  return activeOrganizationId;
}

export function setActiveOrganization(id: string | undefined): void {
  activeOrganizationId = id;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** A status of 0 means the request never reached the API at all. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = READ_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;

  try {
    // Every call carries the signed-in user's token. Who they are and what
    // they may do is decided by the API from that, never from this client.
    const token = await accessToken();

    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(
      (error as Error)?.name === "AbortError"
        ? "UNIOFFICE took too long to answer, so the request was stopped. Try again."
        : "UNIOFFICE can't reach its server right now. Check your connection and try again.",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (response.status === 401) reportUnauthorized();

    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;

    throw new ApiError(humaneMessage(response.status, body?.error?.message), response.status);
  }

  return response.json() as Promise<T>;
}

/**
 * What a person reads when a request fails.
 *
 * The API's own message is kept for anything the person can act on - a
 * refusal, a validation problem, a conflict. A server fault never carries a
 * useful message (the API deliberately says nothing about its internals), so
 * it becomes a plain sentence about what to do instead.
 */
export function humaneMessage(status: number, message: string | undefined): string {
  if (status >= 500) {
    return "UNIOFFICE couldn't complete that right now. Nothing was lost - try again in a moment.";
  }

  if (status === 429) {
    return message ?? "That was asked too often in a short time. Wait a moment and try again.";
  }

  if (status === 401) {
    return "Your session has ended. Sign in again to continue.";
  }

  return message ?? "That request could not be completed.";
}

function get<T>(path: string, timeoutMs?: number): Promise<T> {
  return request<T>(path, {}, timeoutMs);
}

function post<T>(
  path: string,
  body?: unknown,
  timeoutMs = MODEL_TIMEOUT_MS,
): Promise<T> {
  return request<T>(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
    timeoutMs,
  );
}

function scoped(path: string, params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams();
  const organization = organizationId();

  if (organization) search.set("organizationId", organization);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";

export type Permission =
  | "organization.read"
  | "organization.manage"
  | "members.manage"
  | "owners.manage"
  | "workspaces.manage"
  | "agents.configure"
  | "policies.manage"
  | "missions.create"
  | "missions.operate"
  | "approvals.decide"
  | "knowledge.propose"
  | "knowledge.curate"
  | "connections.manage"
  | "skills.manage";

/** Who is signed in and where they stand, as the API resolved it. */
export interface Me {
  user: { id: string; email: string };
  /** "none": signed in but not a member of the organization asked about. */
  standing: "active" | "suspended" | "none";
  organization: {
    id: string;
    memberId: string;
    role: OrganizationRole;
    permissions: Permission[];
    workspaces: Array<{ workspaceId: string; access: "member" | "viewer" }>;
  } | null;
  memberships: Array<{
    organizationId: string;
    role: OrganizationRole;
    status: "invited" | "active" | "suspended";
  }>;
}

export async function fetchMe(organization?: string): Promise<Me> {
  return get<Me>(
    organization ? `/me?organizationId=${encodeURIComponent(organization)}` : "/me",
  );
}

/* --------------------------------------------------------------------------
   Members.

   Who belongs to the organization, at what role, in which workspaces. The
   API decides who may change whom; these calls only ask.
   -------------------------------------------------------------------------- */

export type MemberStatus = "invited" | "active" | "suspended";

export interface MemberItem {
  id: string;
  email: string;
  role: OrganizationRole;
  status: MemberStatus;
  /** This row is the signed-in person. */
  you: boolean;
  joinedAt: string;
  updatedAt: string;
  workspaces: Array<{ workspaceId: string; access: "member" | "viewer" }>;
}

export async function fetchMembers(): Promise<MemberItem[]> {
  const { members } = await get<{ members: MemberItem[] }>(scoped("/members"));
  return members;
}

export async function inviteMember(email: string, role: OrganizationRole): Promise<MemberItem> {
  const { member } = await post<{ member: MemberItem }>(
    "/members",
    { organizationId: organizationId(), email, role },
    READ_TIMEOUT_MS,
  );
  return member;
}

export async function changeMemberRole(memberId: string, role: OrganizationRole): Promise<MemberItem> {
  const { member } = await post<{ member: MemberItem }>(
    `/members/${memberId}/role`,
    { organizationId: organizationId(), role },
    READ_TIMEOUT_MS,
  );
  return member;
}

export async function suspendMember(memberId: string): Promise<MemberItem> {
  const { member } = await post<{ member: MemberItem }>(
    `/members/${memberId}/suspend`,
    { organizationId: organizationId() },
    READ_TIMEOUT_MS,
  );
  return member;
}

export async function reactivateMember(memberId: string): Promise<MemberItem> {
  const { member } = await post<{ member: MemberItem }>(
    `/members/${memberId}/reactivate`,
    { organizationId: organizationId() },
    READ_TIMEOUT_MS,
  );
  return member;
}

export async function removeMember(memberId: string): Promise<void> {
  await post(`/members/${memberId}/remove`, { organizationId: organizationId() }, READ_TIMEOUT_MS);
}

/** access null takes the grant away. */
export async function setMemberWorkspaceAccess(
  memberId: string,
  workspaceId: string,
  access: "member" | "viewer" | null,
): Promise<MemberItem> {
  const { member } = await post<{ member: MemberItem }>(
    `/members/${memberId}/workspaces`,
    { organizationId: organizationId(), workspaceId, access },
    READ_TIMEOUT_MS,
  );
  return member;
}

export async function fetchOverview(activityLimit = 40): Promise<CompanyOverview> {
  return get<CompanyOverview>(scoped("/overview", { activityLimit }), 60_000);
}

export async function fetchGovernance(
  activityLimit = 200,
): Promise<GovernanceOverview> {
  return get<GovernanceOverview>(
    scoped("/governance", { activityLimit }),
    60_000,
  );
}

export async function fetchPolicies(
  includeArchived = false,
): Promise<PolicyItem[]> {
  const data = await get<{ policies: PolicyItem[] }>(
    scoped("/policies", {
      includeArchived: includeArchived ? "true" : undefined,
    }),
  );

  return data.policies;
}

export async function createPolicy(policy: NewPolicy): Promise<PolicyItem> {
  const data = await post<{ policy: PolicyItem }>(
    "/policies",
    { organizationId: organizationId(), ...policy },
    READ_TIMEOUT_MS,
  );

  return data.policy;
}

export async function updatePolicy(
  policyId: string,
  changes: PolicyChanges,
): Promise<PolicyItem> {
  const data = await post<{ policy: PolicyItem }>(
    `/policies/${policyId}`,
    { organizationId: organizationId(), ...changes },
    READ_TIMEOUT_MS,
  );

  return data.policy;
}

export async function fetchAttention(limit = 25): Promise<AttentionQueue> {
  return get<AttentionQueue>(scoped("/attention", { limit }));
}

/** Several bounded reads against the database, so it gets a read budget of its own. */
const MISSION_CONTROL_TIMEOUT_MS = 45_000;

export async function fetchMissionControl(): Promise<MissionControl> {
  return get<MissionControl>(scoped("/mission-control"), MISSION_CONTROL_TIMEOUT_MS);
}

/** Marks a stopped or stalled mission as seen. The server decides whether it can be. */
export async function acknowledgeMission(
  workId: string,
): Promise<{ workId: string; acknowledgedAt: string }> {
  return post(
    `/work/${encodeURIComponent(workId)}/acknowledge`,
    { organizationId: organizationId() },
    READ_TIMEOUT_MS,
  );
}

export async function fetchActivity(limit = 40): Promise<ActivityEvent[]> {
  const data = await get<{ events: ActivityEvent[] }>(
    scoped("/activity", { limit }),
  );

  return data.events;
}

export async function fetchMemory(query?: string, limit = 50): Promise<MemoryItem[]> {
  const data = await get<{ memories: MemoryItem[] }>(
    scoped("/memory", { limit: Math.min(limit, 50), query: query?.trim() || undefined }),
  );

  return data.memories;
}

// A search embeds its query on the local model, which is quick but not free.
const KNOWLEDGE_SEARCH_TIMEOUT_MS = 60_000;

export async function searchKnowledge(
  filters: KnowledgeFilters = {},
): Promise<KnowledgeSearchResponse> {
  return get<KnowledgeSearchResponse>(
    scoped("/knowledge", {
      query: filters.query?.trim() || undefined,
      types: filters.types?.length ? filters.types.join(",") : undefined,
      statuses: filters.statuses?.length ? filters.statuses.join(",") : undefined,
      workspaceId: filters.workspaceId,
      sourceType: filters.sourceType,
      minImportance: filters.minImportance,
      createdAfter: filters.createdAfter,
      limit: filters.limit,
      offset: filters.offset,
    }),
    KNOWLEDGE_SEARCH_TIMEOUT_MS,
  );
}

export async function fetchKnowledgeOverview(): Promise<KnowledgeOverview> {
  return get<KnowledgeOverview>(scoped("/knowledge/overview"), 60_000);
}

export async function fetchKnowledgeDetail(knowledgeId: string): Promise<KnowledgeDetail> {
  return get<KnowledgeDetail>(scoped(`/knowledge/${knowledgeId}`), KNOWLEDGE_SEARCH_TIMEOUT_MS);
}

export async function previewRecall(input: {
  query: string;
  workspaceId?: string;
  agentId?: string;
}): Promise<RecallPreview> {
  return get<RecallPreview>(
    scoped("/knowledge/recall-preview", {
      query: input.query.trim(),
      workspaceId: input.workspaceId || undefined,
      agentId: input.agentId || undefined,
    }),
    KNOWLEDGE_SEARCH_TIMEOUT_MS,
  );
}

export async function fetchMissionKnowledge(workId: string): Promise<MissionKnowledge> {
  return get<MissionKnowledge>(scoped(`/work/${workId}/knowledge`));
}

export async function createKnowledge(input: {
  title: string;
  content: string;
  type: KnowledgeType;
  importance?: number;
  confidence?: number;
  workspaceId?: string;
}): Promise<KnowledgeItem> {
  const data = await post<{ knowledge: KnowledgeItem }>(
    "/knowledge",
    {
      organizationId: organizationId(),
      ...input,
      workspaceId: input.workspaceId || undefined,
    },
    KNOWLEDGE_SEARCH_TIMEOUT_MS,
  );

  return data.knowledge;
}

export async function updateKnowledge(
  knowledgeId: string,
  changes: {
    title?: string;
    content?: string;
    type?: KnowledgeType;
    importance?: number;
    /** null clears it. */
    confidence?: number | null;
    /** null makes it company-wide. */
    workspaceId?: string | null;
  },
): Promise<KnowledgeItem> {
  const data = await post<{ knowledge: KnowledgeItem }>(
    `/knowledge/${knowledgeId}`,
    { organizationId: organizationId(), ...changes },
    KNOWLEDGE_SEARCH_TIMEOUT_MS,
  );

  return data.knowledge;
}

export async function approveKnowledge(knowledgeId: string): Promise<KnowledgeItem> {
  const data = await post<{ knowledge: KnowledgeItem }>(
    `/knowledge/${knowledgeId}/approve`,
    { organizationId: organizationId() },
    READ_TIMEOUT_MS,
  );

  return data.knowledge;
}

export async function archiveKnowledge(
  knowledgeId: string,
  reason?: string,
): Promise<KnowledgeItem> {
  const data = await post<{ knowledge: KnowledgeItem }>(
    `/knowledge/${knowledgeId}/archive`,
    { organizationId: organizationId(), reason: reason?.trim() || undefined },
    READ_TIMEOUT_MS,
  );

  return data.knowledge;
}

export async function restoreKnowledge(knowledgeId: string): Promise<KnowledgeItem> {
  const data = await post<{ knowledge: KnowledgeItem }>(
    `/knowledge/${knowledgeId}/restore`,
    { organizationId: organizationId() },
    KNOWLEDGE_SEARCH_TIMEOUT_MS,
  );

  return data.knowledge;
}

/** The knowledge says what `intoId` already says; that entry is kept and re-confirmed. */
export async function mergeKnowledge(
  knowledgeId: string,
  intoId: string,
): Promise<{ knowledge: KnowledgeItem; merged: KnowledgeItem }> {
  return post<{ knowledge: KnowledgeItem; merged: KnowledgeItem }>(
    `/knowledge/${knowledgeId}/merge`,
    { organizationId: organizationId(), intoId },
    READ_TIMEOUT_MS,
  );
}

/** The knowledge replaces `replacesId`, which is archived as history. */
export async function supersedeKnowledge(
  knowledgeId: string,
  replacesId: string,
  note?: string,
): Promise<{ knowledge: KnowledgeItem; replaced: KnowledgeItem }> {
  return post<{ knowledge: KnowledgeItem; replaced: KnowledgeItem }>(
    `/knowledge/${knowledgeId}/supersede`,
    { organizationId: organizationId(), replacesId, note: note?.trim() || undefined },
    READ_TIMEOUT_MS,
  );
}

export async function resolveKnowledgeConflict(
  conflictId: string,
  resolution:
    | { resolution: "keep"; keepId: string }
    | { resolution: "both_hold" }
    | { resolution: "dismiss" },
  note?: string,
): Promise<KnowledgeConflictItem> {
  const data = await post<{ conflict: KnowledgeConflictItem }>(
    `/knowledge/conflicts/${conflictId}/resolve`,
    { organizationId: organizationId(), ...resolution, note: note?.trim() || undefined },
    READ_TIMEOUT_MS,
  );

  return data.conflict;
}

/** Runs the generation model over the artifact, so it gets the long timeout. */
export async function deriveKnowledgeFromArtifact(
  artifactId: string,
): Promise<CaptureReport> {
  return post<CaptureReport>(
    `/artifacts/${artifactId}/knowledge`,
    { organizationId: organizationId() },
    MODEL_TIMEOUT_MS,
  );
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const data = await get<{ agents: AgentSummary[] }>(scoped("/agents"));

  return data.agents;
}

export async function fetchTools(): Promise<ToolDescriptor[]> {
  const data = await get<{ tools: ToolDescriptor[] }>("/tools");

  return data.tools;
}

export async function fetchWorkList(options: {
  status?: WorkStatus;
  limit?: number;
} = {}): Promise<WorkItem[]> {
  const data = await get<{ work: WorkItem[] }>(
    scoped("/work", { status: options.status, limit: options.limit }),
  );

  return data.work;
}

/** Everything the execution room renders, in one round trip. */
export async function fetchExecutionRoom(workId: string): Promise<ExecutionRoom> {
  return get<ExecutionRoom>(`/work/${workId}/room`, 60_000);
}

export async function fetchArtifacts(limit = 50): Promise<ArtifactItem[]> {
  const data = await get<{ artifacts: ArtifactItem[] }>(
    scoped("/artifacts", { limit }),
  );

  return data.artifacts;
}

/* --------------------------------------------------------------------------
   The company itself: its organization, its workspaces and its workforce.
   -------------------------------------------------------------------------- */

export async function fetchOrganization(): Promise<OrganizationOverview> {
  return get<OrganizationOverview>(scoped("/organization"), 60_000);
}

export async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  const data = await get<{ workspaces: WorkspaceSummary[] }>(
    scoped("/workspaces"),
  );

  return data.workspaces;
}

export async function fetchWorkspace(
  workspaceId: string,
): Promise<WorkspaceDetail> {
  return get<WorkspaceDetail>(scoped(`/workspaces/${workspaceId}`), 60_000);
}

export async function createWorkspace(input: {
  name: string;
  description?: string;
}): Promise<WorkspaceItem> {
  const data = await post<{ workspace: WorkspaceItem }>(
    "/workspaces",
    {
      organizationId: organizationId(),
      name: input.name,
      description: input.description?.trim() || undefined,
    },
    READ_TIMEOUT_MS,
  );

  return data.workspace;
}

export async function updateWorkspace(
  workspaceId: string,
  changes: {
    name?: string;
    /** null clears the description; undefined leaves it alone. */
    description?: string | null;
    status?: WorkspaceStatus;
  },
): Promise<WorkspaceItem> {
  const data = await post<{ workspace: WorkspaceItem }>(
    `/workspaces/${workspaceId}`,
    { organizationId: organizationId(), ...changes },
    READ_TIMEOUT_MS,
  );

  return data.workspace;
}

/* --------------------------------------------------------------------------
   The workforce.

   Who works for the organization, what each of them is doing, what they may
   use and what they have done. Status, current work and outcomes are read by
   the API from the same task rows Mission Control reads; nothing here is
   computed in the browser.
   -------------------------------------------------------------------------- */

/** Only the states the backend records. */
export type WorkforcePresence = "working" | "waiting" | "available" | "paused" | "unavailable";

export interface WorkforceMember {
  id: string;
  name: string;
  description: string;
  type: AgentSummary["type"];
  status: AgentSummary["status"];
  presence: WorkforcePresence;
  capabilities: string[];
  tools: Array<{ id: string; name: string; description: string; registered: boolean }>;
  workspace?: { id: string; name: string; slug: string };
  current?: {
    missionId: string;
    missionName: string;
    taskTitle: string;
    state: "working" | "waiting";
    since?: string;
  };
  /** Busy on a mission outside the caller's workspaces. */
  workingElsewhere: boolean;
  upcomingSteps: number;
  lastOutcome?: {
    missionId: string;
    missionName: string;
    taskTitle: string;
    outcome: "completed" | "failed";
    at: string;
  };
  recent: { completed: number; failed: number };
}

export interface Workforce {
  organizationId: string;
  generatedAt: string;
  missionWindow: number;
  summary: Record<WorkforcePresence, number> & { total: number };
  members: WorkforceMember[];
}

export interface AgentProfile {
  member: WorkforceMember;
  history: Array<{
    taskId: string;
    taskTitle: string;
    status: TaskStatus;
    missionId: string;
    missionName: string;
    at: string;
  }>;
  artifacts: Array<{ id: string; name: string; type: string; missionId?: string; createdAt: string }>;
  activity: Array<{ id: string; type: string; at: string; summary: string; missionId?: string }>;
  governance: {
    tools: Array<{
      toolId: string;
      name: string;
      access: "allowed" | "requires_approval" | "denied";
      risk: RiskLevel;
      policyNames: string[];
      explanation: string;
    }>;
    policies: Array<{ id: string; name: string; effect: "allow" | "require_approval" | "deny"; risk: RiskLevel }>;
  };
  /** Assigned skills, as they resolve where the agent works. */
  skills: Array<{
    slug: string;
    name: string;
    category: SkillCategory | null;
    scope: SkillScope | null;
    approval: "none" | "required" | null;
    usable: boolean;
    note: string;
  }>;
  /** External systems the agent holds tools for, and whether it can use each now. */
  systems: Array<{
    provider: ConnectionProvider;
    name: string;
    state: "ready" | "not_connected" | "needs_attention" | "not_enabled";
    account?: string;
    scope?: "workspace" | "company";
    tools: Array<{ toolId: string; name: string; access: "read" | "write"; usable: boolean; note: string }>;
  }>;
}

export async function fetchWorkforce(): Promise<Workforce> {
  return get<Workforce>(scoped("/workforce"));
}

export async function fetchAgentProfile(agentId: string): Promise<AgentProfile> {
  return get<AgentProfile>(scoped(`/workforce/${encodeURIComponent(agentId)}`));
}

export async function createAgent(input: {
  name: string;
  description: string;
  type: AgentSummary["type"];
  capabilities: string[];
  toolIds: string[];
  workspaceId?: string;
}): Promise<AgentSummary> {
  const data = await post<{ agent: AgentSummary }>(
    "/agents",
    {
      organizationId: organizationId(),
      ...input,
      workspaceId: input.workspaceId || undefined,
    },
    READ_TIMEOUT_MS,
  );

  return data.agent;
}

export async function updateAgent(
  agentId: string,
  changes: {
    description?: string;
    capabilities?: string[];
    toolIds?: string[];
    /** null takes the agent out of its workspace. */
    workspaceId?: string | null;
    status?: AgentSummary["status"];
    /** Skill slugs, replacing the agent's current set. */
    skills?: string[];
  },
): Promise<AgentSummary> {
  const data = await post<{ agent: AgentSummary }>(
    `/agents/${agentId}`,
    { organizationId: organizationId(), ...changes },
    READ_TIMEOUT_MS,
  );

  return data.agent;
}

/** What the server says about an approval, for the person deciding it. */
export interface ApprovalBriefing {
  mission: { id: string; objective: string; workspace: string | null } | null;
  step: { title: string; description: string } | null;
  agent: { id: string; name: string } | null;
  requestedBy: "external_write" | "skill" | "policy" | "planner";
  policy: { id: string; name: string } | null;
  skill: string | null;
  externalWrites: string[];
  tools: string[];
  risk: RiskLevel | null;
  onApprove: string;
  onReject: string;
  decidedBy: "owners_and_admins" | "members";
  youCanDecide: boolean;
}

export async function fetchPendingApprovals(): Promise<Array<ApprovalItem & { briefing?: ApprovalBriefing }>> {
  const data = await get<{ approvals: Array<ApprovalItem & { briefing?: ApprovalBriefing }> }>(scoped("/approvals"));

  return data.approvals;
}

export interface NewMission {
  objective: string;
  priority?: WorkItem["priority"];
  /**
   * The workspace the mission runs inside. The planner and the delegator both
   * treat this as a hard boundary, so it decides which agents can be given
   * any of the work.
   */
  workspaceId?: string;
  /**
   * The requester's own context: constraints, figures, background. Stored on
   * the work row and read by the planner, so it genuinely shapes the plan
   * rather than sitting in a field nothing looks at.
   */
  briefing?: string;
}

export async function createWork(mission: NewMission): Promise<WorkItem> {
  const data = await post<{ work: WorkItem }>(
    "/work",
    {
      objective: mission.objective,
      priority: mission.priority ?? "normal",
      briefing: mission.briefing?.trim() || undefined,
      workspaceId: mission.workspaceId || undefined,
    },
    READ_TIMEOUT_MS,
  );

  return data.work;
}

/* --------------------------------------------------------------------------
   Mission templates.

   A template briefs a mission; it does not run one. Starting a template
   returns ordinary queued work, and the execution room takes it through the
   same plan, governance and queue as a mission typed from scratch.
   -------------------------------------------------------------------------- */

export type TemplateComplexity = "focused" | "cross_functional" | "broad";

export interface MissionTemplateField {
  label: string;
  placeholder: string;
  hint: string;
}

export interface MissionTemplate {
  id: string;
  version: number;
  name: string;
  purpose: string;
  outcome: string;
  capabilities: string[];
  complexity: TemplateComplexity;
  objective: MissionTemplateField;
  context: MissionTemplateField;
  desiredOutcome: MissionTemplateField;
  constraints: MissionTemplateField;
  planningGuidance: string;
}

export interface TemplateTeamMember {
  agentId: string;
  name: string;
  type: AgentSummary["type"];
  /** The template's disciplines this agent actually holds. */
  matchedCapabilities: string[];
}

export interface MissionTemplateView {
  template: MissionTemplate;
  /** Real agents from the roster, strongest match first. */
  likelyTeam: TemplateTeamMember[];
  planner?: TemplateTeamMember;
  governance: {
    /** Active rules that could stop a step or tool for this team. */
    gatingPolicies: Array<{ id: string; name: string; effect: PolicyEffect }>;
  };
}

export interface TemplateMissionInput {
  name?: string;
  objective: string;
  context?: string;
  desiredOutcome: string;
  constraints?: string;
  priority?: WorkItem["priority"];
  workspaceId?: string;
}

/**
 * The same limits the API enforces. Checked here only to tell a person early;
 * the server checks again and its answer is the one that counts.
 */
export const TEMPLATE_INPUT_LIMITS = {
  name: 120,
  objective: 1_000,
  context: 1_800,
  desiredOutcome: 600,
  constraints: 600,
} as const;

export const TEMPLATE_INPUT_MINIMUMS = {
  objective: 8,
  desiredOutcome: 4,
} as const;

export async function fetchMissionTemplates(): Promise<MissionTemplateView[]> {
  const data = await get<{ templates: MissionTemplateView[] }>(
    scoped("/mission-templates"),
  );

  return data.templates;
}

export async function fetchMissionTemplate(
  templateId: string,
): Promise<MissionTemplateView> {
  return get<MissionTemplateView>(
    scoped(`/mission-templates/${encodeURIComponent(templateId)}`),
  );
}

export async function startTemplateMission(
  templateId: string,
  input: TemplateMissionInput,
): Promise<WorkItem> {
  const data = await post<{ work: WorkItem }>(
    `/mission-templates/${encodeURIComponent(templateId)}/missions`,
    {
      organizationId: organizationId(),
      name: input.name?.trim() || undefined,
      objective: input.objective.trim(),
      context: input.context?.trim() || undefined,
      desiredOutcome: input.desiredOutcome.trim(),
      constraints: input.constraints?.trim() || undefined,
      priority: input.priority ?? "normal",
      workspaceId: input.workspaceId || undefined,
    },
    READ_TIMEOUT_MS,
  );

  return data.work;
}

export async function planWork(workId: string): Promise<{
  work: WorkItem;
  tasks: TaskItem[];
}> {
  return post(`/work/${workId}/plan`);
}

/**
 * Starts execution and returns as soon as the run is scheduled. Progress is
 * observed by polling the work detail, which is why this does not need the
 * long model timeout.
 */
export async function executeWork(workId: string): Promise<{
  work: WorkItem;
  tasks: TaskItem[];
  job: ExecutionJobSummary;
  enqueued: boolean;
}> {
  return post(`/work/${workId}/execute`, {}, READ_TIMEOUT_MS);
}

/**
 * Cancels a mission. The server refuses while a worker is running it or its
 * plan is being written, and records who cancelled from the caller.
 */
export async function cancelWork(
  workId: string,
  reason?: string,
): Promise<{ work: WorkItem; cancelledTaskCount: number; closedApprovalCount: number }> {
  return post(
    scoped(`/work/${encodeURIComponent(workId)}/cancel`),
    { reason: reason?.trim() || undefined },
    READ_TIMEOUT_MS,
  );
}

export async function retryWork(workId: string): Promise<RetryResult> {
  return post<RetryResult>(`/work/${workId}/retry`, {}, READ_TIMEOUT_MS);
}

/**
 * Who decided is recorded by the server from the caller, so nothing about the
 * decider is sent.
 */
export async function resolveApproval(
  approvalId: string,
  decision: "approve" | "reject",
): Promise<{ approval: ApprovalItem }> {
  return post(`/approvals/${approvalId}/${decision}`, { organizationId: organizationId() });
}

export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "—";

  const deltaMs = Date.now() - new Date(iso).getTime();

  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return "just now";
  }

  const seconds = Math.floor(deltaMs / 1_000);
  if (seconds < 45) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(iso).toLocaleDateString();
}

export function formatDuration(
  startIso: string | undefined,
  endIso: string | undefined,
): string {
  if (!startIso || !endIso) return "—";

  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";

  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

/* --------------------------------------------------------------------------
   Connections
   --------------------------------------------------------------------------
   External systems the organization has connected. Nothing here ever holds a
   token: the browser starts a round trip, the provider sends it back to the
   API, and the API keeps the credentials. */

export type ConnectionProvider = "github" | "google_drive";

export type ConnectionCapability = "github.read" | "github.write" | "drive.read";

export interface ConnectionProviderItem {
  provider: ConnectionProvider;
  name: string;
  description: string;
  /** False when this server has no OAuth client for the provider. */
  configured: boolean;
}

export interface ConnectionItem {
  id: string;
  provider: ConnectionProvider;
  providerName: string;
  status: "active" | "needs_attention" | "revoked";
  workspace: { id: string; name: string } | null;
  account: string | null;
  scopes: string[];
  capabilities: ConnectionCapability[];
  availableCapabilities: Array<{
    capability: ConnectionCapability;
    label: string;
    access: "read" | "write";
    enabled: boolean;
    grantable: boolean;
  }>;
  connectedBy: string | null;
  connectedAt: string;
  lastUsedAt: string | null;
  problem: string | null;
  revokedAt: string | null;
  tools: Array<{ id: string; name: string; access: "read" | "write" }>;
}

export interface ConnectionsOverview {
  providers: ConnectionProviderItem[];
  connections: ConnectionItem[];
}

export async function fetchConnections(): Promise<ConnectionsOverview> {
  return get<ConnectionsOverview>(scoped("/connections"));
}

export async function fetchConnection(connectionId: string): Promise<ConnectionItem> {
  const { connection } = await get<{ connection: ConnectionItem }>(
    scoped(`/connections/${encodeURIComponent(connectionId)}`),
  );
  return connection;
}

/** Where to send the browser to authorize. The provider returns it to the API, never here. */
export async function startConnection(
  provider: ConnectionProvider,
  options: { workspaceId?: string; repositoryAccess?: "public" | "private" } = {},
): Promise<string> {
  const { authorizationUrl } = await post<{ authorizationUrl: string }>(
    `/connections/${provider}/authorize`,
    {
      organizationId: organizationId(),
      workspaceId: options.workspaceId || undefined,
      repositoryAccess: options.repositoryAccess,
    },
    READ_TIMEOUT_MS,
  );
  return authorizationUrl;
}

export async function setConnectionCapabilities(
  connectionId: string,
  capabilities: ConnectionCapability[],
): Promise<ConnectionItem> {
  const { connection } = await post<{ connection: ConnectionItem }>(
    `/connections/${encodeURIComponent(connectionId)}/capabilities`,
    { organizationId: organizationId(), capabilities },
    READ_TIMEOUT_MS,
  );
  return connection;
}

export async function disconnectConnection(
  connectionId: string,
): Promise<{ connection: ConnectionItem; providerRevoked: boolean }> {
  return post<{ connection: ConnectionItem; providerRevoked: boolean }>(
    `/connections/${encodeURIComponent(connectionId)}/disconnect`,
    { organizationId: organizationId() },
    READ_TIMEOUT_MS,
  );
}

/* --------------------------------------------------------------------------
   Features
   --------------------------------------------------------------------------
   What the product can do here, for this person, as the server has it
   configured. Navigation is built from this. */

export type FeatureArea = "command" | "work" | "workforce" | "knowledge" | "company";

export interface FeatureItem {
  id: string;
  name: string;
  description: string;
  area: FeatureArea;
  path: string;
  dependsOn: string[];
  status: "available" | "limited" | "needs_configuration";
  note: string | null;
}

export interface FeatureCatalog {
  product: { name: string; version: string };
  features: FeatureItem[];
}

export async function fetchFeatures(): Promise<FeatureCatalog> {
  return get<FeatureCatalog>(scoped("/features"));
}

/* --------------------------------------------------------------------------
   Skills
   --------------------------------------------------------------------------
   What the workforce knows how to do. A skill grants nothing: an agent must
   already hold every tool and capability one needs. */

export type SkillScope = "system" | "organization" | "workspace";
export type SkillStatus = "draft" | "active" | "archived";
export type SkillCategory = "engineering" | "research" | "finance" | "people" | "communication" | "operations";

export interface SkillField {
  name: string;
  type: "text" | "number" | "list" | "table";
  description: string;
  required: boolean;
}

export interface SkillItem {
  id: string;
  scope: SkillScope;
  workspace: { id: string; name: string } | null;
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: number;
  status: SkillStatus;
  instructions: string;
  inputs: SkillField[];
  outputs: SkillField[];
  requiredTools: string[];
  requiredCapabilities: string[];
  approval: "none" | "required";
  memory: "recall" | "none";
  overrides: "system" | "organization" | null;
  overriddenBy: { id: string; name: string } | null;
  agents: Array<{ id: string; name: string; fits: boolean; missingTools: string[]; missingCapabilities: string[] }>;
  updatedAt: string;
}

export type SkillDraft = Pick<
  SkillItem,
  "slug" | "name" | "description" | "category" | "instructions" | "inputs" | "outputs" | "requiredTools" | "requiredCapabilities" | "approval" | "memory"
>;

export async function fetchSkills(): Promise<SkillItem[]> {
  const { skills } = await get<{ skills: SkillItem[] }>(scoped("/skills"));
  return skills;
}

export async function fetchSkill(reference: string): Promise<SkillItem> {
  const { skill } = await get<{ skill: SkillItem }>(scoped(`/skills/${encodeURIComponent(reference)}`));
  return skill;
}

export async function createSkill(
  draft: SkillDraft,
  options: { workspaceId?: string; status: "draft" | "active" },
): Promise<SkillItem> {
  const { skill } = await post<{ skill: SkillItem }>(
    "/skills",
    {
      organizationId: organizationId(),
      ...draft,
      scope: options.workspaceId ? "workspace" : "organization",
      workspaceId: options.workspaceId,
      status: options.status,
    },
    READ_TIMEOUT_MS,
  );
  return skill;
}

export async function updateSkill(id: string, changes: Partial<SkillDraft>, expectedVersion: number): Promise<SkillItem> {
  const { skill } = await post<{ skill: SkillItem }>(
    `/skills/${encodeURIComponent(id)}`,
    { organizationId: organizationId(), ...changes, expectedVersion },
    READ_TIMEOUT_MS,
  );
  return skill;
}

export async function setSkillStatus(id: string, status: SkillStatus, expectedVersion: number): Promise<SkillItem> {
  const { skill } = await post<{ skill: SkillItem }>(
    `/skills/${encodeURIComponent(id)}/status`,
    { organizationId: organizationId(), status, expectedVersion },
    READ_TIMEOUT_MS,
  );
  return skill;
}
