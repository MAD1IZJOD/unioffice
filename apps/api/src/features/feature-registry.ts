import type { Access, Permission } from "../access/permissions.js";
import { roleCan } from "../access/permissions.js";

/**
 * What the product can do, as data.
 *
 * Skills answer "what can the workforce do"; features answer "what can the
 * product do here, now". Each feature says where it lives, what it depends
 * on and what a person needs to see it, and its status is computed from the
 * server's real configuration - so the navigation, the command palette and
 * any page that links to another feature read one answer rather than each
 * hard-coding its own idea of what exists.
 *
 * Deliberately small. A feature is not a plugin system: it cannot add routes
 * or code, and turning one off is not a security boundary - every route still
 * checks permissions itself.
 */

export type FeatureArea = "command" | "work" | "workforce" | "knowledge" | "company";

export type FeatureStatus =
  /** Works fully. */
  | "available"
  /** Works, with something missing that is worth saying. */
  | "limited"
  /** Present, but needs the server configured before it does anything. */
  | "needs_configuration";

export interface FeatureDefinition {
  id: string;
  name: string;
  description: string;
  area: FeatureArea;
  path: string;
  /** What someone needs to see the feature at all. */
  permission: Permission;
  /** Features this one is built on. If one is unavailable, so is this. */
  dependsOn: string[];
}

export interface FeatureEnvironment {
  /** Local embedding model configured: semantic recall works. */
  semanticRecall: boolean;
  /** At least one external provider has an OAuth client and the encryption key. */
  connectionProviders: number;
}

export interface FeatureView extends FeatureDefinition {
  status: FeatureStatus;
  /** Why the status is not "available", in a sentence. */
  note: string | null;
}

export const FEATURES: readonly FeatureDefinition[] = [
  { id: "command-center", name: "Command Center", description: "What the company is doing, what needs you, and what changed.", area: "command", path: "/command", permission: "organization.read", dependsOn: ["missions", "approvals"] },
  { id: "missions", name: "Missions", description: "Work the company is doing, from objective to outcome.", area: "work", path: "/missions", permission: "organization.read", dependsOn: [] },
  { id: "approvals", name: "Approvals", description: "Decisions the work is waiting on.", area: "work", path: "/approvals", permission: "organization.read", dependsOn: ["missions", "governance"] },
  { id: "artifacts", name: "Artifacts", description: "What the work produced.", area: "work", path: "/artifacts", permission: "organization.read", dependsOn: ["missions"] },
  { id: "workforce", name: "Agents", description: "Who works for the company and what they are doing.", area: "workforce", path: "/workforce", permission: "organization.read", dependsOn: [] },
  { id: "skills", name: "Skills", description: "What the workforce knows how to do.", area: "workforce", path: "/skills", permission: "organization.read", dependsOn: ["workforce", "governance"] },
  { id: "tools", name: "Tools", description: "The executable primitives agents can be granted.", area: "workforce", path: "/tools", permission: "organization.read", dependsOn: ["workforce"] },
  { id: "company-brain", name: "Company Brain", description: "What the company has learned, and why it believes it.", area: "knowledge", path: "/brain", permission: "organization.read", dependsOn: ["governance"] },
  { id: "activity", name: "Activity", description: "Everything that happened, in order.", area: "knowledge", path: "/activity", permission: "organization.read", dependsOn: [] },
  { id: "organization", name: "Organization", description: "Workspaces and how the company is arranged.", area: "company", path: "/organization", permission: "organization.read", dependsOn: [] },
  { id: "members", name: "Members", description: "People, roles and workspace access.", area: "company", path: "/members", permission: "organization.read", dependsOn: [] },
  { id: "governance", name: "Governance", description: "The rules every step and tool call is held to.", area: "company", path: "/governance", permission: "organization.read", dependsOn: [] },
  { id: "connections", name: "Connections", description: "External systems the company has authorized.", area: "company", path: "/settings/connections", permission: "organization.read", dependsOn: ["governance"] },
];

/** Everyone who can see the feature, with its status as this server has it. */
export function featuresFor(access: Access, environment: FeatureEnvironment): FeatureView[] {
  const views = new Map<string, FeatureView>();

  for (const feature of FEATURES) {
    const own = statusOf(feature, environment);
    views.set(feature.id, { ...feature, dependsOn: [...feature.dependsOn], ...own });
  }

  // A feature is no better than what it is built on: one that depends
  // directly on something still unconfigured is limited, and says why. Cycles
  // are refused by the tests rather than tolerated here.
  for (const feature of FEATURES) {
    const view = views.get(feature.id)!;
    const blocked = feature.dependsOn
      .map((id) => views.get(id))
      .find((dependency) => dependency?.status === "needs_configuration");

    if (blocked && view.status === "available") {
      view.status = "limited";
      view.note = `Depends on ${blocked.name}, which ${blocked.note ?? "is not set up"}`;
    }
  }

  return [...views.values()].filter((feature) => roleCan(access.role, feature.permission));
}

function statusOf(feature: FeatureDefinition, environment: FeatureEnvironment): Pick<FeatureView, "status" | "note"> {
  if (feature.id === "connections" && environment.connectionProviders === 0) {
    return {
      status: "needs_configuration",
      note: "needs an OAuth client and an encryption key in the server environment before anything can be connected.",
    };
  }

  if (feature.id === "company-brain" && !environment.semanticRecall) {
    return {
      status: "limited",
      note: "Recall is by keyword, importance and recency only; no embedding model is configured.",
    };
  }

  return { status: "available", note: null };
}
