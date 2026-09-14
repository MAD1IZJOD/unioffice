import type {
  MemberId,
  OrganizationId,
  OrganizationRole,
  UserId,
  WorkspaceAccessLevel,
  WorkspaceId,
} from "@unioffice/core";

import { buildApiServer, type ApiServices } from "../server.js";

import { AccessError } from "./access-resolver.js";
import { StreamTickets } from "./stream-tickets.js";

/** The user route tests act as unless they say otherwise. */
export const TEST_USER_ID = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09" as UserId;
export const TEST_TOKEN = "test-session";

export interface TestPrincipal {
  organizationId?: OrganizationId;
  userId?: UserId;
  email?: string;
  role?: OrganizationRole;
  workspaces?: Record<string, WorkspaceAccessLevel>;
}

/**
 * A session for route tests: one token, one user, one membership. It refuses
 * exactly what the real resolver refuses at the organization boundary - any
 * other organization reads as not found - so tests of that boundary still
 * mean something.
 */
export function signedIn(principal: TestPrincipal = {}): Pick<ApiServices, "authenticator" | "accessResolver"> {
  const userId = principal.userId ?? TEST_USER_ID;
  const email = principal.email ?? "tester@example.test";
  const memberId = `member-${userId}` as MemberId;
  const role = principal.role ?? "owner";

  return {
    authenticator: {
      async verify(token) {
        return token === TEST_TOKEN ? { userId, email, emailConfirmed: true } : null;
      },
    },
    accessResolver: {
      async resolve(identity, requested) {
        const organizationId = principal.organizationId;

        if (!organizationId || (requested !== undefined && requested !== organizationId)) {
          throw new AccessError(404, "Organization not found.");
        }

        return {
          userId: identity.userId,
          email: identity.email,
          organizationId,
          memberId,
          role,
          workspaces: new Map(
            Object.entries(principal.workspaces ?? {}) as Array<[WorkspaceId, WorkspaceAccessLevel]>,
          ),
        };
      },
      async organizationsFor(identity) {
        if (!principal.organizationId) return [];

        const now = new Date(0);
        return [{
          id: memberId,
          organizationId: principal.organizationId,
          userId: identity.userId,
          email: identity.email,
          role,
          status: "active",
          createdAt: now,
          updatedAt: now,
        }];
      },
    },
  };
}

export type TestServices =
  Omit<ApiServices, "authenticator" | "accessResolver" | "streamTickets" | "memberService"> &
  Partial<Pick<ApiServices, "authenticator" | "accessResolver" | "streamTickets" | "memberService">> &
  { developmentOrganizationId?: OrganizationId; role?: OrganizationRole };

/**
 * The real server, signed in as the test user in the given organization.
 * Requests carry the test session unless they bring an Authorization header
 * of their own - an empty one tests the signed-out path.
 */
export function buildTestServer(services: TestServices) {
  const { developmentOrganizationId, role, ...rest } = services;

  const app = buildApiServer({
    ...signedIn({ organizationId: developmentOrganizationId, role }),
    streamTickets: new StreamTickets(),
    memberService: {} as ApiServices["memberService"],
    ...rest,
  });

  app.addHook("onRequest", async (request) => {
    if (request.headers.authorization === undefined) {
      request.headers.authorization = `Bearer ${TEST_TOKEN}`;
    }
  });

  return app;
}
