import { ChevronDown, ChevronRight, UserPlus } from "lucide-react";

import { useCallback, useState } from "react";

import {
  changeMemberRole,
  fetchMembers,
  fetchOrganization,
  formatRelativeTime,
  inviteMember,
  reactivateMember,
  removeMember,
  setMemberWorkspaceAccess,
  suspendMember,
  type MemberItem,
  type OrganizationOverview,
  type OrganizationRole,
} from "../lib/api";

import { useAccess, useCan } from "../lib/access";
import { useResource } from "../lib/useResource";

import {
  Chapter,
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
} from "../components/primitives";

/**
 * Who belongs to the company.
 *
 * Everyone can see who is here and in what role. Only owners and admins are
 * offered changes, and only the changes their role allows - the API decides
 * again on every one, so a control shown here is an offer, not a permission.
 */

const ROLE_LABEL: Record<OrganizationRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

const ROLE_DETAIL: Record<OrganizationRole, string> = {
  owner: "Everything, including other owners.",
  admin: "Runs the organization: people, workspaces, agents, policies.",
  member: "Starts and runs missions, decides planner steps, proposes knowledge.",
  viewer: "Sees what they are given. Changes nothing.",
};

/** Roles a person may hand out. Mirrors the API; the API is what enforces it. */
function assignable(actor: OrganizationRole | undefined): OrganizationRole[] {
  if (actor === "owner") return ["owner", "admin", "member", "viewer"];
  if (actor === "admin") return ["member", "viewer"];
  return [];
}

function manageable(actor: OrganizationRole | undefined, target: OrganizationRole): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return target === "member" || target === "viewer";
  return false;
}

export default function Members() {
  const access = useAccess();
  const myRole = access?.me.organization?.role;
  const canManage = useCan("members.manage");
  const canGrant = useCan("workspaces.manage");

  const members = useResource<MemberItem[]>(useCallback(() => fetchMembers(), []), { pollMs: 30_000 });
  const organization = useResource<OrganizationOverview>(useCallback(() => fetchOrganization(), []), { pollMs: 60_000 });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  const workspaces = (organization.data?.workspaces ?? []).filter((entry) => entry.workspace.status === "active");
  const list = members.data ?? [];

  async function act(key: string, change: () => Promise<unknown>) {
    if (busy) return;

    setBusy(key);
    setError(undefined);

    try {
      await change();
      members.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function invite() {
    const address = email.trim();
    if (!address) return;

    await act("invite", async () => {
      await inviteMember(address, role);
      setEmail("");
    });
  }

  if (members.error) {
    return (
      <div className="mx-auto max-w-[1240px] pt-6">
        <Failure
          headline="The members could not be read"
          detail={members.error.message}
          consequence="Nothing was changed by this request."
          action={<button type="button" className="button-ghost" onClick={members.reload}>Try again</button>}
        />
      </div>
    );
  }

  const count = (status: MemberItem["status"]) => list.filter((member) => member.status === status).length;

  return (
    <div className="fade-up">
      <PageOpening
        eyebrow="Workforce"
        title="MEMBERS"
        lead={list.length === 1 ? "ONE PERSON." : `${list.length} PEOPLE.`}
        detail="What each person can see and do comes from their role, and - for members and viewers - from the workspaces they are given. Owners and admins reach every workspace."
        tone="quiet"
        meta={
          <>
            <Reading label="Active" value={members.loading ? "—" : count("active")} tone="idle" />
            <Reading label="Invited" value={members.loading ? "—" : count("invited")} tone="idle" />
            <Reading label="Suspended" value={members.loading ? "—" : count("suspended")} tone="idle" />
          </>
        }
      />

      <div className="mx-auto max-w-[1240px]">
        {canManage && (
          <>
            <Chapter index="01" title="Invite someone" />

            <div className="config mb-4">
              <div className="config-row">
                <label className="config-label" htmlFor="invite-email">Email</label>
                <input
                  id="invite-email"
                  type="email"
                  value={email}
                  disabled={busy !== null}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void invite();
                  }}
                  placeholder="person@company.com"
                  className="config-input"
                />
              </div>

              <div className="config-row">
                <label className="config-label" htmlFor="invite-role">Role</label>
                <select
                  id="invite-role"
                  value={role}
                  disabled={busy !== null}
                  onChange={(event) => setRole(event.target.value as OrganizationRole)}
                  className="config-input"
                >
                  {assignable(myRole).map((option) => (
                    <option key={option} value={option}>{ROLE_LABEL[option]} — {ROLE_DETAIL[option]}</option>
                  ))}
                </select>
              </div>

              <div className="config-foot">
                <button type="button" className="button-primary" disabled={!email.trim() || busy !== null} onClick={() => void invite()}>
                  <UserPlus size={13} />
                  {busy === "invite" ? "Inviting…" : "Invite"}
                </button>
                <span className="config-hint !mt-0">
                  They get in the next time they sign in with that address. No email is sent from here.
                </span>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="mb-4">
            <Failure headline="That change was not made" detail={error} consequence="Nothing was changed." />
          </div>
        )}

        <Chapter index={canManage ? "02" : "01"} title="Everyone" />

        {members.loading ? (
          <Connecting what="Reading the members…" />
        ) : list.length === 0 ? (
          <Quiet line="No one belongs to this organization yet." detail="An owner can invite people above." />
        ) : (
          <div className="member-list" role="list">
            {list.map((member) => {
              const canChange = canManage && !member.you && manageable(myRole, member.role);
              const open = expanded === member.id;
              const grants = new Map(member.workspaces.map((grant) => [grant.workspaceId, grant.access]));
              const reachesAll = member.role === "owner" || member.role === "admin";

              return (
                <div key={member.id} className="member-row" role="listitem">
                  <div className="member-main">
                    <span className="user-avatar">{member.email[0]?.toUpperCase()}</span>

                    <span className="min-w-0 flex-1">
                      <span className="member-email">
                        {member.email}
                        {member.you && <span className="member-you">you</span>}
                      </span>
                      <span className="member-detail">
                        {member.status === "invited"
                          ? `Invited ${formatRelativeTime(member.joinedAt)}`
                          : member.status === "suspended"
                            ? "Suspended - cannot sign in to this organization"
                            : reachesAll
                              ? "Reaches every workspace"
                              : member.workspaces.length === 0
                                ? "Company-wide only"
                                : `${member.workspaces.length} ${member.workspaces.length === 1 ? "workspace" : "workspaces"}`}
                      </span>
                    </span>

                    {canChange ? (
                      <select
                        aria-label={`Role for ${member.email}`}
                        className="config-input member-role"
                        value={member.role}
                        disabled={busy !== null}
                        onChange={(event) => void act(`role:${member.id}`, () => changeMemberRole(member.id, event.target.value as OrganizationRole))}
                      >
                        {[...new Set([member.role, ...assignable(myRole)])].map((option) => (
                          <option key={option} value={option}>{ROLE_LABEL[option]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="t-machine member-role-label">{ROLE_LABEL[member.role].toUpperCase()}</span>
                    )}

                    <span className={`t-machine member-status member-status-${member.status}`}>{member.status.toUpperCase()}</span>
                  </div>

                  {(canChange || (canGrant && !reachesAll && member.status !== "invited")) && (
                    <div className="member-actions">
                      {canGrant && !reachesAll && workspaces.length > 0 && (
                        <button type="button" className="button-quiet" onClick={() => setExpanded(open ? null : member.id)} aria-expanded={open}>
                          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          Workspace access
                        </button>
                      )}

                      {canChange && member.status === "active" && (
                        <button type="button" className="button-quiet" disabled={busy !== null} onClick={() => void act(`suspend:${member.id}`, () => suspendMember(member.id))}>
                          Suspend
                        </button>
                      )}

                      {canChange && member.status === "suspended" && (
                        <button type="button" className="button-quiet" disabled={busy !== null} onClick={() => void act(`reactivate:${member.id}`, () => reactivateMember(member.id))}>
                          Reactivate
                        </button>
                      )}

                      {canChange && (confirmingRemove === member.id ? (
                        <>
                          <span className="config-hint !mt-0">
                            {member.status === "invited" ? "Withdraw this invitation?" : "Remove them from the organization?"}
                          </span>
                          <button
                            type="button"
                            className="button-reject"
                            disabled={busy !== null}
                            onClick={() => void act(`remove:${member.id}`, async () => {
                              await removeMember(member.id);
                              setConfirmingRemove(null);
                            })}
                          >
                            {member.status === "invited" ? "Withdraw" : "Remove"}
                          </button>
                          <button type="button" className="button-quiet" onClick={() => setConfirmingRemove(null)}>Keep</button>
                        </>
                      ) : (
                        <button type="button" className="button-quiet" disabled={busy !== null} onClick={() => setConfirmingRemove(member.id)}>
                          {member.status === "invited" ? "Withdraw invitation" : "Remove"}
                        </button>
                      ))}
                    </div>
                  )}

                  {open && (
                    <div className="member-workspaces">
                      {workspaces.map((entry) => (
                        <label key={entry.workspace.id} className="member-workspace">
                          <span className="min-w-0 flex-1 truncate">{entry.workspace.name}</span>
                          <select
                            aria-label={`Access to ${entry.workspace.name} for ${member.email}`}
                            className="config-input member-role"
                            value={grants.get(entry.workspace.id) ?? "none"}
                            disabled={busy !== null}
                            onChange={(event) => {
                              const value = event.target.value;
                              void act(`workspace:${member.id}:${entry.workspace.id}`, () =>
                                setMemberWorkspaceAccess(member.id, entry.workspace.id, value === "none" ? null : (value as "member" | "viewer")));
                            }}
                          >
                            <option value="none">No access</option>
                            <option value="viewer">Can see</option>
                            <option value="member">Can work</option>
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
