import assert from "node:assert/strict";
import test from "node:test";

import type { MemberId, OrganizationId, OrganizationRole, UserId } from "@unioffice/core";

import type { Access } from "../access/permissions.js";

import { FEATURES, featuresFor } from "./feature-registry.js";

function person(role: OrganizationRole): Access {
  return {
    userId: "u" as UserId,
    email: "p@example.test",
    organizationId: "o" as OrganizationId,
    memberId: "m" as MemberId,
    role,
    workspaces: new Map(),
  };
}

const configured = { semanticRecall: true, connectionProviders: 2 };

test("feature ids are unique, paths are unique, and every dependency exists and comes first", () => {
  const seen = new Set<string>();
  const paths = new Set<string>();

  for (const feature of FEATURES) {
    assert.equal(seen.has(feature.id), false, `duplicate ${feature.id}`);
    assert.equal(paths.has(feature.path), false, `duplicate path ${feature.path}`);
    paths.add(feature.path);

    for (const dependency of feature.dependsOn) {
      assert.ok(FEATURES.some((entry) => entry.id === dependency), `${feature.id} depends on missing ${dependency}`);
      assert.notEqual(dependency, feature.id);
    }

    seen.add(feature.id);
  }

  // No cycles: following dependencies never returns to the start.
  const visit = (id: string, trail: string[]) => {
    assert.equal(trail.includes(id), false, `cycle: ${[...trail, id].join(" -> ")}`);
    for (const next of FEATURES.find((entry) => entry.id === id)!.dependsOn) visit(next, [...trail, id]);
  };
  for (const feature of FEATURES) visit(feature.id, []);
});

test("a fully configured server has every feature available", () => {
  const features = featuresFor(person("viewer"), configured);

  assert.equal(features.length, FEATURES.length);
  assert.ok(features.every((feature) => feature.status === "available" && feature.note === null));
});

test("status follows the server's real configuration", () => {
  const features = featuresFor(person("owner"), { semanticRecall: false, connectionProviders: 0 });
  const byId = new Map(features.map((feature) => [feature.id, feature]));

  assert.equal(byId.get("connections")?.status, "needs_configuration");
  assert.match(byId.get("connections")?.note ?? "", /OAuth client/);
  assert.equal(byId.get("company-brain")?.status, "limited");
  assert.equal(byId.get("missions")?.status, "available");
});

test("a result never shares state between callers", () => {
  const first = featuresFor(person("owner"), configured);
  first[0]!.dependsOn.push("tampered");

  assert.equal(featuresFor(person("owner"), configured)[0]!.dependsOn.includes("tampered"), false);
});

test("GET /features answers for the signed-in person only", async () => {
  const { buildTestServer } = await import("../access/testing.js");
  const app = buildTestServer({ developmentOrganizationId: "aaaaaaaa-0000-4000-8000-000000000001" as never, role: "viewer" } as never);

  const signedOut = await app.inject({ method: "GET", url: "/features", headers: { authorization: "" } });
  assert.equal(signedOut.statusCode, 401);

  const response = await app.inject({ method: "GET", url: "/features" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.product.version, "2.1");
  assert.equal(body.features.find((feature: { id: string }) => feature.id === "connections").status, "needs_configuration");
});
