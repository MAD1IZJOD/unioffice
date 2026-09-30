import type {
  Agent,
  AgentId,
  Artifact,
  OrganizationId,
  Task,
  WorkId,
  WorkStatus,
  WorkspaceId,
} from "@unioffice/core";

import type {
  ArtifactRepository,
  OperationalReadRepository,
  TaskRepository,
  WorkSummary,
  WorkspaceRepository,
} from "@unioffice/database";

import { clip } from "./mission-reading.js";
import { readHandoffs, type Handoff } from "./mission-narrative-service.js";
import type {
  Reach,
  Workforce,
  WorkforceMember,
  WorkforceService,
} from "./workforce-service.js";

/**
 * The company as a place: who sits where, what each of them is doing, and
 * where work is changing hands right now.
 *
 * The World page draws an office, and an office invites invention - people
 * wandering over to chat, a busy hum that means nothing. So this read is
 * deliberately nothing but facts other reads already establish:
 *
 *   rooms      the workspaces the caller can reach, and a hall for the
 *              agents who work in every workspace. A room with nobody in it
 *              is returned empty rather than filled.
 *   agents     the workforce read, as it is: presence, the step they are on,
 *              what they last finished. Each is given a seat by a stable
 *              order, so a reload puts everybody back where they were.
 *   missions   the live missions the caller may open, with who holds them.
 *   handoffs   where one agent's finished step has become another's input,
 *              read exactly as the execution room reads them, naming the
 *              result that changed hands when the step stored one.
 *
 * It records nothing and decides nothing. Movement on the page is the page
 * comparing two of these; this says only where things stand.
 *
 * What the caller cannot see is left out, never greyed out: an agent in a
 * workspace they were not given is not in the snapshot, a mission they
 * cannot open is not named, and a handoff between agents or in a mission
 * they cannot see does not appear. An agent busy on such a mission is shown
 * as working, without saying on what - the workforce read's own rule.
 */

export interface WorldRoom {
  /** A workspace's id, or "hall". */
  id: string;
  kind: "workspace" | "hall";
  name: string;
  /** The workspace's slug; its mark is drawn from it. */
  slug?: string;
  /** Who sits here, in seat order. */
  agentIds: AgentId[];
}

export interface WorldAgent {
  id: AgentId;
  name: string;
  /** The job, as the company names it. Absent when none was given. */
  role?: string;
  type: Agent["type"];
  status: Agent["status"];
  presence: WorkforceMember["presence"];
  capabilities: string[];
  roomId: string;
  /** Their place in the room, from a stable order. Never random. */
  seat: number;
  current?: WorkforceMember["current"];
  workingElsewhere: boolean;
  upcomingSteps: number;
  lastOutcome?: WorkforceMember["lastOutcome"];
  /**
   * The orchestrator writing a plan: which mission, when the caller may open
   * it. The room names the same agent as the one writing the plan.
   */
  planning?: { missionId: WorkId; missionName: string };
  /** Writing a plan for a mission the caller cannot open. */
  planningElsewhere: boolean;
}

export interface WorldMission {
  id: WorkId;
  name: string;
  status: WorkStatus;
  workspaceId?: WorkspaceId;
  /** Agents holding its steps, as far as the caller can see them. */
  agentIds: AgentId[];
  steps: number;
  completedSteps: number;
}

export interface WorldHandoff extends Handoff {
  missionId: WorkId;
  missionName: string;
}

export interface WorldSnapshot {
  organizationId: OrganizationId;
  generatedAt: Date;
  rooms: WorldRoom[];
  agents: WorldAgent[];
  missions: WorldMission[];
  handoffs: WorldHandoff[];
}

export interface WorldDependencies {
  workforce: Pick<WorkforceService, "getWorkforce">;
  reads: Pick<OperationalReadRepository, "findWorkSummaries">;
  tasks: Pick<TaskRepository, "findByWork">;
  workspaces: Pick<WorkspaceRepository, "findByOrganization">;
  /**
   * The results the live missions' steps stored, so a handoff can name the
   * one that changed hands and the page can open it. Only its id and name
   * are passed on. Optional: without it a handoff says only which step fed
   * which.
   */
  artifacts?: Pick<ArtifactRepository, "findByWork">;
  now?: () => Date;
}

export const HALL_ID = "hall";

/** Missions read to find the live ones. The workforce reads the same window. */
const MISSION_WINDOW = 100;

/**
 * The most live missions whose steps are read. Each is one read of its task
 * rows, and a company with more than this many missions running at once is
 * shown the most recently active of them.
 */
const LIVE_MISSIONS = 8;

const LIVE: ReadonlySet<WorkStatus> = new Set(["planning", "queued", "executing", "waiting_approval"]);

export class WorldService {
  private readonly now: () => Date;

  constructor(private readonly deps: WorldDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async getWorld(organizationId: OrganizationId, options: { reach?: Reach } = {}): Promise<WorldSnapshot> {
    const { reach } = options;
    const sees = (workspaceId: WorkspaceId | undefined) => !reach || reach(workspaceId);

    const [workforce, works, workspaces] = await Promise.all([
      this.deps.workforce.getWorkforce(organizationId, { reach }),
      this.deps.reads.findWorkSummaries(organizationId, MISSION_WINDOW),
      this.deps.workspaces.findByOrganization(organizationId),
    ]);

    const live = works.filter((work) => work.organizationId === organizationId && LIVE.has(work.status));
    const visibleLive = live.filter((work) => sees(work.workspaceId));
    const read = visibleLive.slice(0, LIVE_MISSIONS);

    const [stepsByMission, resultsByMission] = await Promise.all([
      Promise.all(read.map(async (work) => [work.id, await this.deps.tasks.findByWork(work.id)] as const))
        .then((entries) => new Map<WorkId, Task[]>(entries)),
      Promise.all(read.map(async (work) => [work.id, await this.resultsOf(organizationId, work.id)] as const))
        .then((entries) => new Map<WorkId, Artifact[]>(entries)),
    ]);

    const members = workforce.members;
    const visibleAgents = new Set(members.map((member) => member.id));
    const names = members.map((member) => ({ id: member.id, name: member.name }));

    const rooms = roomsOf(workspaces.filter((workspace) =>
      workspace.organizationId === organizationId && workspace.status === "active" && sees(workspace.id)), members);

    const orchestrator = members.find((member) => member.type === "orchestrator");
    const planningVisible = visibleLive.find((work) => work.status === "planning");
    const planningAnywhere = live.some((work) => work.status === "planning");

    const agents: WorldAgent[] = rooms.flatMap((room) =>
      room.agentIds.map((agentId, seat) => {
        const member = members.find((entry) => entry.id === agentId)!;
        const plans = member.id === orchestrator?.id;

        return {
          id: member.id,
          name: member.name,
          ...(member.role ? { role: member.role } : {}),
          type: member.type,
          status: member.status,
          presence: member.presence,
          capabilities: member.capabilities,
          roomId: room.id,
          seat,
          current: member.current,
          workingElsewhere: member.workingElsewhere,
          upcomingSteps: member.upcomingSteps,
          lastOutcome: member.lastOutcome,
          planning: plans && planningVisible
            ? { missionId: planningVisible.id, missionName: missionNameOf(planningVisible) }
            : undefined,
          planningElsewhere: plans && !planningVisible && planningAnywhere,
        };
      }));

    const missions: WorldMission[] = read.map((work) => {
      const steps = stepsByMission.get(work.id) ?? [];

      return {
        id: work.id,
        name: missionNameOf(work),
        status: work.status,
        workspaceId: work.workspaceId,
        agentIds: [...new Set(steps.flatMap((step) =>
          step.assignedAgentId && visibleAgents.has(step.assignedAgentId) ? [step.assignedAgentId] : []))],
        steps: steps.length,
        completedSteps: steps.filter((step) => step.status === "completed").length,
      };
    });

    const handoffs: WorldHandoff[] = read.flatMap((work) =>
      readHandoffs(stepsByMission.get(work.id) ?? [], names, resultsByMission.get(work.id) ?? [])
        // Both ends have to be someone the caller can see. The names come only
        // from the visible roster, so an unseen agent never gets this far -
        // this says so rather than relying on it.
        .filter((handoff) => visibleAgents.has(handoff.from.id) && visibleAgents.has(handoff.to.id))
        .map((handoff) => ({ ...handoff, missionId: work.id, missionName: missionNameOf(work) })));

    return {
      organizationId,
      generatedAt: this.now(),
      rooms,
      agents,
      missions,
      handoffs,
    };
  }

  /** A mission's stored results, kept to this organization's own rows. */
  private async resultsOf(organizationId: OrganizationId, workId: WorkId): Promise<Artifact[]> {
    if (!this.deps.artifacts) return [];

    const artifacts = await this.deps.artifacts.findByWork(workId);
    return artifacts.filter((artifact) => artifact.organizationId === organizationId);
  }
}

/**
 * The rooms, in a stable order: the hall first, then each workspace by name.
 * Everyone sits in the room of the workspace they belong to; an agent who
 * works in every workspace sits in the hall.
 */
function roomsOf(
  workspaces: Array<{ id: WorkspaceId; name: string; slug: string }>,
  members: Workforce["members"],
): WorldRoom[] {
  const seated = [...members].sort(bySeat);
  const known = new Set(workspaces.map((workspace) => workspace.id));

  // An agent can belong to a workspace that has since been archived. It still
  // works for the company, so it sits in the hall rather than vanishing.
  const roomOf = (member: WorkforceMember) =>
    member.workspace && known.has(member.workspace.id) ? member.workspace.id : HALL_ID;

  const hall: WorldRoom = {
    id: HALL_ID,
    kind: "hall",
    name: "Company hall",
    agentIds: seated.filter((member) => roomOf(member) === HALL_ID).map((member) => member.id),
  };

  const rooms = [...workspaces]
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .map((workspace): WorldRoom => ({
      id: workspace.id,
      kind: "workspace",
      name: workspace.name,
      slug: workspace.slug,
      agentIds: seated.filter((member) => roomOf(member) === workspace.id).map((member) => member.id),
    }));

  return [hall, ...rooms];
}

/** Whoever plans the work first, then by name, then by id. */
function bySeat(left: WorkforceMember, right: WorkforceMember): number {
  const lead = Number(right.type === "orchestrator") - Number(left.type === "orchestrator");
  return lead || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function missionNameOf(work: WorkSummary): string {
  return clip(work.missionName ?? work.objective, 140);
}
