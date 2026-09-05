import type {
  ToolDefinition,
  ToolValidationResult,
} from "../tool.js";

export type JsonTransformInput =
  | { operation: "pick"; data: Record<string, unknown>; keys: string[] }
  | { operation: "omit"; data: Record<string, unknown>; keys: string[] }
  | { operation: "filter_equals"; data: Record<string, unknown>[]; field: string; equals: unknown }
  | { operation: "map_field"; data: Record<string, unknown>[]; field: string };

export type JsonTransformOutput = unknown;

const OPERATIONS = ["pick", "omit", "filter_equals", "map_field"] as const;

/**
 * Structural JSON transforms only (key selection, equality filtering, field
 * projection) — no expression language, so there is no arbitrary-code path
 * from agent input to execution.
 */
export const jsonTransformTool: ToolDefinition<
  JsonTransformInput,
  JsonTransformOutput
> = {
  id: "json_transform",
  name: "JSON Transform",
  description:
    "Applies a structural transform (pick, omit, filter_equals, map_field) to JSON data.",
  version: "1.0.0",
  inputSchema: {
    type: "object",
    required: ["operation", "data"],
    properties: {
      operation: { type: "string", enum: OPERATIONS },
      data: { description: "Object for pick/omit, array of objects for filter_equals/map_field." },
      keys: { type: "array", items: { type: "string" }, description: "Required for pick/omit." },
      field: { type: "string", description: "Required for filter_equals/map_field." },
      equals: { description: "Required for filter_equals." },
    },
  },

  validate(input): ToolValidationResult<JsonTransformInput> {
    if (typeof input !== "object" || input === null) {
      return {
        valid: false,
        errors: [{ path: "", message: "Input must be an object." }],
      };
    }

    const value = input as Record<string, unknown>;
    const operation = value.operation;

    if (typeof operation !== "string" || !OPERATIONS.includes(operation as typeof OPERATIONS[number])) {
      return {
        valid: false,
        errors: [{ path: "operation", message: `operation must be one of: ${OPERATIONS.join(", ")}.` }],
      };
    }

    if (operation === "pick" || operation === "omit") {
      const data = value.data;
      const keys = value.keys;

      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        return {
          valid: false,
          errors: [{ path: "data", message: `data must be an object for '${operation}'.` }],
        };
      }

      if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) {
        return {
          valid: false,
          errors: [{ path: "keys", message: "keys must be an array of strings." }],
        };
      }

      return {
        valid: true,
        value: { operation, data: data as Record<string, unknown>, keys },
      };
    }

    const data = value.data;

    if (!Array.isArray(data) || !data.every((item) => typeof item === "object" && item !== null)) {
      return {
        valid: false,
        errors: [{ path: "data", message: `data must be an array of objects for '${operation}'.` }],
      };
    }

    const field = value.field;

    if (typeof field !== "string" || field.length === 0) {
      return {
        valid: false,
        errors: [{ path: "field", message: "field must be a non-empty string." }],
      };
    }

    if (operation === "map_field") {
      return {
        valid: true,
        value: { operation: "map_field", data: data as Record<string, unknown>[], field },
      };
    }

    return {
      valid: true,
      value: { operation: "filter_equals", data: data as Record<string, unknown>[], field, equals: value.equals },
    };
  },

  async execute(input): Promise<JsonTransformOutput> {
    if (input.operation === "pick") {
      return Object.fromEntries(
        input.keys
          .filter((key) => key in input.data)
          .map((key) => [key, input.data[key]]),
      );
    }

    if (input.operation === "omit") {
      const excluded = new Set(input.keys);
      return Object.fromEntries(
        Object.entries(input.data).filter(([key]) => !excluded.has(key)),
      );
    }

    if (input.operation === "filter_equals") {
      return input.data.filter((item) => item[input.field] === input.equals);
    }

    return input.data.map((item) => item[input.field]);
  },
};
