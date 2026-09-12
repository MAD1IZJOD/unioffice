import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolGuard,
  ToolValidationError,
} from "../tool.js";

import type {
  ToolRegistry,
} from "../registry/tool-registry.js";

export type ToolExecutionErrorCode =
  | "TOOL_NOT_FOUND"
  | "TOOL_NOT_AUTHORIZED"
  /** The agent holds the grant, but a company policy refuses this call. */
  | "TOOL_DENIED_BY_POLICY"
  | "TOOL_INPUT_INVALID"
  | "TOOL_EXECUTION_FAILED";

export interface ToolExecutionResult {
  toolId: string;

  status:
    | "completed"
    | "failed";

  output?: unknown;

  error?: {
    code: ToolExecutionErrorCode;
    message: string;
    details?: ToolValidationError[];
  };

  /** Set when a guard refused the call, so callers can name the rule. */
  deniedBy?: {
    policyId?: string;
    policyName?: string;
  };

  startedAt: Date;

  completedAt: Date;
}

/**
 * Runs the full agent -> tool loop step: registry lookup, authorization
 * against the calling agent's granted tool ids, the company's own governance
 * rules, structural input validation, and only then execution. Each stage can
 * fail independently so callers can tell "the agent tried to use a tool it
 * doesn't have" apart from "a policy forbids this" apart from "the tool
 * itself failed".
 *
 * The guard runs after the grant check, never in place of it. Governance can
 * take permission away; it cannot hand out a tool the agent was never given,
 * which keeps the registry the authority on what exists and the agent row the
 * authority on what it holds.
 */
export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly guard?: ToolGuard,
  ) {}

  async execute<
    TInput = unknown,
    TOutput = unknown,
  >(
    toolId: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startedAt = new Date();

    const tool = this.registry.get(toolId) as
      | ToolDefinition<TInput, TOutput>
      | null;

    if (!tool) {
      return this.failed(
        toolId,
        startedAt,
        "TOOL_NOT_FOUND",
        `Tool not found: ${toolId}`,
      );
    }

    if (!context.authorizedToolIds.includes(toolId)) {
      return this.failed(
        toolId,
        startedAt,
        "TOOL_NOT_AUTHORIZED",
        `Agent is not authorized to use tool: ${toolId}`,
      );
    }

    if (this.guard) {
      let decision;

      try {
        decision = await this.guard.check(toolId, context);
      } catch (error) {
        // A guard that cannot answer must not be treated as consent. The only
        // safe reading of "governance is unavailable" is that the call does
        // not happen.
        return this.failed(
          toolId,
          startedAt,
          "TOOL_DENIED_BY_POLICY",
          `Governance could not be consulted for ${toolId}, so the call was refused: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      if (decision.outcome === "deny") {
        return {
          ...this.failed(
            toolId,
            startedAt,
            "TOOL_DENIED_BY_POLICY",
            decision.reason,
          ),
          deniedBy: {
            policyId: decision.policyId,
            policyName: decision.policyName,
          },
        };
      }
    }

    let validation: ReturnType<typeof tool.validate>;

    try {
      validation = tool.validate(input);
    } catch (error) {
      return this.failed(
        toolId,
        startedAt,
        "TOOL_INPUT_INVALID",
        `Validating input for tool ${toolId} threw an error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!validation.valid) {
      return this.failed(
        toolId,
        startedAt,
        "TOOL_INPUT_INVALID",
        `Input for tool ${toolId} failed validation.`,
        validation.errors,
      );
    }

    try {
      const output = await tool.execute(
        validation.value,
        context,
      );

      return {
        toolId,
        status: "completed",
        output,
        startedAt,
        completedAt: new Date(),
      };
    } catch (error) {
      return this.failed(
        toolId,
        startedAt,
        "TOOL_EXECUTION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private failed(
    toolId: string,
    startedAt: Date,
    code: ToolExecutionErrorCode,
    message: string,
    details?: ToolValidationError[],
  ): ToolExecutionResult {
    return {
      toolId,
      status: "failed",
      error: { code, message, details },
      startedAt,
      completedAt: new Date(),
    };
  }
}
