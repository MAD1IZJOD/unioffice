import type {
  Agent,
  AgentId,
  ApprovalId,
  ApprovalRequest,
  Event,
  EventId,
  ExecutionJob,
  ExecutionJobId,
  Memory,
  MemoryId,
  OrganizationId,
  Task,
  TaskId,
  Work,
  WorkId,
} from "@unioffice/core";

import {
  InMemoryKnowledgeRepository,
  InMemoryOperationalReadRepository,
} from "@unioffice/database";

import { EventRecorder } from "./event-recorder.js";
import { MissionControlService } from "./mission-control-service.js";

/**
 * A company, in memory, for Mission Control tests.
 *
 * The service under test is the production one; only the stores are replaced,
 * and they apply the same tenant boundaries the real ones do. Timestamps are
 * relative to one fixed clock so "stalled for two hours" means exactly that.
 */

export const orgA = "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId;
export const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;

export const STALLED_AFTER_MS = 15 * 60_000;

export function missionControlFixture() {
  const now = new Date();
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  const works: Work[] = [];
  const tasks: Task[] = [];
  const events: Event[] = [];
  const jobs: ExecutionJob[] = [];
  const approvals: ApprovalRequest[] = [];
  const agents: Agent[] = [];
  const knowledge = new InMemoryKnowledgeRepository();

  const eventRecorder = new EventRecorder({
    async create(event) { events.push(event); return event; },
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  });

  const service = new MissionControlService(
    {
      reads: new InMemoryOperationalReadRepository(works, tasks, events),
      works: {
        async findById(id) {
          return structuredClone(works.find((work) => work.id === id) ?? null);
        },
        async update(work) {
          const index = works.findIndex((entry) => entry.id === work.id && entry.organizationId === work.organizationId);
          if (index === -1) throw new Error("Failed to update work: not found");
          works[index] = structuredClone(work);
          return work;
        },
      },
      approvals: {
        async findPendingByOrganization(organizationId) {
          return approvals.filter((approval) => approval.organizationId === organizationId && approval.status === "pending");
        },
      },
      jobs: {
        async findByOrganization(organizationId, limit = 50) {
          return jobs.filter((job) => job.organizationId === organizationId).slice(0, limit);
        },
        async findActiveByWork(workId) {
          return jobs.find((job) => job.workId === workId && (job.status === "queued" || job.status === "running")) ?? null;
        },
      },
      agents: {
        async findByOrganization(organizationId) {
          return agents.filter((agent) => agent.organizationId === organizationId);
        },
      },
      memories: knowledge,
      links: knowledge,
      eventRecorder,
    },
    { now: () => now, stalledAfterMs: STALLED_AFTER_MS },
  );

  function agent(name: string, overrides: Partial<Agent> = {}): Agent {
    const created: Agent = {
      id: crypto.randomUUID() as AgentId,
      organizationId: orgA,
      name,
      description: "",
      type: "specialist",
      status: "active",
      capabilities: [],
      toolIds: [],
      createdAt: ago(10_000),
      updatedAt: ago(10_000),
      metadata: {},
      ...overrides,
    };
    agents.push(created);
    return created;
  }

  function work(objective: string, overrides: Partial<Work> = {}): Work {
    const created: Work = {
      id: crypto.randomUUID() as WorkId,
      organizationId: orgA,
      requesterId: "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09" as Work["requesterId"],
      objective,
      status: "queued",
      priority: "normal",
      createdAt: ago(5),
      updatedAt: ago(1),
      metadata: {},
      ...overrides,
    };
    works.push(created);
    return created;
  }

  function task(owner: Work, title: string, overrides: Partial<Task> = {}): Task {
    const created: Task = {
      id: crypto.randomUUID() as TaskId,
      workId: owner.id,
      title,
      description: "",
      status: "pending",
      dependsOn: [],
      createdAt: owner.createdAt,
      updatedAt: owner.updatedAt,
      metadata: {},
      ...overrides,
    };
    tasks.push(created);
    return created;
  }

  function job(owner: Work, overrides: Partial<ExecutionJob> = {}): ExecutionJob {
    const created: ExecutionJob = {
      id: crypto.randomUUID() as ExecutionJobId,
      organizationId: owner.organizationId,
      workId: owner.id,
      status: "queued",
      reason: "requested",
      attempts: 0,
      maxAttempts: 3,
      runAt: owner.updatedAt,
      createdAt: owner.updatedAt,
      updatedAt: owner.updatedAt,
      metadata: {},
      ...overrides,
    };
    jobs.push(created);
    return created;
  }

  function approval(owner: Work, step: Task, overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
    const created: ApprovalRequest = {
      id: crypto.randomUUID() as ApprovalId,
      organizationId: owner.organizationId,
      workId: owner.id,
      taskId: step.id,
      action: step.title,
      resource: `task:${step.id}`,
      reason: "A person must sign this off.",
      status: "pending",
      createdAt: owner.updatedAt,
      metadata: {},
      ...overrides,
    };
    approvals.push(created);
    return created;
  }

  function event(overrides: Partial<Event> & Pick<Event, "type">): Event {
    const created: Event = {
      id: crypto.randomUUID() as EventId,
      organizationId: orgA,
      actorType: "system",
      timestamp: ago(1),
      payload: {},
      metadata: {},
      ...overrides,
    };
    events.push(created);
    return created;
  }

  async function memory(overrides: Partial<Memory>): Promise<Memory> {
    return knowledge.create({
      id: crypto.randomUUID() as MemoryId,
      organizationId: orgA,
      scope: "company",
      type: "fact",
      status: "active",
      title: "Knowledge",
      content: "Knowledge.",
      sourceType: "user",
      importance: 0.5,
      createdAt: ago(30),
      updatedAt: ago(30),
      metadata: {},
      ...overrides,
    });
  }

  return {
    now,
    ago,
    service,
    knowledge,
    works,
    tasks,
    events,
    jobs,
    approvals,
    agents,
    agent,
    work,
    task,
    job,
    approval,
    event,
    memory,
  };
}
