import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { NewPolicy, PolicyItem } from "../../lib/api";
import { conditionPhrase, policySentence } from "../../lib/governance";
import { PolicyComposer } from "./PolicyComposer";

/**
 * Writing a rule narrowed by circumstance, and reading one back. What is sent
 * has to be exactly what the engine understands, and what is read has to be
 * what the engine will do.
 */

function compose() {
  const onCreate = vi.fn<(policy: NewPolicy) => void>();

  render(
    <PolicyComposer
      agents={[]}
      tools={[{ id: "github_create_issue", name: "Create a GitHub issue", description: "", version: "1", inputSchema: {} }]}
      workspaces={[]}
      busy={false}
      onCancel={() => {}}
      onCreate={onCreate}
    />,
  );

  return onCreate;
}

describe("writing a rule with conditions", () => {
  it("sends only the conditions chosen, as the engine reads them", async () => {
    const onCreate = compose();

    await userEvent.click(within(screen.getByRole("group", { name: "Who started the work" })).getByRole("button", { name: /Scheduled work/ }));
    await userEvent.click(within(screen.getByRole("group", { name: "Changes outside the company" })).getByRole("button", { name: /Changes elsewhere/ }));
    await userEvent.type(screen.getByPlaceholderText(/Money leaving the company/), "Unattended outside changes need a person");
    await userEvent.click(screen.getByRole("button", { name: /Save the rule/ }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const sent = onCreate.mock.calls[0]![0];
    expect(sent.subject).toBe("task");
    expect(sent.effect).toBe("require_approval");
    expect(sent.conditions).toEqual({ startedBy: "schedule", writesExternally: true });
  });

  it("sends no narrowing when none is chosen, so the rule applies to any work", async () => {
    const onCreate = compose();

    await userEvent.type(screen.getByPlaceholderText(/Money leaving the company/), "Every step needs a person");
    await userEvent.click(screen.getByRole("button", { name: /Save the rule/ }));

    expect(onCreate.mock.calls[0]![0].conditions).toEqual({});
  });

  it("never offers conditions for knowledge, and never sends them", async () => {
    const onCreate = compose();

    await userEvent.click(screen.getByRole("button", { name: /Knowledge capture/ }));
    expect(screen.queryByRole("group", { name: "Who started the work" })).toBeNull();

    await userEvent.type(screen.getByPlaceholderText(/Money leaving the company/), "Hold lessons for review");
    await userEvent.click(screen.getByRole("button", { name: /Save the rule/ }));

    expect(onCreate.mock.calls[0]![0]).not.toHaveProperty("conditions");
  });
});

describe("reading a rule with conditions", () => {
  const rule = (overrides: Partial<PolicyItem>): PolicyItem => ({
    id: "p1",
    organizationId: "o",
    name: "Rule",
    description: "",
    subject: "task",
    scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [] },
    effect: "require_approval",
    risk: "high",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
    ...overrides,
  });

  it("says when the rule applies in the same sentence as what it does", () => {
    expect(policySentence(rule({ conditions: { startedBy: "schedule", writesExternally: true } }))).toBe(
      "Everything the company does, only when a schedule started the work and the step changes something outside the company — stops for a person first.",
    );
    expect(policySentence(rule({ subject: "tool", effect: "deny", conditions: { writesExternally: true } }))).toBe(
      "Everything the company does, only when the call changes something outside the company — never permitted.",
    );
  });

  it("says nothing extra for a rule not narrowed by circumstance", () => {
    expect(conditionPhrase(rule({}))).toBeUndefined();
    expect(conditionPhrase(rule({ conditions: {} }))).toBeUndefined();
    expect(policySentence(rule({}))).toBe("Everything the company does — stops for a person first.");
  });
});
