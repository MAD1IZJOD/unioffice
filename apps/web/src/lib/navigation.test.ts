import { Boxes } from "lucide-react";
import { describe, expect, it } from "vitest";

import type { FeatureItem } from "./api";
import { buildNavigation, FALLBACK_FEATURES, locate } from "./navigation";

describe("navigation", () => {
  it("groups features by area in a fixed order and keeps their status", () => {
    const features: FeatureItem[] = FALLBACK_FEATURES.map((feature) =>
      feature.id === "connections"
        ? { ...feature, status: "needs_configuration", note: "needs an OAuth client" }
        : feature);

    const groups = buildNavigation(features);

    expect(groups.map((group) => group.label)).toEqual(["Command", "Work", "Workforce", "Knowledge", "Company"]);
    expect(groups.find((group) => group.area === "workforce")!.entries.map((entry) => entry.label)).toEqual(["Agents", "Skills", "Tools"]);

    const connections = groups.flatMap((group) => group.entries).find((entry) => entry.id === "connections")!;
    expect(connections.status).toBe("needs_configuration");
    expect(connections.note).toBe("needs an OAuth client");
  });

  it("shows only what the server listed, and still shows a feature it has no icon for", () => {
    const groups = buildNavigation([
      ...FALLBACK_FEATURES.filter((feature) => feature.area === "work"),
      { id: "workflows", name: "Workflows", description: "", area: "work", path: "/workflows", dependsOn: [], status: "available", note: null },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries.at(-1)!.icon).toBe(Boxes);
  });

  it("names every page in the breadcrumb, including detail pages", () => {
    const groups = buildNavigation(FALLBACK_FEATURES);

    expect(locate("/skills", groups)).toEqual({ group: "Workforce", title: "Skills" });
    expect(locate("/skills/system%3Acode-review", groups)).toEqual({ group: "Workforce", title: "Skill" });
    expect(locate("/skills/new", groups)).toEqual({ group: "Workforce", title: "New skill" });
    expect(locate("/missions/abc", groups)).toEqual({ group: "Work", title: "Execution room" });
    expect(locate("/settings/connections/abc", groups)).toEqual({ group: "Company", title: "Connection" });
    expect(locate("/nowhere", groups)).toEqual({ group: "Command", title: "Command Center" });
  });
});
