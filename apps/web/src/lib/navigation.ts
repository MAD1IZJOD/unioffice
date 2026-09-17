import {
  Activity,
  Blocks,
  Boxes,
  Brain,
  Command as CommandIcon,
  FileOutput,
  LayoutGrid,
  Network,
  Plug,
  Scale,
  ShieldAlert,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { FeatureArea, FeatureItem, MissionControl } from "./api";

/**
 * The navigation, built from the features the API says exist here.
 *
 * The server decides which features there are, where they live, whether this
 * person can see them and whether they are fully working. This file only
 * decides how each looks - an icon and, for the two that count something, a
 * badge. A feature the web app has no presentation for still appears, with a
 * plain icon, rather than silently disappearing.
 */

export interface NavigationContext {
  missionControl?: MissionControl;
}

export interface NavigationEntry {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  status: FeatureItem["status"];
  note: string | null;
  badge?: (context: NavigationContext) => number;
}

export interface NavigationGroup {
  area: FeatureArea;
  label: string;
  entries: NavigationEntry[];
}

export const AREA_LABEL: Record<FeatureArea, string> = {
  command: "Command",
  work: "Work",
  workforce: "Workforce",
  knowledge: "Knowledge",
  company: "Company",
};

const AREA_ORDER: FeatureArea[] = ["command", "work", "workforce", "knowledge", "company"];

const PRESENTATION: Record<string, Pick<NavigationEntry, "icon" | "badge">> = {
  "command-center": { icon: CommandIcon },
  missions: {
    icon: LayoutGrid,
    // Missions that are moving or stuck; finished ones need no badge.
    badge: ({ missionControl }) =>
      (missionControl?.summary.running ?? 0) + (missionControl?.summary.blocked ?? 0),
  },
  approvals: {
    icon: ShieldAlert,
    // The same number the attention queue and the Command Center show.
    badge: ({ missionControl }) =>
      missionControl?.attention.items.filter((item) => item.kind === "decision").length ?? 0,
  },
  artifacts: { icon: FileOutput },
  workforce: { icon: Users },
  skills: { icon: Blocks },
  tools: { icon: Wrench },
  "company-brain": { icon: Brain },
  activity: { icon: Activity },
  organization: { icon: Network },
  members: { icon: UserCog },
  governance: { icon: Scale },
  connections: { icon: Plug },
};

/**
 * What the rail shows before the API has answered, or if it cannot: the
 * product's own surfaces, marked available. Every route still checks access
 * on the server, so showing a link early can never grant anything.
 */
export const FALLBACK_FEATURES: FeatureItem[] = [
  ["command-center", "Command Center", "command", "/command"],
  ["missions", "Missions", "work", "/missions"],
  ["approvals", "Approvals", "work", "/approvals"],
  ["artifacts", "Artifacts", "work", "/artifacts"],
  ["workforce", "Agents", "workforce", "/workforce"],
  ["skills", "Skills", "workforce", "/skills"],
  ["tools", "Tools", "workforce", "/tools"],
  ["company-brain", "Company Brain", "knowledge", "/brain"],
  ["activity", "Activity", "knowledge", "/activity"],
  ["organization", "Organization", "company", "/organization"],
  ["members", "Members", "company", "/members"],
  ["governance", "Governance", "company", "/governance"],
  ["connections", "Connections", "company", "/settings/connections"],
].map(([id, name, area, path]) => ({
  id: id!,
  name: name!,
  description: "",
  area: area as FeatureArea,
  path: path!,
  dependsOn: [],
  status: "available" as const,
  note: null,
}));

export function buildNavigation(features: FeatureItem[]): NavigationGroup[] {
  return AREA_ORDER
    .map((area) => ({
      area,
      label: AREA_LABEL[area],
      entries: features
        .filter((feature) => feature.area === area)
        .map((feature) => ({
          id: feature.id,
          label: feature.name,
          path: feature.path,
          status: feature.status,
          note: feature.note,
          icon: PRESENTATION[feature.id]?.icon ?? Boxes,
          badge: PRESENTATION[feature.id]?.badge,
        })),
    }))
    .filter((group) => group.entries.length > 0);
}

/** Pages that sit under a feature without being its own entry. */
const DETAIL_PAGES: Array<{ prefix: string; area: FeatureArea; title: string }> = [
  { prefix: "/missions/new/", area: "work", title: "Start from a template" },
  { prefix: "/missions/", area: "work", title: "Execution room" },
  { prefix: "/workforce/", area: "workforce", title: "Agent" },
  { prefix: "/skills/", area: "workforce", title: "Skill" },
  { prefix: "/brain/", area: "knowledge", title: "Knowledge" },
  { prefix: "/workspaces/", area: "company", title: "Workspace" },
  { prefix: "/settings/connections/", area: "company", title: "Connection" },
];

/** Where a path sits, for the breadcrumb: its area and its own name. */
export function locate(pathname: string, groups: NavigationGroup[]): { group: string; title: string } {
  if (pathname === "/missions/new") return { group: AREA_LABEL.work, title: "Open a mission" };
  if (pathname === "/skills/new") return { group: AREA_LABEL.workforce, title: "New skill" };

  for (const group of groups) {
    const entry = group.entries.find((candidate) => candidate.path === pathname);
    if (entry) return { group: group.label, title: entry.label };
  }

  const detail = DETAIL_PAGES.find((page) => pathname.startsWith(page.prefix));
  if (detail) return { group: AREA_LABEL[detail.area], title: detail.title };

  return { group: AREA_LABEL.command, title: "Command Center" };
}
