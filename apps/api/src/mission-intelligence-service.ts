import type {
  Agent,
  AgentId,
  Policy,
  Task,
  TaskStatus,
  Work,
  WorkId,
  WorkPriority,
  WorkStatus,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
  PolicyRepository,
  TaskRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import { effectivePermissions } from "@unioffice/governance";

import { hasTools, isWorkspaceCompatible } from "@unioffice/orchestrator";

import type { ToolRegistry } from "@unioffice/tools";

import { canActIn, type Access } from "./access/permissions.js";
import { buildExecutionPlan, type ExecutionNode } from "./execution-plan.js";
import { clip } from "./mission-reading.js";
import { publicFailureReason } from "./public-failure.js";

/**
 * What UNIOFFICE understood, whether it can do it, and how it means to.
 *
 * A mission used to go straight from a sentence a person typed to a worker
 * running it, and the first thing they learned about how it had been
 * understood was the result. If the understanding was wrong, or the company
 * turned out not to be equipped for it, they found that out a minute or two
 * in, from a failure written for whoever debugs the system.
 *
 * This is the read that closes that gap, and it invents nothing to do it.
 * The mission's own row carries what the person asked for. The planner has
 * already written the steps, the dependencies between them, which agent each
 * one went to and why; those are real task rows, not a simulation, and they
 * are the rows the worker will execute. So:
 *
 *   the brief      is what the person said, beside what the plan says
 *   the preflight  is those same steps re-checked against the company as it
 *                  is right now
 *   the plan       is the task rows, read as a shape instead of a list
 *
 * Nothing here decides anything and nothing here authorizes anything. The
 * preflight is a prediction offered to a person; the delegator, the
 * governance engine and the executor remain the only things that actually
 * decide, and they check again at the moment they act. A preflight that says
 * "ready" is a statement about this instant, not a promise about the next
 * one - which is why starting a mission goes through the ordinary authorized
 * route rather than through anything on this page.
 */

/* --------------------------------------------------------------------------
   The brief
   -------------------------------------------------------------------------- */

/**
 * Where a line in the brief came from. Kept on every derived field, because
 * the one thing a brief must never do is read back a guess as though the
 * person had said it.
 *
 * requested - the person typed it when they opened the mission
 * planned   - it comes from the plan the planner actually wrote
 */
export type BriefSource = "requested" | "planned";

export interface BriefLine {
  text: string;
  source: BriefSource;
}

export interface MissionBrief {
  /** The mission's own name if it has one, else the objective as written. */
  title: string;
  titleSource: BriefSource;

  /** Exactly what the person asked for. Never rewritten. */
  objective: string;

  /** The background they supplied, if they supplied any. */
  briefing?: string;

  priority: WorkPriority;

  workspace?: { id: WorkspaceId; name: string };

  /** What finishing looks like: one line per step the plan actually has. */
  successCriteria: BriefLine[];

  /** The kinds of work this calls for, from the skills the steps follow. */
  workAreas: string[];

  /** Who would take part, and what each is here to do. */
  participants: Array<{ id: AgentId; name: string; role: string }>;

  /**
   * What this mission does not know. Only ever things the system itself
   * recorded - a skill it could not apply, a step that went to the closest
   * available match, knowledge it had none of. Never a guess about what the
   * person forgot to say.
   */
  gaps: string[];
}

/* --------------------------------------------------------------------------
   The preflight
   -------------------------------------------------------------------------- */

export type PreflightState =
  /** Every execution requirement is satisfied right now. */
  | "ready"
  /** It can run, but something may limit how good the outcome is. */
  | "partially_ready"
  /** It cannot proceed until a condition is resolved. */
  | "blocked"
  /** Readiness could not be determined. Never reported as ready. */
  | "unknown";

export type CheckState = "ok" | "warning" | "blocked" | "unknown";

export type CheckId =
  | "workforce"
  | "skills"
  | "capabilities"
  | "tools"
  | "permissions"
  | "governance"
  | "approvals"
  | "inputs"
  | "dependencies";

export interface PreflightCheck {
  id: CheckId;
  name: string;
  state: CheckState;
  /** One line, in a person's words. */
  summary: string;
  /** The steps this concerns, by their number in the plan - never by id. */
  steps: number[];
  /** Where someone who may fix it can go. Absent when they may not. */
  fix?: { label: string; path: string };
}

export interface MissionPreflight {
  state: PreflightState;
  headline: string;
  detail: string;
  checks: PreflightCheck[];
  /**
   * Whether this person may start this mission. Advisory: the start route
   * authorizes again against their membership as it stands at that moment.
   */
  canStart: boolean;
  /** Why they cannot, when they cannot. */
  startNote?: string;
}

/* --------------------------------------------------------------------------
   The plan
   -------------------------------------------------------------------------- */

export interface PlanStep {
  /** Its place in the plan. What a person refers to it by. */
  number: number;
  title: string;
  description: string;
  agent?: { id: AgentId; name: string };
  /** Why this agent holds it, in the words the delegator recorded. */
  why?: string;
  /** The steps it waits for, by number. */
  dependsOn: number[];
  /** Steps sharing a lane can run at the same time. */
  lane: number;
  needsApproval: boolean;
  approvalReason?: string;
  /** The skill it follows, named as work rather than as a slug. */
  ability?: string;
  /** The tools it will use, named as a person sees them. */
  uses: string[];
  status: TaskStatus;
  /** Anything wrong with this step right now. */
  problem?: string;
  /**
   * What the machinery recorded, for the "how this was decided" disclosure.
   * Identifiers and scores live here and nowhere else.
   */
  technical: {
    requiredTools: string[];
    requiredCapabilities: string[];
    skill?: { slug: string; version: number; scope: string };
    selectionReason?: string;
    note?: string;
  };
}

export interface MissionPlanView {
  steps: PlanStep[];
  /** How many steps could run at the same time at the plan's widest. */
  widestLane: number;
  /** The planner wrote dependencies that point in a circle. */
  hasCycle: boolean;
  /** Where the plan comes out: the steps nothing else waits on. */
  expectedOutputs: string[];
  approvalCount: number;
}

/* --------------------------------------------------------------------------
   The whole read
   -------------------------------------------------------------------------- */

export type MissionStage =
  /** Created, nothing planned yet. */
  | "awaiting_plan"
  /** The planner is writing the steps now. */
  | "planning"
  /** Planned and not yet started. This is where the person decides. */
  | "planned"
  /** Planning stopped before it produced anything. */
  | "planning_failed"
  /** Already on its way, or over. Shown for reference, not for deciding. */
  | "under_way";

export interface MissionIntelligence {
  missionId: WorkId;
  generatedAt: Date;
  status: WorkStatus;
  stage: MissionStage;
  brief: MissionBrief;
  preflight: MissionPreflight;
  /** Absent until the planner has written the steps. */
  plan: MissionPlanView | null;
}

export interface MissionIntelligenceDependencies {
  tasks: Pick<TaskRepository, "findByWork">;
  agents: Pick<AgentRepository, "findByOrganization">;
  workspaces: Pick<WorkspaceRepository, "findByOrganization">;
  policies: Pick<PolicyRepository, "findEnforced">;
  tools: Pick<ToolRegistry, "get" | "list">;
  now?: () => Date;
}

export class MissionIntelligenceService {
  private readonly now: () => Date;

  constructor(private readonly deps: MissionIntelligenceDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * The mission read three ways. `work` has already been confirmed as one
   * this caller may see, by the route that read it.
   */
  async getIntelligence(access: Access, work: Work): Promise<MissionIntelligence> {
    const [tasks, allAgents, allWorkspaces, enforced] = await Promise.all([
      this.deps.tasks.findByWork(work.id),
      this.deps.agents.findByOrganization(work.organizationId),
      this.deps.workspaces.findByOrganization(work.organizationId),
      this.deps.policies.findEnforced(work.organizationId),
    ]);

    const agents = new Map(
      allAgents
        .filter((agent) => agent.organizationId === work.organizationId)
        .map((agent) => [agent.id, agent]),
    );
    const workspace = work.workspaceId
      ? allWorkspaces.find((entry) => entry.id === work.workspaceId && entry.organizationId === work.organizationId)
      : undefined;

    const stage = stageOf(work, tasks);
    const read = tasks.length > 0 ? this.planOf(tasks, agents) : null;

    return {
      missionId: work.id,
      generatedAt: this.now(),
      status: work.status,
      stage,
      brief: this.briefOf(work, tasks, agents, workspace, read?.view ?? null),
      preflight: this.preflightOf(access, work, agents, enforced, stage, read),
      plan: read?.view ?? null,
    };
  }

  /* ------------------------------------------------------------------------
     Brief
     ------------------------------------------------------------------------ */

  private briefOf(
    work: Work,
    tasks: Task[],
    agents: Map<AgentId, Agent>,
    workspace: Workspace | undefined,
    plan: MissionPlanView | null,
  ): MissionBrief {
    const missionName = typeof work.metadata?.missionName === "string" ? work.metadata.missionName : undefined;
    const briefing = typeof work.metadata?.briefing === "string" ? work.metadata.briefing : undefined;

    // Every step is a thing that has to be true at the end, so the plan's own
    // steps are the success criteria. Nothing is written for them.
    const successCriteria: BriefLine[] = (plan?.steps ?? []).map((step) => ({
      text: step.title,
      source: "planned" as const,
    }));

    const workAreas = [...new Set(
      (plan?.steps ?? []).flatMap((step) => (step.ability ? [step.ability] : [])),
    )];

    // Who would take part, and the one thing each of them is here for. An
    // agent on several steps is named once, by the first of them.
    const participants: MissionBrief["participants"] = [];
    for (const step of plan?.steps ?? []) {
      if (!step.agent || participants.some((entry) => entry.id === step.agent!.id)) continue;
      participants.push({
        id: step.agent.id,
        name: step.agent.name,
        role: step.ability ?? clip(step.title, 80),
      });
    }

    return {
      title: missionName ?? clip(work.objective, 120),
      titleSource: "requested",
      objective: work.objective,
      briefing,
      priority: work.priority,
      workspace: workspace ? { id: workspace.id, name: workspace.name } : undefined,
      successCriteria,
      workAreas,
      participants,
      gaps: this.gapsOf(work, tasks, agents),
    };
  }

  /**
   * What the mission does not know, taken only from what the system itself
   * wrote down while planning. A skill it could not apply, a step that went
   * to the nearest match rather than an exact one, and whether the company
   * knew anything about this already - each of those is a recorded fact, and
   * each one genuinely bears on how good the answer will be.
   */
  private gapsOf(work: Work, tasks: Task[], agents: Map<AgentId, Agent>): string[] {
    const gaps: string[] = [];

    for (const task of tasks) {
      const routing = routingOf(task);
      if (typeof routing?.skillNote === "string" && routing.skillNote.length > 0) {
        gaps.push(clip(routing.skillNote, 240));
      }

      const delegation = delegationOf(task);
      const unmatched = Array.isArray(delegation?.unmatchedCapabilities)
        ? delegation.unmatchedCapabilities.filter((value): value is string => typeof value === "string")
        : [];

      if (unmatched.length > 0) {
        const name = task.assignedAgentId ? agents.get(task.assignedAgentId)?.name : undefined;
        gaps.push(
          `${name ?? "The agent"} is the closest match for ${quoted(clip(task.title, 80))} but does not have ${readableList(unmatched.map(readable))}.`,
        );
      }
    }

    const planMeta = work.metadata?.plan as { knowledge?: unknown } | undefined;
    if (tasks.length > 0 && (planMeta === undefined || planMeta.knowledge === undefined)) {
      gaps.push("The company had nothing recorded about this yet, so the work starts from the request alone.");
    }

    return [...new Set(gaps)].slice(0, 6);
  }

  /* ------------------------------------------------------------------------
     Preflight
     ------------------------------------------------------------------------ */

  /**
   * Whether this particular mission can run, now.
   *
   * Company readiness asks what the workforce can be given in general. This
   * asks a narrower and harder question: these steps, these agents, these
   * tools, this workspace, this instant. The answer is worked out by putting
   * each planned step back through the boundaries that will actually decide
   * it - the delegator's own workspace and tool-authorization functions, the
   * same skill fit the resolver uses, and the governance projection - so a
   * step reported as runnable is one that would really be routed.
   */
  private preflightOf(
    access: Access,
    work: Work,
    agents: Map<AgentId, Agent>,
    enforced: Policy[],
    stage: MissionStage,
    read: PlanReading | null,
  ): MissionPreflight {
    const canStart = canActIn(access, "missions.operate", work.workspaceId);
    const canConfigure = canActIn(access, "agents.configure", work.workspaceId);
    const startNote = canStart
      ? undefined
      : "Your role can follow this mission but not start it. An owner, an admin or a member can.";

    if (stage === "planning") {
      return {
        state: "unknown",
        headline: "Still being prepared.",
        detail: "UNIOFFICE is working out the steps. Readiness can only be checked once the plan exists.",
        checks: [],
        canStart: false,
        startNote,
      };
    }

    if (stage === "planning_failed") {
      const reason = publicFailureReason(
        typeof work.metadata?.planningError === "string" ? work.metadata.planningError : undefined,
      );

      return {
        state: "unknown",
        headline: "This mission could not be prepared.",
        detail: reason ?? "Preparing the mission stopped before it produced any steps.",
        checks: [],
        canStart: false,
        startNote,
      };
    }

    if (!read || read.view.steps.length === 0) {
      return {
        state: "unknown",
        headline: "Nothing to check yet.",
        detail: "This mission has no steps, so there is nothing to check it against.",
        checks: [],
        canStart: false,
        startNote,
      };
    }

    const plan = read.view;
    const registered = this.deps.tools.list().map((tool) => ({ id: tool.id, risk: tool.risk ?? "low" as const }));

    // Each finding is worked out from the step's own task row, paired with it
    // when the plan was read - never looked up again by title, which two
    // steps can share.
    const findings = read.entries.map((entry) =>
      this.inspect(entry, agents, work.workspaceId, enforced, registered));

    const checks: PreflightCheck[] = [];
    const add = (
      id: CheckId,
      name: string,
      state: CheckState,
      summary: string,
      steps: number[],
      fix?: PreflightCheck["fix"],
    ) => {
      checks.push({ id, name, state, summary, steps, fix: canConfigure ? fix : undefined });
    };

    const stepsWhere = (pick: (finding: StepFinding) => boolean) =>
      findings.filter(pick).map((finding) => finding.number);

    /* Workforce -------------------------------------------------------- */
    const unstaffed = findings.filter((finding) => finding.workforce !== undefined);
    if (unstaffed.length === 0) {
      add("workforce", "Workforce", "ok", `${countOf(plan.steps.length, "step")} assigned to an available agent.`, []);
    } else {
      add(
        "workforce",
        "Workforce",
        "blocked",
        unstaffed[0]!.workforce!,
        unstaffed.map((finding) => finding.number),
        { label: "The workforce", path: "/workforce" },
      );
    }

    /* Tools ------------------------------------------------------------- */
    const toolShort = findings.filter((finding) => finding.missingTools.length > 0);
    const toolsUsed = [...new Set(findings.flatMap((finding) => finding.toolNames))];
    if (toolShort.length === 0) {
      add(
        "tools",
        "Tools",
        "ok",
        toolsUsed.length === 0
          ? "No step needs a tool."
          : `${readableList(toolsUsed)} ${toolsUsed.length === 1 ? "is" : "are"} available to the agents that need ${toolsUsed.length === 1 ? "it" : "them"}.`,
        [],
      );
    } else {
      const worst = toolShort[0]!;
      add(
        "tools",
        "Tools",
        "blocked",
        `${worst.agentName ?? "The assigned agent"} is not authorized for ${readableList(worst.missingTools)}.`,
        toolShort.map((finding) => finding.number),
        worst.agentId ? { label: `Prepare ${worst.agentName}`, path: `/workforce/${worst.agentId}` } : { label: "The workforce", path: "/workforce" },
      );
    }

    /* Capabilities ------------------------------------------------------ */
    const capabilityShort = findings.filter((finding) => finding.missingCapabilities.length > 0);
    if (capabilityShort.length === 0) {
      add("capabilities", "Capabilities", "ok", "Every step's agent has what the work calls for.", []);
    } else {
      const worst = capabilityShort[0]!;
      add(
        "capabilities",
        "Capabilities",
        "blocked",
        `${worst.agentName ?? "The assigned agent"} no longer has ${readableList(worst.missingCapabilities.map(readable))}.`,
        capabilityShort.map((finding) => finding.number),
        worst.agentId ? { label: `Prepare ${worst.agentName}`, path: `/workforce/${worst.agentId}` } : undefined,
      );
    }

    /* Skills ------------------------------------------------------------ */
    const skillShort = findings.filter((finding) => finding.skillProblem !== undefined);
    const abilities = [...new Set(plan.steps.flatMap((step) => (step.ability ? [step.ability] : [])))];
    if (skillShort.length === 0) {
      add(
        "skills",
        "Skills",
        "ok",
        abilities.length === 0
          ? "No step depends on a particular way of working."
          : `${readableList(abilities)} ${abilities.length === 1 ? "is" : "are"} still held by the agent that was given ${abilities.length === 1 ? "it" : "them"}.`,
        [],
      );
    } else {
      add(
        "skills",
        "Skills",
        "blocked",
        skillShort[0]!.skillProblem!,
        skillShort.map((finding) => finding.number),
        skillShort[0]!.agentId ? { label: `Prepare ${skillShort[0]!.agentName}`, path: `/workforce/${skillShort[0]!.agentId}` } : undefined,
      );
    }

    /* Governance -------------------------------------------------------- */
    const denied = findings.filter((finding) => finding.deniedTools.length > 0);
    const gated = findings.filter((finding) => finding.gatedTools.length > 0);
    if (denied.length > 0) {
      add(
        "governance",
        "Rules",
        "blocked",
        `A company rule refuses ${readableList(denied[0]!.deniedTools)} for ${denied[0]!.agentName ?? "the assigned agent"}.`,
        denied.map((finding) => finding.number),
        { label: "Company rules", path: "/governance" },
      );
    } else if (gated.length > 0) {
      add(
        "governance",
        "Rules",
        "ok",
        `A company rule puts you in front of ${readableList(gated[0]!.gatedTools)}.`,
        gated.map((finding) => finding.number),
      );
    } else {
      add("governance", "Rules", "ok", "No company rule stands in the way of this mission.", []);
    }

    /* Approvals --------------------------------------------------------- */
    const needsApproval = stepsWhere((finding) => finding.needsApproval);
    add(
      "approvals",
      "Approvals",
      "ok",
      needsApproval.length === 0
        ? "No step will stop to ask you."
        : `${countOf(needsApproval.length, "step")} will wait for your approval.`,
      needsApproval,
    );

    /* Permissions ------------------------------------------------------- */
    add(
      "permissions",
      "Permissions",
      canStart ? "ok" : "warning",
      canStart
        ? "You can start and run this mission."
        : "Your role can follow this mission but not start it.",
      [],
    );

    /* Dependencies ------------------------------------------------------ */
    add(
      "dependencies",
      "Order of work",
      plan.hasCycle ? "blocked" : "ok",
      plan.hasCycle
        ? "The steps depend on each other in a circle, so some of them could never begin."
        : plan.widestLane > 1
          ? `${countOf(plan.steps.length, "step")}, up to ${plan.widestLane} of them at once.`
          : `${countOf(plan.steps.length, "step")}, one after another.`,
      [],
    );

    /* What may limit the result ------------------------------------------ */
    //
    // Named for what it is rather than for where it came from. A step the
    // server could not put a skill on, or one that went to the nearest match,
    // does not stop the mission - it changes how complete the answer will be,
    // and that is the one thing a person deciding wants to be told.
    const limits = findings.filter((finding) => finding.limitation !== undefined);
    if (limits.length > 0) {
      add(
        "inputs",
        "What may limit this",
        "warning",
        limits[0]!.limitation!,
        limits.map((finding) => finding.number),
      );
    }

    const blocked = checks.filter((check) => check.state === "blocked");
    const warnings = checks.filter((check) => check.state === "warning");

    const state: PreflightState = blocked.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "partially_ready"
        : "ready";

    return {
      state,
      headline: HEADLINE[state],
      detail: this.detailOf(state, blocked, warnings, needsApproval.length),
      checks,
      canStart: canStart && state !== "blocked",
      startNote: canStart
        ? state === "blocked"
          ? "Resolve what is blocking it and this mission can run."
          : undefined
        : startNote,
    };
  }

  /**
   * One planned step, put back through the boundaries that will decide it.
   *
   * The tool and workspace checks are the delegator's own functions rather
   * than a copy of its rules, so the two cannot drift apart: if this says a
   * step would be routed, the delegator routing it is the same code saying
   * the same thing.
   */
  private inspect(
    entry: PlanEntry,
    agents: Map<AgentId, Agent>,
    workspaceId: WorkspaceId | undefined,
    enforced: Policy[],
    registered: Array<{ id: string; risk: Policy["risk"] }>,
  ): StepFinding {
    const { step, task } = entry;
    const routing = routingOf(task);
    const requiredTools = stringsOf(routing?.requiredTools);
    const requiredCapabilities = stringsOf(routing?.requiredCapabilities);
    const skill = routing?.skill as { slug?: unknown; name?: unknown } | undefined;

    const finding: StepFinding = {
      number: step.number,
      agentId: step.agent?.id,
      agentName: step.agent?.name,
      missingTools: [],
      missingCapabilities: [],
      deniedTools: [],
      gatedTools: [],
      toolNames: requiredTools.map((toolId) => this.toolName(toolId)),
      needsApproval: step.needsApproval,
      limitation: typeof routing?.skillNote === "string" && routing.skillNote.length > 0
        ? clip(routing.skillNote, 240)
        : undefined,
    };

    const agent = step.agent ? agents.get(step.agent.id) : undefined;

    if (!agent) {
      finding.workforce = `${step.agent?.name ?? "The agent"} assigned to step ${step.number} no longer works here.`;
      return finding;
    }

    if (agent.status !== "active") {
      finding.workforce = `${agent.name} is ${agent.status === "paused" ? "paused" : "not available"}, so step ${step.number} has nobody to run it.`;
      return finding;
    }

    if (!isWorkspaceCompatible(agent, workspaceId)) {
      finding.workforce = `${agent.name} does not work where this mission runs, so step ${step.number} has nobody to run it.`;
      return finding;
    }

    if (!hasTools(agent, requiredTools)) {
      const held = new Set(agent.toolIds);
      finding.missingTools = requiredTools
        .filter((toolId) => !held.has(toolId))
        .map((toolId) => this.toolName(toolId));
    }

    finding.missingCapabilities = requiredCapabilities.filter(
      (capability) => !agent.capabilities.some((held) => held.toLocaleLowerCase() === capability.toLocaleLowerCase()),
    );

    // An assignment that was valid when the plan was written can stop being
    // valid: the skill can be taken off the agent afterwards. The step still
    // names it, so it is worth saying rather than discovering mid-run.
    if (typeof skill?.slug === "string" && !(agent.skills ?? []).includes(skill.slug)) {
      const name = typeof skill.name === "string" ? skill.name : skill.slug;
      finding.skillProblem = `${agent.name} no longer holds ${name}, which step ${step.number} was planned around.`;
    }

    // Governance as the Governance Center projects it. Not an enforcement
    // point and never treated as one - the engine decides at the call.
    if (requiredTools.length > 0) {
      const permissions = effectivePermissions({
        grantedToolIds: agent.toolIds,
        capabilities: agent.capabilities,
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        tools: registered,
        policies: enforced,
      });

      for (const toolId of requiredTools) {
        const permission = permissions.find((entry) => entry.toolId === toolId);
        if (permission?.access === "denied") finding.deniedTools.push(this.toolName(toolId));
        if (permission?.access === "requires_approval") finding.gatedTools.push(this.toolName(toolId));
      }
    }

    return finding;
  }

  private toolName(toolId: string): string {
    return this.deps.tools.get(toolId)?.name ?? toolId;
  }

  private detailOf(
    state: PreflightState,
    blocked: PreflightCheck[],
    warnings: PreflightCheck[],
    approvals: number,
  ): string {
    switch (state) {
      case "blocked":
        return blocked[0]!.summary;
      case "partially_ready":
        return `${warnings[0]!.summary} It can still run, but the result may be less complete than it would otherwise be.`;
      default:
        return approvals > 0
          ? `Everything this mission needs is in place. ${countOf(approvals, "step")} will stop to ask you.`
          : "Everything this mission needs is in place.";
    }
  }

  /* ------------------------------------------------------------------------
     Plan
     ------------------------------------------------------------------------ */

  /**
   * The task rows as a plan a person can read.
   *
   * Built on the same buildExecutionPlan the room uses, so the order, the
   * lanes and the dependencies are one answer rather than two. What is added
   * here is only naming: an agent instead of an id, a skill's name instead of
   * its slug, a tool's name instead of its key. Everything with an identifier
   * in it goes under `technical`, where a person can open it if they want it.
   */
  private planOf(tasks: Task[], agents: Map<AgentId, Agent>): PlanReading {
    const plan = buildExecutionPlan(tasks);
    const ordered = [...plan.nodes].sort(byPlanOrder);
    const numberOf = new Map(ordered.map((node, index) => [node.taskId, index + 1]));
    const tasksById = new Map(tasks.map((task) => [task.id, task]));

    const entries: PlanEntry[] = ordered.map((node, index) => ({
      step: this.stepOf(node, index + 1, numberOf, tasksById.get(node.taskId), agents),
      task: tasksById.get(node.taskId),
    }));

    const steps = entries.map((entry) => entry.step);

    return {
      entries,
      view: {
        steps,
        widestLane: plan.widestLane,
        hasCycle: plan.hasCycle,
        // Where the plan comes out: the steps nothing else is waiting on.
        expectedOutputs: plan.terminalTaskIds
          .map((taskId) => tasksById.get(taskId)?.title)
          .filter((title): title is string => typeof title === "string")
          .map((title) => clip(title, 120)),
        approvalCount: steps.filter((step) => step.needsApproval).length,
      },
    };
  }

  private stepOf(
    node: ExecutionNode,
    number: number,
    numberOf: Map<string, number>,
    task: Task | undefined,
    agents: Map<AgentId, Agent>,
  ): PlanStep {
    const agent = node.assignedAgentId ? agents.get(node.assignedAgentId) : undefined;
    const delegation = delegationOf(task);
    const approval = task?.metadata?.approval as { reason?: unknown } | undefined;

    return {
      number,
      title: clip(node.title, 160),
      description: clip(node.description, 400),
      agent: agent ? { id: agent.id, name: agent.name } : undefined,
      why: typeof delegation?.selectionReason === "string"
        ? humanize(delegation.selectionReason, agent?.name, node.requiredTools.map((toolId) => this.toolName(toolId)))
        : undefined,
      dependsOn: node.dependsOn.flatMap((taskId) => {
        const dependency = numberOf.get(taskId);
        return dependency === undefined ? [] : [dependency];
      }),
      lane: node.depth + 1,
      needsApproval: node.awaitingApproval || Boolean((task?.metadata?.approval as { required?: unknown } | undefined)?.required),
      approvalReason: typeof approval?.reason === "string" ? clip(approval.reason, 240) : undefined,
      ability: node.skill?.name,
      uses: node.requiredTools.map((toolId) => this.toolName(toolId)),
      status: node.status,
      problem: node.skillNote ? clip(node.skillNote, 240) : undefined,
      technical: {
        requiredTools: [...node.requiredTools],
        requiredCapabilities: [...node.requiredCapabilities],
        skill: node.skill
          ? { slug: node.skill.slug, version: node.skill.version, scope: node.skill.scope }
          : undefined,
        selectionReason: typeof delegation?.selectionReason === "string" ? delegation.selectionReason : undefined,
        note: node.skillNote,
      },
    };
  }
}

/* --------------------------------------------------------------------------
   Reading the rows
   -------------------------------------------------------------------------- */

/** A step beside the task row it was read from, so neither is looked up twice. */
interface PlanEntry {
  step: PlanStep;
  task: Task | undefined;
}

interface PlanReading {
  entries: PlanEntry[];
  view: MissionPlanView;
}

interface StepFinding {
  number: number;
  agentId?: AgentId;
  agentName?: string;
  /** Nobody can run this step at all. */
  workforce?: string;
  missingTools: string[];
  missingCapabilities: string[];
  deniedTools: string[];
  gatedTools: string[];
  toolNames: string[];
  skillProblem?: string;
  needsApproval: boolean;
  /** Something that limits the answer without stopping the work. */
  limitation?: string;
}

const HEADLINE: Record<PreflightState, string> = {
  ready: "Ready to start.",
  partially_ready: "Ready, with one thing worth knowing.",
  blocked: "This mission cannot start yet.",
  unknown: "Readiness could not be checked.",
};

function stageOf(work: Work, tasks: Task[]): MissionStage {
  if (work.status === "planning") return "planning";

  if (tasks.length === 0) {
    return typeof work.metadata?.planningError === "string" ? "planning_failed" : "awaiting_plan";
  }

  return work.status === "queued" ? "planned" : "under_way";
}

/**
 * The plan's reading order: by how far from the start a step is, then by when
 * it was written. The same order the room lays its lanes out in.
 */
function byPlanOrder(left: ExecutionNode, right: ExecutionNode): number {
  return left.depth - right.depth;
}

function routingOf(task: Task | undefined): Record<string, unknown> | undefined {
  const routing = task?.metadata?.routing;
  return typeof routing === "object" && routing !== null ? routing as Record<string, unknown> : undefined;
}

function delegationOf(task: Task | undefined): Record<string, unknown> | undefined {
  const delegation = task?.metadata?.delegation;
  return typeof delegation === "object" && delegation !== null ? delegation as Record<string, unknown> : undefined;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * The delegator's reason, said the way a person would say it.
 *
 * What it records is written for the record - "Selected by deterministic
 * rank: exact workspace compatibility, 2 required capability matches..." -
 * which is the right thing to keep and the wrong thing to show. The facts
 * underneath are simple, so the sentence is rebuilt from them rather than
 * printed. When the reason is not one of the shapes the delegator writes,
 * nothing is shown at all: a wrong explanation is worse than none.
 */
function humanize(reason: string, agentName: string | undefined, toolNames: string[]): string | undefined {
  const who = agentName ?? "This agent";

  if (reason.startsWith("The planner explicitly assigned")) {
    return `${who} was named for this step.`;
  }

  if (!reason.startsWith("Selected by deterministic rank")) return undefined;

  const exact = reason.includes("It satisfies every required capability");
  const closest = reason.includes("It is the closest available match");

  const ability = exact
    ? `${who} can do what this step calls for`
    : closest
      ? `${who} is the closest match for this step`
      : `${who} was chosen for this step`;

  return toolNames.length > 0
    ? `${ability} and is cleared to use ${readableList(toolNames)}.`
    : `${ability}.`;
}

function quoted(value: string): string {
  return `“${value}”`;
}

function countOf(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

/** "Calculator", "Calculator and Date/Time", "A, B and C". */
function readableList(values: string[]): string {
  if (values.length === 0) return "it";
  if (values.length === 1) return values[0]!;
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

/** financial_analysis -> "financial analysis". */
function readable(value: string): string {
  return value.replace(/_/g, " ");
}
