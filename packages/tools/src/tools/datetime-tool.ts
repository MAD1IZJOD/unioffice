import type {
  ToolDefinition,
  ToolValidationResult,
} from "../tool.js";

type DateUnit = "milliseconds" | "seconds" | "minutes" | "hours" | "days";

const UNIT_MS: Record<DateUnit, number> = {
  milliseconds: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

const UNITS = Object.keys(UNIT_MS) as DateUnit[];

export type DatetimeInput =
  | { operation: "now" }
  | { operation: "add"; isoDate: string; amount: number; unit: DateUnit }
  | { operation: "diff"; fromIso: string; toIso: string; unit: DateUnit };

export type DatetimeOutput =
  | { operation: "now"; iso: string }
  | { operation: "add"; iso: string }
  | { operation: "diff"; value: number; unit: DateUnit };

/**
 * Deterministic date/time utility. Every branch is pure arithmetic on
 * Date.parse output, so results are reproducible and don't depend on the
 * agent's model to do date math (which LLMs are notoriously unreliable at).
 */
export const datetimeTool: ToolDefinition<
  DatetimeInput,
  DatetimeOutput
> = {
  id: "datetime",
  name: "Date/Time",
  description:
    "Reads the current time, or adds to / diffs ISO-8601 timestamps. Operations: now, add, diff.",
  version: "1.0.0",
  inputSchema: {
    type: "object",
    required: ["operation"],
    properties: {
      operation: { type: "string", enum: ["now", "add", "diff"] },
      isoDate: { type: "string", description: "Required for 'add'." },
      fromIso: { type: "string", description: "Required for 'diff'." },
      toIso: { type: "string", description: "Required for 'diff'." },
      amount: { type: "number", description: "Required for 'add'." },
      unit: {
        type: "string",
        enum: UNITS,
        description: "Required for 'add' and 'diff'.",
      },
    },
  },

  validate(input): ToolValidationResult<DatetimeInput> {
    if (typeof input !== "object" || input === null) {
      return {
        valid: false,
        errors: [{ path: "", message: "Input must be an object." }],
      };
    }

    const value = input as Record<string, unknown>;
    const operation = value.operation;

    if (operation === "now") {
      return { valid: true, value: { operation: "now" } };
    }

    if (operation === "add") {
      const isoDate = value.isoDate;
      const amount = value.amount;
      const unit = value.unit;

      if (typeof isoDate !== "string" || Number.isNaN(Date.parse(isoDate))) {
        return {
          valid: false,
          errors: [{ path: "isoDate", message: "isoDate must be a valid ISO-8601 timestamp." }],
        };
      }

      if (typeof amount !== "number" || !Number.isFinite(amount)) {
        return {
          valid: false,
          errors: [{ path: "amount", message: "amount must be a finite number." }],
        };
      }

      if (typeof unit !== "string" || !UNITS.includes(unit as DateUnit)) {
        return {
          valid: false,
          errors: [{ path: "unit", message: `unit must be one of: ${UNITS.join(", ")}.` }],
        };
      }

      return { valid: true, value: { operation: "add", isoDate, amount, unit: unit as DateUnit } };
    }

    if (operation === "diff") {
      const fromIso = value.fromIso;
      const toIso = value.toIso;
      const unit = value.unit;

      if (typeof fromIso !== "string" || Number.isNaN(Date.parse(fromIso))) {
        return {
          valid: false,
          errors: [{ path: "fromIso", message: "fromIso must be a valid ISO-8601 timestamp." }],
        };
      }

      if (typeof toIso !== "string" || Number.isNaN(Date.parse(toIso))) {
        return {
          valid: false,
          errors: [{ path: "toIso", message: "toIso must be a valid ISO-8601 timestamp." }],
        };
      }

      if (typeof unit !== "string" || !UNITS.includes(unit as DateUnit)) {
        return {
          valid: false,
          errors: [{ path: "unit", message: `unit must be one of: ${UNITS.join(", ")}.` }],
        };
      }

      return { valid: true, value: { operation: "diff", fromIso, toIso, unit: unit as DateUnit } };
    }

    return {
      valid: false,
      errors: [{ path: "operation", message: "operation must be one of: now, add, diff." }],
    };
  },

  async execute(input): Promise<DatetimeOutput> {
    if (input.operation === "now") {
      return { operation: "now", iso: new Date().toISOString() };
    }

    if (input.operation === "add") {
      const result = new Date(Date.parse(input.isoDate) + input.amount * UNIT_MS[input.unit]);
      return { operation: "add", iso: result.toISOString() };
    }

    const deltaMs = Date.parse(input.toIso) - Date.parse(input.fromIso);
    return {
      operation: "diff",
      value: deltaMs / UNIT_MS[input.unit],
      unit: input.unit,
    };
  },
};
