import type { WorkspaceId } from "@unioffice/core";

import { AccessError } from "./access-resolver.js";
import { canActIn, reaches, type Access, type Permission } from "./permissions.js";

/**
 * Refuses the request unless the caller may do this, here.
 *
 * The one call every protected route makes. It answers from the role and
 * workspace grants resolved for this request, never from anything the request
 * claims about itself.
 */
export function authorize(
  access: Access,
  permission: Permission,
  workspaceId?: WorkspaceId | null,
): void {
  if (!canActIn(access, permission, workspaceId)) {
    throw new AccessError(403, "You do not have permission to do that.");
  }
}

/**
 * Refuses a read of something in a workspace the caller cannot see. Reported
 * as not found, so an id from a workspace they were never given reads the same
 * as an id that does not exist.
 */
export function authorizeRead(
  access: Access,
  workspaceId: WorkspaceId | null | undefined,
  notFound: () => Error,
): void {
  if (!reaches(access, workspaceId)) throw notFound();
}
