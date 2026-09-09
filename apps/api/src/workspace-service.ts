import {
  createEntityId,
  type Agent,
  type Artifact,
  type Event,
  type Organization,
  type OrganizationId,
  type Work,
  type Workspace,
  type WorkspaceId,
  type WorkspaceStatus,
} from "@unioffice/core";

import type {
  AgentRepository,
  ArtifactRepository,
  EventRepository,
  OrganizationRepository,
  WorkRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import type { EventRecorder } from "./event-recorder.js";

export class WorkspaceValidationError extends Error {}
export class WorkspaceNotFoundError extends Error {}

export interface CreateWorkspaceInput {
  organizationId: OrganizationId;
  name: string;
  description?: string;
}

export interface UpdateWorkspaceInput {
  organizationId: OrganizationId;
  workspaceId: WorkspaceId;
  name?: string;
  description?: string | null;
  status?: WorkspaceStatus;
}

/** A workspace plus the counts the directory needs, without loading detail. */
export interface WorkspaceSummary {
  workspace: Workspace;
  agentCount: number;
  workCount: number;
  activeWorkCount: number;
}

/** Everything one workspace's page renders, in a single round trip. */
export interface WorkspaceDetail {
  workspace: Workspace;
  agents: Agent[];
  work: Work[];
  artifacts: Artifact[];
  activity: Event[];
}

export interface OrganizationOverview {
  organization: Organization;
  workspaces: WorkspaceSummary[];
  /** Agents that belong to the organization but to no workspace. */
  unassignedAgentCount: number;
  agentCount: number;
  workCount: number;
  activeWorkCount: number;
  activity: Event[];
}

/**
 * Workspaces, and the organization they belong to.
 *
 * Every method takes the organization explicitly and refuses to act on a
 * workspace that belongs to a different one. There is no authentication yet,
 * so this is not a security control today - it is the shape that makes one
 * possible later without rewriting every caller. A service that can be handed
 * only a workspace id is a service that cannot be secured.
 */
export class WorkspaceService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly agentRepository: AgentRepository,
    private readonly workRepository: WorkRepository,
    private readonly artifactRepository: ArtifactRepository,
    private readonly eventRepository: EventRepository,
    private readonly eventRecorder: EventRecorder,
  ) {}

  async listWorkspaces(
    organizationId: OrganizationId,
  ): Promise<WorkspaceSummary[]> {
    const [workspaces, agents, work] = await Promise.all([
      this.workspaceRepository.findByOrganization(organizationId),
      this.agentRepository.findByOrganization(organizationId),
      this.workRepository.findByOrganization(organizationId),
    ]);

    // Counted from the organization's own rows rather than one query per
    // workspace: a handful of workspaces would otherwise mean a handful of
    // extra round trips to render one list.
    return workspaces.map((workspace) =>
      summarize(workspace, agents, work),
    );
  }

  async getOrganizationOverview(
    organizationId: OrganizationId,
  ): Promise<OrganizationOverview> {
    const organization =
      await this.organizationRepository.findById(organizationId);

    if (!organization) {
      throw new WorkspaceNotFoundError(
        `Organization not found: ${organizationId}`,
      );
    }

    const [workspaces, agents, work, activity] = await Promise.all([
      this.workspaceRepository.findByOrganization(organizationId),
      this.agentRepository.findByOrganization(organizationId),
      this.workRepository.findByOrganization(organizationId),
      this.eventRepository.findByOrganization(organizationId, 20),
    ]);

    return {
      organization,
      workspaces: workspaces.map((workspace) =>
        summarize(workspace, agents, work),
      ),
      unassignedAgentCount: agents.filter((agent) => !agent.workspaceId).length,
      agentCount: agents.length,
      workCount: work.length,
      activeWorkCount: work.filter(isActive).length,
      activity,
    };
  }

  /** Resolves a workspace and proves it belongs to the given organization. */
  async getWorkspace(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<Workspace> {
    const workspace = await this.workspaceRepository.findById(workspaceId);

    // Deliberately the same error either way. "It exists but is not yours"
    // and "it does not exist" are the same answer to a caller that is not
    // entitled to it, and telling them apart leaks the id space.
    if (!workspace || workspace.organizationId !== organizationId) {
      throw new WorkspaceNotFoundError(
        `Workspace not found: ${workspaceId}`,
      );
    }

    return workspace;
  }

  async getWorkspaceDetail(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceDetail> {
    const workspace = await this.getWorkspace(organizationId, workspaceId);

    const [agents, work] = await Promise.all([
      this.agentRepository.findByWorkspace(organizationId, workspaceId),
      this.workRepository.findByWorkspace(organizationId, workspaceId),
    ]);

    // Artifacts and events carry a work id rather than a workspace id, so a
    // workspace's output is exactly the output of its work. Derived here
    // instead of denormalised onto those tables, which would need a migration
    // and would go stale the moment a work item moved.
    const workIds = new Set(work.map((item) => item.id));

    const [organizationArtifacts, organizationActivity] = await Promise.all([
      this.artifactRepository.findByOrganization(organizationId, 200),
      this.eventRepository.findByOrganization(organizationId, 200),
    ]);

    return {
      workspace,
      agents,
      work,
      artifacts: organizationArtifacts
        .filter((artifact) => artifact.workId && workIds.has(artifact.workId))
        .slice(0, 24),
      activity: organizationActivity
        .filter((event) => event.workId && workIds.has(event.workId))
        .slice(0, 30),
    };
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const name = requiredName(input.name);
    const slug = slugify(name);

    const organization =
      await this.organizationRepository.findById(input.organizationId);

    if (!organization) {
      throw new WorkspaceNotFoundError(
        `Organization not found: ${input.organizationId}`,
      );
    }

    const clash = await this.workspaceRepository.findBySlug(
      input.organizationId,
      slug,
    );

    if (clash) {
      throw new WorkspaceValidationError(
        `A workspace called "${clash.name}" already exists in this organization.`,
      );
    }

    const now = new Date();
    const workspace = await this.workspaceRepository.create({
      id: createEntityId<"WorkspaceId">() as WorkspaceId,
      organizationId: input.organizationId,
      name,
      slug,
      description: optionalDescription(input.description),
      status: "active",
      createdAt: now,
      updatedAt: now,
      metadata: {},
    });

    await this.eventRecorder.record({
      organizationId: workspace.organizationId,
      actorType: "user",
      type: "workspace.created",
      payload: {
        workspaceId: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
    });

    return workspace;
  }

  async updateWorkspace(input: UpdateWorkspaceInput): Promise<Workspace> {
    const current = await this.getWorkspace(
      input.organizationId,
      input.workspaceId,
    );

    const name =
      input.name === undefined ? current.name : requiredName(input.name);
    const slug = name === current.name ? current.slug : slugify(name);

    if (slug !== current.slug) {
      const clash = await this.workspaceRepository.findBySlug(
        input.organizationId,
        slug,
      );

      if (clash && clash.id !== current.id) {
        throw new WorkspaceValidationError(
          `A workspace called "${clash.name}" already exists in this organization.`,
        );
      }
    }

    const updated = await this.workspaceRepository.update({
      ...current,
      name,
      slug,
      description:
        input.description === undefined
          ? current.description
          : optionalDescription(input.description ?? undefined),
      status: input.status ?? current.status,
      updatedAt: new Date(),
    });

    await this.eventRecorder.record({
      organizationId: updated.organizationId,
      actorType: "user",
      type: "workspace.updated",
      payload: {
        workspaceId: updated.id,
        name: updated.name,
        status: updated.status,
      },
    });

    return updated;
  }
}

function summarize(
  workspace: Workspace,
  agents: Agent[],
  work: Work[],
): WorkspaceSummary {
  const workspaceWork = work.filter(
    (item) => item.workspaceId === workspace.id,
  );

  return {
    workspace,
    agentCount: agents.filter((agent) => agent.workspaceId === workspace.id)
      .length,
    workCount: workspaceWork.length,
    activeWorkCount: workspaceWork.filter(isActive).length,
  };
}

function isActive(work: Work): boolean {
  return (
    work.status === "queued" ||
    work.status === "planning" ||
    work.status === "executing" ||
    work.status === "waiting_approval"
  );
}

function requiredName(value: string): string {
  const name = value.trim();

  if (!name) {
    throw new WorkspaceValidationError("A workspace needs a name.");
  }

  if (name.length > 80) {
    throw new WorkspaceValidationError(
      "A workspace name must be 80 characters or fewer.",
    );
  }

  return name;
}

function optionalDescription(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const description = value.trim();

  if (!description) return undefined;

  if (description.length > 500) {
    throw new WorkspaceValidationError(
      "A workspace description must be 500 characters or fewer.",
    );
  }

  return description;
}

/**
 * The slug is derived rather than asked for. It exists to make
 * (organization, slug) unique and to give the workspace a stable handle;
 * asking a person to invent one is a database concern leaking into a form.
 */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");

  if (!slug) {
    throw new WorkspaceValidationError(
      "A workspace name must contain at least one letter or number.",
    );
  }

  return slug;
}
