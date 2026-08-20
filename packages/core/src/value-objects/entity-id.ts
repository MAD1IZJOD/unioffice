import { randomUUID } from "node:crypto";

export type EntityId = string & {
  readonly __brand: "EntityId";
};

export function createEntityId(): EntityId {
  return randomUUID() as EntityId;
}