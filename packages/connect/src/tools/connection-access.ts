import type {
  ConnectionCapability,
  ConnectionProvider,
} from "@unioffice/core";

import type {
  ToolExecutionContext,
  ToolValidationError,
  ToolValidationResult,
} from "@unioffice/tools";

/**
 * How a tool reaches a connection, without being able to choose one.
 *
 * A tool names the provider and the capability it needs. The host decides
 * everything else from the execution context it built itself: which
 * organization, which workspace, whether a live connection reaches there,
 * whether that connection allows the capability, and whether the provider
 * may be called right now. The tool gets a token for the length of one call
 * and nothing it could pass along - no connection id to aim elsewhere, no
 * way to pick another organization's connection.
 */
export interface ConnectionSession {
  accessToken: string;
}

export interface ConnectionNeed {
  provider: ConnectionProvider;
  capability: ConnectionCapability;
}

export interface ConnectionAccess {
  use<T>(
    context: ToolExecutionContext,
    need: ConnectionNeed,
    run: (session: ConnectionSession) => Promise<T>,
  ): Promise<T>;
}

/** A small, strict reader for tool input. Unknown fields are refused, not ignored. */
export class InputReader {
  readonly errors: ToolValidationError[] = [];
  private readonly record: Record<string, unknown>;

  constructor(input: unknown, allowed: readonly string[]) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      this.record = {};
      this.errors.push({ path: "", message: "Input must be an object." });
      return;
    }

    this.record = input as Record<string, unknown>;

    for (const key of Object.keys(this.record)) {
      if (!allowed.includes(key)) {
        this.errors.push({ path: key, message: `${key} is not an accepted field.` });
      }
    }
  }

  text(key: string, options: { required?: boolean; min?: number; max: number; pattern?: RegExp }): string | undefined {
    const value = this.record[key];

    if (value === undefined || value === null || value === "") {
      if (options.required) this.errors.push({ path: key, message: `${key} is required.` });
      return undefined;
    }

    if (typeof value !== "string") {
      this.errors.push({ path: key, message: `${key} must be text.` });
      return undefined;
    }

    if (value.length < (options.min ?? 0) || value.length > options.max) {
      this.errors.push({ path: key, message: `${key} must be ${options.min ?? 0} to ${options.max} characters.` });
      return undefined;
    }

    if (options.pattern && !options.pattern.test(value)) {
      this.errors.push({ path: key, message: `${key} is not in the expected format.` });
      return undefined;
    }

    return value;
  }

  integer(key: string, options: { required?: boolean; min: number; max: number }): number | undefined {
    const value = this.record[key];

    if (value === undefined || value === null) {
      if (options.required) this.errors.push({ path: key, message: `${key} is required.` });
      return undefined;
    }

    if (typeof value !== "number" || !Number.isInteger(value) || value < options.min || value > options.max) {
      this.errors.push({ path: key, message: `${key} must be a whole number from ${options.min} to ${options.max}.` });
      return undefined;
    }

    return value;
  }

  oneOf<T extends string>(key: string, values: readonly T[]): T | undefined {
    const value = this.record[key];

    if (value === undefined || value === null) return undefined;

    if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
      this.errors.push({ path: key, message: `${key} must be one of ${values.join(", ")}.` });
      return undefined;
    }

    return value as T;
  }

  flag(key: string): boolean | undefined {
    const value = this.record[key];

    if (value === undefined || value === null) return undefined;

    if (typeof value !== "boolean") {
      this.errors.push({ path: key, message: `${key} must be true or false.` });
      return undefined;
    }

    return value;
  }

  result<T>(value: T): ToolValidationResult<T> {
    return this.errors.length > 0 ? { valid: false, errors: this.errors } : { valid: true, value };
  }
}
