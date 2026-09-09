// Typed client for the UNI-OFFICE API. No framework, no caching layer - the
// backend is small enough that typed fetch calls are the honest amount of
// infrastructure this needs right now.
//
// Every type here mirrors a real API response. Nothing in the web app should
// invent a shape the backend does not actually return.

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

export interface MemoryItem {
  id: string;
  type: string;
  scope: string;
  content: string;
  importance: number;
  agentId?: string;
  workId?: string;
  taskId?: string;
  source?: string;
  createdAt: string;
  metadata: Record<string, unknown>;
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

export interface AgentAssignment {
  task: TaskItem;
  work?: WorkItem;
}

export interface AgentDetail {
  agent: AgentSummary & { workspaceId?: string };
  workspace?: WorkspaceItem;
  tools: Array<{ id: string; name: string; description: string }>;
  /** Tool ids the agent holds that the registry no longer knows about. */
  unknownToolIds: string[];
  assignments: AgentAssignment[];
  current?: AgentAssignment;
  artifacts: ArtifactItem[];
  activity: ActivityEvent[];
  completedCount: number;
  failedCount: number;
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

export interface WorkDetail {
  work: WorkItem;
  tasks: TaskItem[];
  events: ActivityEvent[];
  artifacts: ArtifactItem[];
  approvals: ApprovalItem[];
  agents: AgentSummary[];
  /** What this run wrote into the company's memory. Often empty. */
  memories: MemoryItem[];
  /** Present only while a job for this work is queued or running. */
  executionJob?: ExecutionJobSummary | null;
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

export interface CompanyOverview {
  organizationId: string;
  generatedAt: string;
  work: {
    total: number;
    byStatus: Record<WorkStatus, number>;
    active: WorkItem[];
    recentlyCompleted: WorkItem[];
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

// No auth/org-selection UI exists yet, so the client targets the seeded
// development organization by default. Override with VITE_ORGANIZATION_ID
// once real organization selection lands.
const DEFAULT_ORGANIZATION_ID = "2f6b579a-f0f8-45a5-868a-21c08bde1314";

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

export function organizationId(): string {
  return (
    (import.meta.env.VITE_ORGANIZATION_ID as string | undefined) ??
    DEFAULT_ORGANIZATION_ID
  );
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
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(
      (error as Error)?.name === "AbortError"
        ? "The request took too long and was cancelled."
        : "Could not reach the UNI-OFFICE API.",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;

    throw new ApiError(
      body?.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
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
  const search = new URLSearchParams({ organizationId: organizationId() });

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }

  return `${path}?${search.toString()}`;
}

export async function fetchOverview(activityLimit = 40): Promise<CompanyOverview> {
  return get<CompanyOverview>(scoped("/overview", { activityLimit }), 60_000);
}

export async function fetchActivity(limit = 40): Promise<ActivityEvent[]> {
  const data = await get<{ events: ActivityEvent[] }>(
    scoped("/activity", { limit }),
  );

  return data.events;
}

export async function fetchMemory(query?: string, limit = 60): Promise<MemoryItem[]> {
  const data = await get<{ memories: MemoryItem[] }>(
    scoped("/memory", { limit, query: query?.trim() || undefined }),
  );

  return data.memories;
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

export async function fetchWorkDetail(workId: string): Promise<WorkDetail> {
  return get<WorkDetail>(`/work/${workId}/detail`);
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

export async function fetchAgent(agentId: string): Promise<AgentDetail> {
  return get<AgentDetail>(scoped(`/agents/${agentId}`), 60_000);
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
  },
): Promise<AgentSummary> {
  const data = await post<{ agent: AgentSummary }>(
    `/agents/${agentId}`,
    { organizationId: organizationId(), ...changes },
    READ_TIMEOUT_MS,
  );

  return data.agent;
}

export async function fetchPendingApprovals(): Promise<ApprovalItem[]> {
  const data = await get<{ approvals: ApprovalItem[] }>(scoped("/approvals"));

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

export async function retryWork(workId: string): Promise<RetryResult> {
  return post<RetryResult>(`/work/${workId}/retry`, {}, READ_TIMEOUT_MS);
}

export async function resolveApproval(
  approvalId: string,
  decision: "approve" | "reject",
  resolvedBy: string,
): Promise<{ approval: ApprovalItem }> {
  return post(`/approvals/${approvalId}/${decision}`, { resolvedBy });
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
