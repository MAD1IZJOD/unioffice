import type {
  Agent,
  AgentId,
  OrganizationId,
  Skill,
  SkillCategory,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import type { AgentRepository, OperationalReadRepository, WorkspaceRepository } from "@unioffice/database";

import { skillFit } from "@unioffice/skills";

import type { ToolRegistry } from "@unioffice/tools";

import { canActIn, reaches, type Access } from "./access/permissions.js";

/**
 * What the company can actually do right now.
 *
 * A person opening UNIOFFICE for the first time should not have to discover
 * the shape of their own workforce from a mission that stops halfway with
 * "No eligible agent is authorized for the required tool(s): calculator".
 * That sentence was always knowable in advance - every fact behind it sits in
 * the agent rows and the skill catalogue before anyone types an objective.
 *
 * So nothing here decides anything. Readiness is read from the same two
 * places execution reads it from:
 *
 *   skillFit(agent, skill)  the agent holds the skill and already has every
 *                           tool and capability the skill needs
 *   the delegator's floor   the agent is active, and compatible with the
 *                           workspace the work would run in
 *
 * If this file says the company can do something, a real step for it resolves
 * to the named agent under the rules that were already there. If it says the
 * company cannot, a real step would have been refused, and the sentence it
 * carries is the reason it would have been. There is no second algorithm, no
 * heuristic and no optimism: an ability nobody can be given is reported as
 * not ready even when the skill itself is perfectly active.
 */

/** A kind of work, as people talk about it rather than as skills are filed. */
const AREA_NAME: Record<SkillCategory, string> = {
  engineering: "Engineering",
  research: "Research",
  finance: "Finance",
  people: "People",
  communication: "Communication",
  operations: "Operations",
};

/** An agent named to a person: who they are, never how they are configured. */
export interface ReadinessAgent {
  id: AgentId;
  name: string;
}

/**
 * Why an ability is not available, as something a person could act on.
 *
 * The shortfall itself is carried rather than a rendered sentence, so a
 * surface can say it its own way; `reason` on the ability is the sentence for
 * the ones that only want to print it.
 */
export interface ReadinessShortfall {
  /**
   * no_workforce       - nobody works here yet
   * unassigned         - the company knows this, but no agent has been given it
   * agent_unavailable  - the agents holding it are paused or disabled
   * missing_tool       - the agent holding it lacks a tool the work needs
   * missing_capability - the agent holding it lacks a capability the work needs
   */
  kind:
    | "no_workforce"
    | "unassigned"
    | "agent_unavailable"
    | "missing_tool"
    | "missing_capability";

  /** The agent nearest to being able to do it, when there is one. */
  agent?: ReadinessAgent;

  /** Tools that agent would need, named as a person sees them. */
  tools: Array<{ id: string; name: string }>;

  /** Capabilities that agent would need. */
  capabilities: string[];
}

/** One thing the company either can or cannot be asked for. */
export interface ReadinessAbility {
  /** The skill's stable name. Kept so a surface can link to it, not shown. */
  slug: string;
  name: string;
  description: string;
  area: SkillCategory;
  /** Present only for an ability that exists in one workspace alone. */
  workspace?: { id: WorkspaceId; name: string };
  ready: boolean;
  /** Agents that can be given this work right now, under the current rules. */
  agents: ReadinessAgent[];
  /** Every step of this kind waits for a person, by the skill's own rule. */
  needsApproval: boolean;
  /** One sentence: who can do it, or what is missing. */
  reason: string;
  /** What is missing. Absent when the ability is ready. */
  shortfall?: ReadinessShortfall;
  /**
   * Where this person can go to fix it. Absent when they cannot - a member or
   * a viewer is told an owner is needed rather than shown a control that
   * would be refused.
   */
  fix?: { label: string; path: string };
}

export interface ReadinessArea {
  area: SkillCategory;
  name: string;
  ready: ReadinessAbility[];
  blocked: ReadinessAbility[];
}

/**
 * Whether this is a company that has never been given anything to do.
 *
 * Read from the missions themselves rather than from a flag someone has to
 * remember to set: a company that has opened even one mission has been used,
 * and is never walked back through setting itself up. Nothing about this is
 * stored, so it cannot drift out of step with what actually happened.
 */
export interface FirstRun {
  pending: boolean;
  /** This person can prepare an agent themselves. */
  canPrepareWorkforce: boolean;
  /** This person can open the first mission. */
  canStartMission: boolean;
}

export interface CompanyReadiness {
  organizationId: OrganizationId;
  generatedAt: Date;

  /**
   * ready        - everything the company knows how to do can be given to someone
   * partly_ready - some of it can, some of it cannot
   * not_ready    - there is a workforce, but nothing it can be given
   * no_workforce - no active agent works here
   */
  state: "ready" | "partly_ready" | "not_ready" | "no_workforce";

  /** The state as a person reads it, in two lines. */
  headline: string;
  detail: string;

  summary: {
    abilities: number;
    ready: number;
    blocked: number;
    agents: number;
    activeAgents: number;
  };

  areas: ReadinessArea[];

  firstRun: FirstRun;
}

export interface CompanyReadinessDependencies {
  agents: Pick<AgentRepository, "findByOrganization">;
  workspaces: Pick<WorkspaceRepository, "findByOrganization">;
  /** The active skills that apply, resolved narrowest scope first. */
  skills: { effective(organizationId: OrganizationId, workspaceId?: WorkspaceId): Promise<Map<string, Skill>> };
  tools: Pick<ToolRegistry, "get">;
  /** Only to ask whether this company has ever opened a mission. */
  reads: Pick<OperationalReadRepository, "findWorkSummaries">;
  now?: () => Date;
}

export class CompanyReadinessService {
  private readonly now: () => Date;

  constructor(private readonly deps: CompanyReadinessDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async getReadiness(access: Access): Promise<CompanyReadiness> {
    const organizationId = access.organizationId;

    const [allAgents, allWorkspaces, companyWide, missions] = await Promise.all([
      this.deps.agents.findByOrganization(organizationId),
      this.deps.workspaces.findByOrganization(organizationId),
      this.deps.skills.effective(organizationId),
      this.deps.reads.findWorkSummaries(organizationId, 1),
    ]);

    // Someone who reaches only some workspaces sees the company as their
    // access has it: the agents that work where they can see, and the
    // abilities that exist there. Nothing is counted for them that they could
    // not have opened anyway.
    const agents = allAgents.filter(
      (agent) => agent.organizationId === organizationId && reaches(access, agent.workspaceId),
    );
    const workspaces = allWorkspaces.filter(
      (workspace) => workspace.organizationId === organizationId && reaches(access, workspace.id),
    );

    const abilities: ReadinessAbility[] = [];

    // A mission opened without a workspace runs against the company-wide
    // resolution, and every agent is compatible with it. This is the layer
    // that answers "what can my company do" for someone who has not thought
    // about workspaces at all.
    for (const skill of companyWide.values()) {
      abilities.push(this.ability(skill, agents, access));
    }

    // A workspace's own skill exists only there, and only agents that work
    // there or company-wide can be given it - which is exactly the boundary
    // the delegator enforces for a step inside that workspace.
    for (const workspace of workspaces) {
      const resolved = await this.deps.skills.effective(organizationId, workspace.id);

      for (const skill of resolved.values()) {
        if (skill.scope !== "workspace") continue;

        abilities.push(
          this.ability(
            skill,
            agents.filter((agent) => !agent.workspaceId || agent.workspaceId === workspace.id),
            access,
            workspace,
          ),
        );
      }
    }

    return this.compose(organizationId, abilities, agents, missions.length === 0, access);
  }

  /**
   * One ability, decided the way a step for it would be.
   *
   * The candidates handed in have already been narrowed to the workspace the
   * work would run in. What is left is the delegator's other floor - the
   * agent has to be active - and skillFit, which is the same call the skill
   * resolver makes when it decides which agents could take the step.
   */
  private ability(
    skill: Skill,
    candidates: Agent[],
    access: Access,
    workspace?: Workspace,
  ): ReadinessAbility {
    const holders = candidates.filter((agent) => (agent.skills ?? []).includes(skill.slug));
    const active = holders.filter((agent) => agent.status === "active");
    const ready = active.filter((agent) => skillFit(agent, skill).fits);

    const base = {
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      area: skill.category,
      workspace: workspace ? { id: workspace.id, name: workspace.name } : undefined,
      needsApproval: skill.approval === "required",
    };

    if (ready.length > 0) {
      const named = ready.map((agent) => ({ id: agent.id, name: agent.name }));

      return {
        ...base,
        ready: true,
        agents: named,
        reason: readyReason(named, skill.approval === "required"),
      };
    }

    const shortfall = this.shortfall(skill, candidates, holders, active);

    return {
      ...base,
      ready: false,
      agents: [],
      reason: blockedReason(shortfall),
      shortfall,
      fix: fixFor(shortfall, access, workspace?.id),
    };
  }

  /**
   * What is standing in the way, in the order a person would ask about it: is
   * there anyone at all, has anyone been given this, can they work, and only
   * then what they are short of.
   */
  private shortfall(
    skill: Skill,
    candidates: Agent[],
    holders: Agent[],
    active: Agent[],
  ): ReadinessShortfall {
    if (candidates.length === 0) {
      return { kind: "no_workforce", tools: [], capabilities: [] };
    }

    if (holders.length === 0) {
      return { kind: "unassigned", tools: [], capabilities: [] };
    }

    if (active.length === 0) {
      const agent = holders[0]!;
      return { kind: "agent_unavailable", agent: { id: agent.id, name: agent.name }, tools: [], capabilities: [] };
    }

    // The agent nearest to being able to do it, so the remedy named is the
    // smallest one that would actually make the ability available.
    const nearest = active
      .map((agent) => ({ agent, fit: skillFit(agent, skill) }))
      .sort((left, right) =>
        (left.fit.missingTools.length + left.fit.missingCapabilities.length) -
          (right.fit.missingTools.length + right.fit.missingCapabilities.length) ||
        left.agent.name.localeCompare(right.agent.name))[0]!;

    return {
      // A tool is the remedy an owner can grant on the agent; a capability is
      // a change to what the agent is, so the two are worth naming apart.
      kind: nearest.fit.missingTools.length > 0 ? "missing_tool" : "missing_capability",
      agent: { id: nearest.agent.id, name: nearest.agent.name },
      tools: nearest.fit.missingTools.map((toolId) => ({
        id: toolId,
        name: this.deps.tools.get(toolId)?.name ?? toolId,
      })),
      capabilities: [...nearest.fit.missingCapabilities],
    };
  }

  private compose(
    organizationId: OrganizationId,
    abilities: ReadinessAbility[],
    agents: Agent[],
    noMissionsYet: boolean,
    access: Access,
  ): CompanyReadiness {
    const activeAgents = agents.filter((agent) => agent.status === "active").length;
    const ready = abilities.filter((ability) => ability.ready);
    const blocked = abilities.filter((ability) => !ability.ready);

    const state: CompanyReadiness["state"] = activeAgents === 0
      ? "no_workforce"
      : ready.length === 0
        ? "not_ready"
        : blocked.length === 0
          ? "ready"
          : "partly_ready";

    const areas: ReadinessArea[] = [];

    for (const area of Object.keys(AREA_NAME) as SkillCategory[]) {
      const own = abilities.filter((ability) => ability.area === area);
      if (own.length === 0) continue;

      areas.push({
        area,
        name: AREA_NAME[area],
        ready: own.filter((ability) => ability.ready).sort(byName),
        blocked: own.filter((ability) => !ability.ready).sort(byName),
      });
    }

    return {
      organizationId,
      generatedAt: this.now(),
      state,
      headline: HEADLINE[state],
      detail: detailOf(state, ready.length, blocked.length, activeAgents),
      summary: {
        abilities: abilities.length,
        ready: ready.length,
        blocked: blocked.length,
        agents: agents.length,
        activeAgents,
      },
      areas,
      firstRun: {
        pending: noMissionsYet,
        canPrepareWorkforce: canActIn(access, "agents.configure", null),
        canStartMission: canActIn(access, "missions.create", null),
      },
    };
  }
}

const HEADLINE: Record<CompanyReadiness["state"], string> = {
  ready: "Your workforce is ready to work.",
  partly_ready: "Your workforce is ready for most things.",
  not_ready: "Your workforce is not ready yet.",
  no_workforce: "Nobody works here yet.",
};

function readyReason(agents: ReadinessAgent[], needsApproval: boolean): string {
  const who = agents.length === 1
    ? `${agents[0]!.name} can do this.`
    : agents.length === 2
      ? `${agents[0]!.name} and ${agents[1]!.name} can do this.`
      : `${agents[0]!.name} and ${agents.length - 1} others can do this.`;

  return needsApproval ? `${who} Every step of this kind waits for your approval.` : who;
}

function blockedReason(shortfall: ReadinessShortfall): string {
  switch (shortfall.kind) {
    case "no_workforce":
      return "No agent works here yet.";
    case "unassigned":
      return "No agent has been given this yet.";
    case "agent_unavailable":
      return `${shortfall.agent!.name} knows this, but is not working right now.`;
    case "missing_tool":
      return `${shortfall.agent!.name} needs ${list(shortfall.tools.map((tool) => tool.name))}.`;
    case "missing_capability":
      return `${shortfall.agent!.name} needs ${list(shortfall.capabilities.map(readable))}.`;
  }
}

/**
 * Where to go to fix it, offered only to someone who may actually change an
 * agent here. This never changes anything itself and never widens anything:
 * it is a link to the existing agent surface, which authorizes the change
 * again on the server when it is made.
 */
function fixFor(
  shortfall: ReadinessShortfall,
  access: Access,
  workspaceId: WorkspaceId | undefined,
): ReadinessAbility["fix"] {
  if (!canActIn(access, "agents.configure", workspaceId)) return undefined;

  switch (shortfall.kind) {
    case "no_workforce":
      return { label: "Add an agent", path: "/workforce" };
    case "unassigned":
      return { label: "Choose who does this", path: "/workforce" };
    case "agent_unavailable":
    case "missing_tool":
    case "missing_capability":
      return { label: `Prepare ${shortfall.agent!.name}`, path: `/workforce/${shortfall.agent!.id}` };
  }
}

function detailOf(
  state: CompanyReadiness["state"],
  ready: number,
  blocked: number,
  activeAgents: number,
): string {
  switch (state) {
    case "no_workforce":
      return "Nothing can be given to anyone until at least one agent is working here.";
    case "not_ready":
      return `${count(activeAgents, "agent is", "agents are")} working, but nothing the company knows how to do can be given to any of them yet.`;
    case "ready":
      return `${count(ready, "thing", "things")} the company knows how to do, and someone to do every one of them.`;
    default:
      return `${count(ready, "thing", "things")} the company can be asked for now. ${count(blocked, "other needs", "others need")} setting up first.`;
  }
}

function byName(left: ReadinessAbility, right: ReadinessAbility): number {
  return left.name.localeCompare(right.name);
}

/** "the Calculator", "Calculator and Datetime". */
function list(values: string[]): string {
  if (values.length === 0) return "something it does not have";
  if (values.length === 1) return values[0]!;
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/** financial_analysis -> "financial analysis". */
function readable(capability: string): string {
  return capability.replace(/_/g, " ");
}
