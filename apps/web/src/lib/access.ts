import { createContext, useContext } from "react";

import type { Me, Permission } from "./api";

export interface AccessValue {
  me: Me;
  /** Whether the role allows this anywhere. */
  can(permission: Permission): boolean;
  /** Whether the role and the workspace grant together allow this here. */
  canActIn(permission: Permission, workspaceId?: string | null): boolean;
}

/**
 * What the signed-in person may do, as the API reported it.
 *
 * This only decides which controls are worth showing. Every action is
 * authorized again on the server, so a control shown by mistake fails there
 * rather than doing anything it should not.
 */
export const AccessContext = createContext<AccessValue | null>(null);

export function accessFrom(me: Me): AccessValue {
  const organization = me.organization;
  const permissions = new Set(organization?.permissions ?? []);
  const grants = new Map((organization?.workspaces ?? []).map((grant) => [grant.workspaceId, grant.access]));
  const everywhere = organization?.role === "owner" || organization?.role === "admin";

  return {
    me,
    can: (permission) => permissions.has(permission),
    canActIn: (permission, workspaceId) => {
      if (!permissions.has(permission)) return false;
      if (!workspaceId || everywhere) return true;
      return grants.get(workspaceId) === "member";
    },
  };
}

export function useAccess(): AccessValue | null {
  return useContext(AccessContext);
}

/**
 * Whether to offer an action. Outside a signed-in shell - a component rendered
 * on its own in a test - nothing is hidden, since the server is what refuses.
 */
export function useCan(permission: Permission, workspaceId?: string | null): boolean {
  const access = useContext(AccessContext);

  if (!access) return true;

  return workspaceId === undefined
    ? access.can(permission)
    : access.canActIn(permission, workspaceId);
}
