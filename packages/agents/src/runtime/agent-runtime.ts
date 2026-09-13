import type {
  AgentDefinition,
} from "../definitions/agent-definition.js";

import type {
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

  input: unknown;

  output?: unknown;

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
