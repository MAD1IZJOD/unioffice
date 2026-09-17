import { Minus, Plus } from "lucide-react";

import { useState } from "react";

import type { SkillCategory, SkillDraft, SkillField, ToolDescriptor, WorkspaceSummary } from "../lib/api";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "../lib/skills";

import { Failure } from "./primitives";

const FIELD_TYPES: SkillField["type"][] = ["text", "number", "list", "table"];

export interface SkillEditorResult {
  draft: SkillDraft;
  workspaceId?: string;
  status: "draft" | "active";
}

/**
 * Writing or changing a skill.
 *
 * The form only shapes a request. Everything it sends is validated again on
 * the server - slugs, lengths, fields, that each required tool exists - and a
 * skill written here still cannot give an agent anything it does not hold.
 */
export function SkillEditor({
  initial,
  mode,
  tools,
  workspaces,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial: SkillDraft;
  mode: "create" | "edit";
  tools: ToolDescriptor[];
  workspaces: WorkspaceSummary[];
  busy: boolean;
  error?: string;
  onSubmit: (result: SkillEditorResult) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SkillDraft>(initial);
  const [capabilities, setCapabilities] = useState(initial.requiredCapabilities.join(", "));
  const [workspaceId, setWorkspaceId] = useState("");
  const [status, setStatus] = useState<"draft" | "active">("draft");

  const set = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const slugFromName = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

  function submit() {
    onSubmit({
      draft: {
        ...draft,
        requiredCapabilities: capabilities.split(",").map((entry) => entry.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean),
      },
      workspaceId: mode === "create" && workspaceId ? workspaceId : undefined,
      status,
    });
  }

  return (
    <form
      className="config skill-editor"
      aria-label={mode === "create" ? "New skill" : "Edit skill"}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {error && (
        <div className="mb-4">
          <Failure headline="The skill was not saved" detail={error} consequence="Nothing was changed." />
        </div>
      )}

      <div className="config-row">
        <label className="config-label" htmlFor="skill-name">Name</label>
        <input
          id="skill-name"
          className="config-input"
          value={draft.name}
          maxLength={120}
          required
          onChange={(event) => {
            const name = event.target.value;
            setDraft((current) => ({
              ...current,
              name,
              slug: mode === "create" && (current.slug === "" || current.slug === slugFromName(current.name)) ? slugFromName(name) : current.slug,
            }));
          }}
        />
      </div>

      <div className="config-row">
        <label className="config-label" htmlFor="skill-slug">Slug</label>
        <input
          id="skill-slug"
          className="config-input"
          value={draft.slug}
          maxLength={64}
          required
          disabled={mode === "edit"}
          onChange={(event) => set("slug", event.target.value)}
        />
        <p className="config-hint">
          {mode === "edit"
            ? "A skill keeps its slug. Agents are assigned it, and plans name it, by this."
            : "Use the slug of a system skill to replace that skill for the company."}
        </p>
      </div>

      <div className="config-row">
        <label className="config-label" htmlFor="skill-category">Category</label>
        <select id="skill-category" className="config-input" value={draft.category} onChange={(event) => set("category", event.target.value as SkillCategory)}>
          {CATEGORY_ORDER.map((category) => (
            <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>
          ))}
        </select>
      </div>

      {mode === "create" && workspaces.length > 0 && (
        <div className="config-row">
          <label className="config-label" htmlFor="skill-scope">Applies to</label>
          <select id="skill-scope" className="config-input" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            <option value="">The whole company</option>
            {workspaces.filter((entry) => entry.workspace.status === "active").map((entry) => (
              <option key={entry.workspace.id} value={entry.workspace.id}>Only {entry.workspace.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="config-row">
        <label className="config-label" htmlFor="skill-description">Description</label>
        <input id="skill-description" className="config-input" value={draft.description} maxLength={600} onChange={(event) => set("description", event.target.value)} />
      </div>

      <div className="config-row">
        <label className="config-label" htmlFor="skill-instructions">Procedure</label>
        <textarea
          id="skill-instructions"
          className="config-input"
          value={draft.instructions}
          maxLength={6000}
          required
          onChange={(event) => set("instructions", event.target.value)}
        />
        <p className="config-hint">
          How the work is done. Agents read this as guidance, never as rules: it cannot change what they are allowed to do.
        </p>
      </div>

      <FieldList label="Works from" fields={draft.inputs} onChange={(fields) => set("inputs", fields)} />
      <FieldList label="Produces" fields={draft.outputs} onChange={(fields) => set("outputs", fields)} />

      <div className="config-row">
        <span className="config-label">Required tools</span>
        <div role="group" aria-label="Required tools">
          {tools.map((tool) => (
            <label key={tool.id} className="skill-choice">
              <input
                type="checkbox"
                checked={draft.requiredTools.includes(tool.id)}
                onChange={(event) => set(
                  "requiredTools",
                  event.target.checked
                    ? [...draft.requiredTools, tool.id]
                    : draft.requiredTools.filter((entry) => entry !== tool.id),
                )}
              />
              {tool.name}
            </label>
          ))}
        </div>
        <p className="config-hint">An agent must already hold each of these to be given this skill.</p>
      </div>

      <div className="config-row">
        <label className="config-label" htmlFor="skill-capabilities">Required capabilities</label>
        <input id="skill-capabilities" className="config-input" value={capabilities} onChange={(event) => setCapabilities(event.target.value)} placeholder="financial_analysis" />
      </div>

      <div className="config-row">
        <label className="config-label" htmlFor="skill-approval">Approval</label>
        <select id="skill-approval" className="config-input" value={draft.approval} onChange={(event) => set("approval", event.target.value as SkillDraft["approval"])}>
          <option value="none">As governance decides</option>
          <option value="required">Every step needs an owner or admin to approve</option>
        </select>
      </div>

      <div className="config-row">
        <label className="config-label" htmlFor="skill-memory">Company knowledge</label>
        <select id="skill-memory" className="config-input" value={draft.memory} onChange={(event) => set("memory", event.target.value as SkillDraft["memory"])}>
          <option value="recall">Recall relevant knowledge for each step</option>
          <option value="none">Work only from what the step is given</option>
        </select>
      </div>

      {mode === "create" && (
        <div className="config-row">
          <label className="config-label" htmlFor="skill-status">Start as</label>
          <select id="skill-status" className="config-input" value={status} onChange={(event) => setStatus(event.target.value as "draft" | "active")}>
            <option value="draft">Draft - not used until activated</option>
            <option value="active">Active - in force now</option>
          </select>
        </div>
      )}

      <div className="config-foot">
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? "Saving…" : mode === "create" ? "Create skill" : "Save changes"}
        </button>
        <button type="button" className="button-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function FieldList({ label, fields, onChange }: { label: string; fields: SkillField[]; onChange: (fields: SkillField[]) => void }) {
  const update = (index: number, change: Partial<SkillField>) =>
    onChange(fields.map((field, position) => (position === index ? { ...field, ...change } : field)));

  return (
    <div className="config-row">
      <span className="config-label">{label}</span>
      <div className="skill-fields" role="group" aria-label={label}>
        {fields.map((field, index) => (
          <div key={index} className="skill-field-row">
            <input
              aria-label={`${label} field ${index + 1} name`}
              className="config-input"
              value={field.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <select
              aria-label={`${label} field ${index + 1} type`}
              className="config-input"
              value={field.type}
              onChange={(event) => update(index, { type: event.target.value as SkillField["type"] })}
            >
              {FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <input
              aria-label={`${label} field ${index + 1} description`}
              className="config-input"
              value={field.description}
              onChange={(event) => update(index, { description: event.target.value })}
            />
            <label className="skill-choice !m-0">
              <input type="checkbox" checked={field.required} onChange={(event) => update(index, { required: event.target.checked })} />
              required
            </label>
            <button type="button" className="button-quiet" aria-label={`Remove ${label} field ${index + 1}`} onClick={() => onChange(fields.filter((_, position) => position !== index))}>
              <Minus size={12} />
            </button>
          </div>
        ))}

        {fields.length < 12 && (
          <button
            type="button"
            className="button-quiet self-start"
            onClick={() => onChange([...fields, { name: "", type: "text", description: "", required: true }])}
          >
            <Plus size={12} />
            Add a field
          </button>
        )}
      </div>
    </div>
  );
}
