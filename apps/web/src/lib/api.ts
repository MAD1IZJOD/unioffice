// Thin client for the UNI-OFFICE API. No framework, no caching layer - the
// backend is small enough that a couple of typed fetch calls are the honest
// amount of infrastructure this needs right now.

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
  content: string;
  importance: number;
  agentId?: string;
  createdAt: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  capabilities: string[];
}

// No auth/org-selection UI exists yet, so the client targets the seeded
// development organization by default. Override with VITE_ORGANIZATION_ID
// once real organization selection lands.
const DEFAULT_ORGANIZATION_ID = "2f6b579a-f0f8-45a5-868a-21c08bde1314";

function apiBaseUrl(): string {
  return (
    (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
    "http://127.0.0.1:4000"
  );
}

function organizationId(): string {
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
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl()}${path}`);
  } catch {
    throw new ApiError("Could not reach the UNI-OFFICE API.", 0);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as
      | { error?: { message?: string } }
      | null;

    throw new ApiError(
      body?.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

export async function fetchActivity(limit = 20): Promise<ActivityEvent[]> {
  const data = await getJson<{ events: ActivityEvent[] }>(
    `/activity?organizationId=${organizationId()}&limit=${limit}`,
  );

  return data.events;
}

export async function fetchMemory(limit = 20): Promise<MemoryItem[]> {
  const data = await getJson<{ memories: MemoryItem[] }>(
    `/memory?organizationId=${organizationId()}`,
  );

  return data.memories.slice(0, limit);
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const data = await getJson<{ agents: AgentSummary[] }>(
    `/agents?organizationId=${organizationId()}`,
  );

  return data.agents;
}

export function formatRelativeTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();

  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return "just now";
  }

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
