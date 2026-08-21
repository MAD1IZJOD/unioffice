import type {
  AgentDefinition,
} from "../definitions/agent-definition.js";

import type {
  AgentId,
  TaskId,
  WorkId,
} from "@unioffice/core";

export interface AgentExecutionContext {
  agentId: AgentId;

  taskId: TaskId;

  workId: WorkId;

  input: unknown;

  context: Record<string, unknown>;
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