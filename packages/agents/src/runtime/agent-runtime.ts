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
