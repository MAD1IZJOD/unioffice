import type {
  AgentType,
  AgentId,
  TaskId,
  WorkId,
} from "@unioffice/core";

import type {
  RecalledKnowledgeItem,
} from "@unioffice/agents";

export interface PlanningToolDescriptor {
  id: string;

  name: string;

  description: string;
}

/**
 * A skill the planner may name for a step. Only skills held by at least one
 * available agent are offered, so a plan never asks for one nobody can use.
 */
export interface PlanningSkillDescriptor {
  slug: string;

  name: string;

  description: string;

  requiredTools: string[];

  requiredCapabilities: string[];
}

export interface PlanningContext {
  workId: WorkId;

  objective: string;

  availableAgentIds: AgentId[];

  /** Tools that exist in the system, so the planner can request one by id. */
  availableTools?: PlanningToolDescriptor[];

  /**
   * The union of capabilities actually held by the available agents. A
   * capability the planner invents that no agent has is unsatisfiable by
   * construction, so the planner is constrained to this vocabulary rather
   * than free-texting a plausible-sounding one.
   */
  availableCapabilities?: string[];

  /** Skills the available agents hold, resolved for this mission's workspace. */
  availableSkills?: PlanningSkillDescriptor[];

  /**
   * The requester's own briefing: constraints, background, and anything the
   * objective sentence alone leaves out. Optional, and never invented - it is
   * only ever the text a person typed when they opened the mission.
   */
  briefing?: string;

  /**
   * What the company already knows that bears on this objective, recalled
   * before planning so the plan starts from prior decisions and lessons
   * rather than from nothing. Untrusted: it informs the plan and can never
   * dictate it.
   */
  knowledge?: RecalledKnowledgeItem[];

  context: Record<string, unknown>;
}

export interface PlannedTask {
  id: TaskId;

  ref: string;

  title: string;

  description: string;

  assignedAgentId?: AgentId;

  requiredCapabilities?: string[];

  /** Tool ids the executing agent must be authorized for. */
  requiredTools?: string[];

  /**
   * The skill this step follows, by slug. Its tools and capabilities are
   * already folded into requiredTools and requiredCapabilities.
   */
  skill?: string;

  suggestedAgentType?: AgentType;

  requiresApproval?: boolean;

  approvalReason?: string;

  dependsOn: TaskId[];

  metadata: Record<string, unknown>;
}

export interface WorkPlan {
  workId: WorkId;

  objective: string;

  tasks: PlannedTask[];

  metadata: Record<string, unknown>;
}

export interface Planner {
  plan(
    context: PlanningContext,
  ): Promise<WorkPlan>;
}
