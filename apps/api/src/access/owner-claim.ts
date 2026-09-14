import {
  createEntityId,
  type MemberId,
  type OrganizationId,
  type OrganizationMember,
  type UserId,
} from "@unioffice/core";

import type { MembershipRepository } from "@unioffice/database";

import type { EventRecorder } from "../event-recorder.js";

/** The one lookup a claim needs from the auth server. */
export interface UserDirectory {
  findByEmail(email: string): Promise<{ id: UserId; emailConfirmed: boolean } | null>;
}

export class OwnerClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerClaimError";
  }
}

export type OwnerClaimOutcome = "already_owner" | "added" | "promoted" | "invited";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Makes the first owner of an organization that has none.
 *
 * A one-off bootstrap run from a terminal with server credentials, not a way
 * into an organization someone already owns: once there is an active owner it
 * refuses, and owners add or promote people through member management from
 * then on.
 *
 * The person must control the address. If they have signed in with a
 * confirmed email, they become the owner now. If not, an owner invitation is
 * left for that address, and it only turns into access when someone signs in
 * and the auth server has confirmed they own it. No account or password is
 * ever created here.
 */
export async function claimOwnership(input: {
  members: MembershipRepository;
  users: UserDirectory;
  eventRecorder: Pick<EventRecorder, "record">;
  organizationId: OrganizationId;
  email: string;
  now?: Date;
}): Promise<{ outcome: OwnerClaimOutcome; member: OrganizationMember }> {
  const { members, users, eventRecorder, organizationId } = input;
  const email = input.email.trim().toLowerCase();
  const now = input.now ?? new Date();

  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    throw new OwnerClaimError("That is not an email address.");
  }

  const everyone = await members.listMembers(organizationId);
  const user = await users.findByEmail(email);
  const confirmedUser = user?.emailConfirmed ? user : null;

  const existing = everyone.find((member) =>
    member.email === email || (confirmedUser !== null && member.userId === confirmedUser.id));

  if (existing?.role === "owner" && existing.status === "active") {
    return { outcome: "already_owner", member: existing };
  }

  if (everyone.some((member) => member.role === "owner" && member.status === "active")) {
    throw new OwnerClaimError(
      "This organization already has an owner. An owner can add or promote people from organization settings.",
    );
  }

  let member: OrganizationMember;
  let outcome: OwnerClaimOutcome;

  if (confirmedUser) {
    if (existing) {
      const attached = existing.userId
        ? existing
        : (await members.claimInvitation(existing.id, confirmedUser.id, now)) ?? existing;

      member = await members.updateMember({ ...attached, role: "owner", status: "active", updatedAt: now });
      outcome = "promoted";
    } else {
      member = await members.createMember({
        id: createEntityId<"MemberId">() as MemberId,
        organizationId,
        userId: confirmedUser.id,
        email,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      outcome = "added";
    }
  } else if (existing) {
    member = await members.updateMember({ ...existing, role: "owner", updatedAt: now });
    outcome = "invited";
  } else {
    member = await members.createMember({
      id: createEntityId<"MemberId">() as MemberId,
      organizationId,
      email,
      role: "owner",
      status: "invited",
      createdAt: now,
      updatedAt: now,
    });
    outcome = "invited";
  }

  await eventRecorder.record({
    organizationId,
    type: outcome === "promoted" ? "member.role_changed" : outcome === "added" ? "member.added" : "member.invited",
    actorType: "system",
    actorId: "system:owner-claim",
    payload: {
      memberId: member.id,
      role: "owner",
      status: member.status,
      previousRole: existing?.role,
      via: "owner_claim",
    },
  });

  return { outcome, member };
}
