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

/**
 * A tool that reaches a system outside the company.
 *
 * Declared by the tool, like its risk, because only the tool knows whether it
 * reads from somewhere or changes something there. Anything declared here is
 * held to stricter rules than a local tool, by the executor and the runtime
 * rather than by convention:
 *
 * - A write only runs when the calling step was approved by a person for that
 *   tool. No policy, guard or model output can stand in for the approval.
 * - What an external call read or wrote is never persisted as its output. The
 *   tool's own audit record is kept instead.
 */
export interface ToolExternalReach {
  /** Which system, for people: "github", "google_drive". */
  provider: string;

  access: "read" | "write";
}

/**
 * What is kept about one external call once it has happened. Identifiers and
 * a sentence - never content, never credentials.
 */
export interface ToolAuditRecord {
  /** A stable verb for the audit trail, e.g. "pull_request.created". */
  action: string;

  /** For a person: "GitHub pull request created". */
  summary: string;

  /** Safe identifiers for what was touched: a repository, an issue number, a file id. */
  resource?: Record<string, string | number>;
}

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

  /** Present only on tools that reach outside the company. */
  external?: ToolExternalReach;

  /**
   * How many times one agent run may call this tool. Unbounded when absent;
   * a write that a person approved once should run once.
   */
  maxCallsPerRun?: number;

  /** Structural validation performed before execute() ever runs. */
  validate(input: unknown): ToolValidationResult<TInput>;

  execute(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<TOutput>;

  /** What to keep about a completed call. Required in practice for external tools. */
  audit?(input: TInput, output: TOutput): ToolAuditRecord;
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

  /**
   * Tool ids a person approved for the step this call belongs to. Set by the
   * execution path from the step's recorded approval - never from anything a
   * model produced - and required for any external write.
   */
  approvedToolIds?: string[];

  metadata: Record<string, unknown>;
}
