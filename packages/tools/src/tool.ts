export interface ToolValidationError {
  path: string;

  message: string;
}

export type ToolValidationResult<TInput> =
  | { valid: true; value: TInput }
  | { valid: false; errors: ToolValidationError[] };

export interface ToolDefinition<
  TInput = unknown,
  TOutput = unknown,
> {
  id: string;

  name: string;

  description: string;

  version: string;

  /** Human/model-facing description of the expected input shape. */
  inputSchema: Record<string, unknown>;

  /** Structural validation performed before execute() ever runs. */
  validate(input: unknown): ToolValidationResult<TInput>;

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

  /** Tool ids the calling agent is explicitly authorized to invoke. */
  authorizedToolIds: string[];

  metadata: Record<string, unknown>;
}
