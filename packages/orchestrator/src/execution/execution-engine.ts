import type {
  AgentId,
  OrganizationId,
  TaskId,
  WorkspaceId,
  WorkId,
} from "@unioffice/core";

import type {
  AgentDefinition,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentRuntime,
  AgentToolCall,
} from "@unioffice/agents";

export interface ExecutionRequest {
  workId: WorkId;

  taskId: TaskId;

  agentId: AgentId;

  agent: AgentDefinition;

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
    dependencies: Array<{
      id: TaskId;
      title: string;
      result?: unknown;
    }>;
  };

  context: Record<string, unknown>;
}

export interface ExecutionEngine {
  execute(
    request: ExecutionRequest,
  ): Promise<ExecutionResult>;
}

export interface ExecutionResult {
  workId: WorkId;

  taskId: TaskId;

  agentId: AgentId;

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

export class DefaultExecutionEngine
  implements ExecutionEngine
{
  constructor(
    private readonly agentRuntime: AgentRuntime,
  ) {}

  async execute(
    request: ExecutionRequest,
  ): Promise<ExecutionResult> {
    const context: AgentExecutionContext = {
      agentId: request.agentId,
      taskId: request.taskId,
      workId: request.workId,
      work: request.work,
      task: request.task,
      context: request.context,
    };

    const result: AgentExecutionResult =
      await this.agentRuntime.execute(
        request.agent,
        context,
      );

    return {
      workId: request.workId,
      taskId: request.taskId,
      agentId: request.agentId,
      status: result.status,
      output: result.output,
      error: result.error,
      toolCalls: result.toolCalls,
      metadata: result.metadata,
    };
  }
}
