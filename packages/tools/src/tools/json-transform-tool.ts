import type {
  ToolDefinition,
  ToolValidationResult,
} from "../tool.js";

type JsonObject = Record<string, unknown>;

export type JsonTransformInput =
  | { operation: "pick"; data: JsonObject | JsonObject[]; keys: string[] }
  | { operation: "omit"; data: JsonObject | JsonObject[]; keys: string[] }
  | { operation: "filter_equals"; data: JsonObject[]; field: string; equals: unknown }
  | { operation: "map_field"; data: JsonObject[]; field: string };

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
    "Applies a structural transform to JSON data. 'pick'/'omit' keep or drop keys and accept either one object or an array of objects (applied to every item); 'filter_equals' keeps matching items; 'map_field' projects one field from every item.",
  version: "1.0.0",
  inputSchema: {
    type: "object",
    required: ["operation", "data"],
    properties: {
      operation: { type: "string", enum: OPERATIONS },
      data: {
        description:
          "An object or an array of objects for pick/omit; an array of objects for filter_equals/map_field.",
      },
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

      // Selecting the same fields from every row is the common case, and
      // rejecting an array here left it inexpressible: an agent asked to keep
      // two fields from a list of records looped through every operation the
      // tool had and gave up. An array now applies the transform per item.
      const isObject =
        typeof data === "object" && data !== null && !Array.isArray(data);
      const isObjectArray =
        Array.isArray(data) &&
        data.every((item) => typeof item === "object" && item !== null && !Array.isArray(item));

      if (!isObject && !isObjectArray) {
        return {
          valid: false,
          errors: [{
            path: "data",
            message: `data must be an object or an array of objects for '${operation}'.`,
          }],
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
        value: {
          operation,
          data: data as JsonObject | JsonObject[],
          keys,
        },
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
        value: { operation: "map_field", data: data as JsonObject[], field },
      };
    }

    return {
      valid: true,
      value: { operation: "filter_equals", data: data as JsonObject[], field, equals: value.equals },
    };
  },

  async execute(input): Promise<JsonTransformOutput> {
    if (input.operation === "pick") {
      const keys = input.keys;
      const pick = (item: JsonObject) =>
        Object.fromEntries(
          keys.filter((key) => key in item).map((key) => [key, item[key]]),
        );

      return Array.isArray(input.data)
        ? input.data.map(pick)
        : pick(input.data);
    }

    if (input.operation === "omit") {
      const excluded = new Set(input.keys);
      const omit = (item: JsonObject) =>
        Object.fromEntries(
          Object.entries(item).filter(([key]) => !excluded.has(key)),
        );

      return Array.isArray(input.data)
        ? input.data.map(omit)
        : omit(input.data);
    }

    if (input.operation === "filter_equals") {
      return input.data.filter((item) => item[input.field] === input.equals);
    }

    return input.data.map((item) => item[input.field]);
  },
};
