/**
 * How much reach a tool has.
 *
 * Declared by the tool rather than assigned by governance, because a tool is
 * the only thing that knows what it can actually touch. Governance can raise
 * the risk of a call through policy; it should not have to guess the floor.
 *
 * The three tools shipped today are pure and deterministic - they compute and
 * return, and cannot reach anything outside the process - so they are all
 * low. The field exists so that the first tool that can send an email or move
 * money has somewhere honest to say so.
 */
export type ToolRisk =
  | "low"
  | "medium"
  | "high"
  | "critical";

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

  /** What this tool can reach. Defaults to low when a tool does not say. */
  risk?: ToolRisk;

  /** Structural validation performed before execute() ever runs. */
  validate(input: unknown): ToolValidationResult<TInput>;

  execute(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<TOutput>;
}

/**
 * Governance's answer about one specific call.
 *
 * The executor already refuses a tool the agent was never granted. This is
 * the separate question of whether the company's own rules permit this call
 * now - which the tools package deliberately cannot answer for itself, since
 * policies live in the database and this package has no database.
 */
export interface ToolGuardDecision {
  outcome: "allow" | "deny";

  /** Shown to the agent and written to the audit trail. */
  reason: string;

  policyId?: string;
  policyName?: string;
  risk?: ToolRisk;
}

/**
 * Consulted after the registry and the agent's grants, never instead of them.
 * A guard can only narrow what is already permitted.
 */
export interface ToolGuard {
  check(
    toolId: string,
    context: ToolExecutionContext,
  ): Promise<ToolGuardDecision>;
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
