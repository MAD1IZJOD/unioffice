import type {
  AgentDefinition,
} from "../definitions/agent-definition.js";

import type {
  SkillField,
  AgentId,
  OrganizationId,
  TaskId,
  WorkspaceId,
  WorkId,
} from "@unioffice/core";

import type {
  RecalledKnowledgeItem,
} from "./knowledge-context.js";

export interface AgentExecutionContext {
  agentId: AgentId;

  taskId: TaskId;

  workId: WorkId;

  work: {
    objective: string;
    organizationId: OrganizationId;
    workspaceId?: WorkspaceId;
    priority: string;
    metadata: Record<string, unknown>;
  };

  task: {
    title: string;
    description: string;
    dependencies: AgentDependencyResult[];
    /** Tool ids delegation determined this specific task needs. */
    requiredTools?: string[];

    /**
     * Tools a person approved this step to use. Filled from the step's
     * recorded approval by the execution path, never from model output, and
     * the only thing that lets an external write run.
     */
    approvedTools?: string[];

    /**
     * The skill this step follows, resolved on the server for the mission's
     * workspace. Its procedure reaches the model as labelled configuration.
     */
    skill?: AgentStepSkill;
  };

  context: Record<string, unknown>;

  /**
   * Company knowledge recalled for this step. Kept out of `context` on
   * purpose: that is operational data serialized as-is, while knowledge is
   * untrusted text that must reach the model only through the delimited,
   * escaped section the runtime builds for it.
   */
  knowledge?: RecalledKnowledgeItem[];
}

export interface AgentStepSkill {
  slug: string;
  name: string;
  version: number;
  instructions: string;
  inputs: SkillField[];
  outputs: SkillField[];
}

export interface AgentDependencyResult {
  id: TaskId;
  title: string;
  result?: unknown;
}

export interface AgentExecutionResult {
  status:
    | "completed"
    | "failed"
    | "waiting";

  output?: unknown;

  error?: {
    code: string;
    message: string;
  };

  toolCalls: AgentToolCall[];

  metadata: Record<string, unknown>;
}

export interface AgentToolCall {
  toolId: string;

  /** Absent for external tools: what was asked of another system is not kept. */
  input: unknown;

  /** Absent for external tools: what another system returned is not kept. */
  output?: unknown;

  /** Set when the tool reaches outside the company. */
  external?: {
    provider: string;
    access: "read" | "write";
  };

  /** The tool's own safe record of a completed call. */
  audit?: {
    action: string;
    summary: string;
    resource?: Record<string, string | number>;
  };

  error?: {
    code: string;
    message: string;
  };

  status:
    | "completed"
    | "failed";

  startedAt: Date;

  completedAt?: Date;
}

export interface AgentRuntime {
  execute(
    definition: AgentDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>;
}
