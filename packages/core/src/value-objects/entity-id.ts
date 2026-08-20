import { randomUUID } from "node:crypto";

export type EntityId = string & {
  readonly __brand: "EntityId";
};

export function createEntityId<T extends string = "EntityId">(): string & {
  readonly __brand: T;
} {
  return randomUUID() as string & {
    readonly __brand: T;
  };
}