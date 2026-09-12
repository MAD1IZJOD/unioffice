import { Check, X } from "lucide-react";

import { useState } from "react";

import type {
  AgentSummary,
  NewPolicy,
  PolicyEffect,
  PolicySubject,
  RiskLevel,
  ToolDescriptor,
  WorkspaceSummary,
} from "../../lib/api";

import { effectLabel } from "../../lib/governance";
import { toneClass } from "../../lib/tone";

import { Failure } from "../primitives";

/**
 * Writing a rule.
 *
 * The form asks the four questions a policy actually is, in the order a
 * person thinks them: what is this about, who does it cover, what happens,
 * and how much is at stake. It never shows a schema - no effect enum, no
 * scope object, no subject discriminator - because a control surface that
 * makes you understand its storage before you can constrain your own company
 * is not a control surface.
 *
 * Everything it offers comes from the backend: the real roster, the real tool
 * registry, the real workspaces. There is no way to write a rule here that
 * names something that does not exist.
 */

const RISKS: Array<{ value: RiskLevel; label: string; hint: string }> = [
  { value: "low", label: "Low", hint: "Routine. Nothing to worry about." },
  { value: "medium", label: "Medium", hint: "Worth knowing it happened." },
  { value: "high", label: "High", hint: "Consequential if it goes wrong." },
  {
    value: "critical",
    label: "Critical",
    hint: "The company should not do this unattended.",
  },
];

export function PolicyComposer({
  agents,
  tools,
  workspaces,
  busy,
  error,
  onCancel,
  onCreate,
}: {
  agents: AgentSummary[];
  tools: ToolDescriptor[];
  workspaces: WorkspaceSummary[];
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onCreate: (policy: NewPolicy) => void;
}) {
  const [subject, setSubject] = useState<PolicySubject>("task");
  const [effect, setEffect] = useState<PolicyEffect>("require_approval");
  const [risk, setRisk] = useState<RiskLevel>("medium");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [approvalPrompt, setApprovalPrompt] = useState("");

  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);

  // A tool rule cannot stop for a person: by the time a tool is called the
  // agent is mid-reasoning and there is nothing to suspend. The backend
  // refuses to save one, so the option is not offered rather than being
  // offered and then rejected.
  const effects: PolicyEffect[] =
    subject === "tool"
      ? ["deny", "allow"]
      : ["deny", "require_approval", "allow"];

  if (!effects.includes(effect)) {
    setEffect("deny");
  }

  const everyCapability = [
    ...new Set(agents.flatMap((agent) => agent.capabilities)),
  ].sort();

  const ready = name.trim().length > 0;

  return (
    <section className="composer-sheet" aria-label="Write a policy">
      <header className="composer-sheet-head">
        <div>
          <div className="t-eyebrow">Write a rule</div>
          <h3 className="composer-sheet-title">
            What should the company not do on its own?
          </h3>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="icon-button"
          aria-label="Cancel"
        >
          <X size={15} />
        </button>
      </header>

      <div className="composer-sheet-body">
        <Field
          index="01"
          question="What is this rule about?"
          hint="A whole step stops before an agent starts it. A tool call is stopped at the moment it is made."
        >
          <div className="choice-row">
            <Choice
              active={subject === "task"}
              onClick={() => setSubject("task")}
              label="Whole steps"
              detail="Checked before any agent begins"
            />
            <Choice
              active={subject === "tool"}
              onClick={() => setSubject("tool")}
              label="Tool calls"
              detail="Checked at the moment a tool runs"
            />
          </div>
        </Field>

        <Field
          index="02"
          question="Who does it cover?"
          hint="Leave everything blank and the rule covers the whole company. Each narrowing is an 'any of'; together they must all match."
        >
          <Picker
            label="Agents"
            empty="Every agent"
            options={agents.map((agent) => ({
              id: agent.id,
              label: agent.name,
            }))}
            selected={agentIds}
            onChange={setAgentIds}
          />

          <Picker
            label={subject === "tool" ? "Tools" : "Steps needing"}
            empty={subject === "tool" ? "Every tool" : "Any step"}
            options={tools.map((tool) => ({ id: tool.id, label: tool.name }))}
            selected={toolIds}
            onChange={setToolIds}
          />

          <Picker
            label="Disciplines"
            empty="Any discipline"
            options={everyCapability.map((capability) => ({
              id: capability,
              label: capability.replace(/_/g, " "),
            }))}
            selected={capabilities}
            onChange={setCapabilities}
          />

          {workspaces.length > 0 && (
            <Picker
              label="Workspaces"
              empty="Every workspace"
              options={workspaces.map((entry) => ({
                id: entry.workspace.id,
                label: entry.workspace.name,
              }))}
              selected={workspaceIds}
              onChange={setWorkspaceIds}
            />
          )}
        </Field>

        <Field
          index="03"
          question="What happens when it matches?"
          hint="A rule that stops something always beats one that permits it, however they are written."
        >
          <div className="choice-row">
            {effects.map((option) => (
              <Choice
                key={option}
                active={effect === option}
                onClick={() => setEffect(option)}
                tone={
                  option === "deny"
                    ? "error"
                    : option === "require_approval"
                      ? "warning"
                      : "live"
                }
                label={effectLabel(option)}
                detail={
                  option === "deny"
                    ? "The step or call does not happen"
                    : option === "require_approval"
                      ? "Execution waits for your decision"
                      : "Recorded as explicitly permitted"
                }
              />
            ))}
          </div>
        </Field>

        <Field
          index="04"
          question="How much is at stake?"
          hint="Risk does not decide anything on its own. It is what a person reads when the rule fires."
        >
          <div className="choice-row">
            {RISKS.map((option) => (
              <Choice
                key={option.value}
                active={risk === option.value}
                onClick={() => setRisk(option.value)}
                label={option.label}
                detail={option.hint}
              />
            ))}
          </div>
        </Field>

        <Field index="05" question="Name it">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Money leaving the company is a person's decision"
            className="policy-input"
            maxLength={120}
          />

          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Why this rule exists. Whoever it stops will read this."
            rows={2}
            className="policy-input mt-2"
          />

          {effect === "require_approval" && (
            <textarea
              value={approvalPrompt}
              onChange={(event) => setApprovalPrompt(event.target.value)}
              placeholder="What to ask the person deciding. Leave blank to use the description."
              rows={2}
              className="policy-input mt-2"
            />
          )}
        </Field>

        {error && (
          <div className="mt-4">
            <Failure
              headline="That rule was not saved"
              detail={error}
              consequence="Nothing was changed. The company is governed exactly as it was."
            />
          </div>
        )}
      </div>

      <footer className="composer-sheet-foot">
        {/* A new rule is a draft. One that started enforcing the moment it
            was typed would make this form a live control surface, and a
            half-finished scope would stop real work. */}
        <span className="t-machine">Saved as a draft — activate it when ready</span>

        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="button-quiet">
            Cancel
          </button>

          <button
            type="button"
            disabled={!ready || busy}
            className="button-primary"
            onClick={() =>
              onCreate({
                name: name.trim(),
                description: description.trim(),
                subject,
                effect,
                risk,
                approvalPrompt: approvalPrompt.trim() || undefined,
                scope: { agentIds, toolIds, workspaceIds, capabilities },
              })
            }
          >
            <Check size={13} />
            {busy ? "Saving…" : "Save the rule"}
          </button>
        </div>
      </footer>
    </section>
  );
}

function Field({
  index,
  question,
  hint,
  children,
}: {
  index: string;
  question: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="policy-field">
      <div className="policy-field-head">
        <span className="policy-field-index">{index}</span>
        <span className="policy-field-question">{question}</span>
      </div>

      {hint && <p className="policy-field-hint">{hint}</p>}

      <div className="policy-field-body">{children}</div>
    </div>
  );
}

function Choice({
  active,
  onClick,
  label,
  detail,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  detail: string;
  tone?: "error" | "warning" | "live";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`choice${active ? " choice-active" : ""} ${
        tone ? toneClass[tone] : "tone-idle"
      }`}
    >
      <span className="choice-label">{label}</span>
      <span className="choice-detail">{detail}</span>
    </button>
  );
}

/**
 * Nothing selected means "not narrowed this way", and the empty label says so
 * rather than leaving a blank row that reads as "none".
 */
function Picker({
  label,
  empty,
  options,
  selected,
  onChange,
}: {
  label: string;
  empty: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div className="picker">
      <div className="picker-head">
        <span className="picker-label">{label}</span>
        <span className="picker-state">
          {selected.length === 0 ? empty : `${selected.length} selected`}
        </span>
      </div>

      <div className="picker-options">
        {options.map((option) => {
          const active = selected.includes(option.id);

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((entry) => entry !== option.id)
                    : [...selected, option.id],
                )
              }
              className={`picker-option${active ? " picker-option-active" : ""}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
