export interface ToolDefinition<
  TInput = unknown,
  TOutput = unknown,
> {
  id: string;

  name: string;

  description: string;

  version: string;

  inputSchema: unknown;

  execute(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<TOutput>;
}

export interface ToolExecutionContext {
  organizationId: string;

  agentId?: string;

  workId?: string;

  taskId?: string;

  metadata: Record<string, unknown>;
}