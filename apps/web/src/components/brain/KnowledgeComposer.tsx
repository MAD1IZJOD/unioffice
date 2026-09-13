import { Check, X } from "lucide-react";

import { useState } from "react";

import type { KnowledgeType, WorkspaceSummary } from "../../lib/api";

import { WRITABLE_KINDS } from "../../lib/knowledge";

import { Failure } from "../primitives";

const WEIGHTS = [
  { value: 0.3, label: "Low", hint: "Useful context" },
  { value: 0.5, label: "Normal", hint: "Worth recalling when relevant" },
  { value: 0.75, label: "High", hint: "Should shape related work" },
  { value: 0.95, label: "Critical", hint: "Recalled even when only loosely related" },
];

/**
 * Telling the company something.
 *
 * A person writing knowledge is vouching for it, so it is recorded as current
 * straight away - unless it reads like an instruction to an AI, which the
 * backend holds as a proposal whoever wrote it. The form says so rather than
 * letting that come as a surprise.
 */
export function KnowledgeComposer({
  workspaces,
  busy,
  error,
  onCancel,
  onCreate,
}: {
  workspaces: WorkspaceSummary[];
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onCreate: (input: {
    title: string;
    content: string;
    type: KnowledgeType;
    importance: number;
    workspaceId?: string;
  }) => void;
}) {
  const [type, setType] = useState<KnowledgeType>("decision");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [importance, setImportance] = useState(0.5);
  const [workspaceId, setWorkspaceId] = useState("");

  const ready = title.trim().length >= 3 && content.trim().length >= 3;

  return (
    <section className="composer-sheet" aria-label="Record knowledge">
      <header className="composer-sheet-head">
        <div>
          <div className="t-eyebrow">Record knowledge</div>
          <h3 className="composer-sheet-title">What should the company know?</h3>
        </div>

        <button type="button" onClick={onCancel} className="icon-button" aria-label="Cancel">
          <X size={15} />
        </button>
      </header>

      <div className="composer-sheet-body">
        <div className="policy-field">
          <div className="policy-field-head">
            <span className="policy-field-index">01</span>
            <span className="policy-field-question">What kind of knowledge is it?</span>
          </div>
          <div className="policy-field-body">
            <div className="choice-row">
              {WRITABLE_KINDS.map((kind) => (
                <button
                  key={kind.type}
                  type="button"
                  aria-pressed={type === kind.type}
                  onClick={() => setType(kind.type)}
                  className={`choice${type === kind.type ? " choice-active" : ""} tone-idle`}
                >
                  <span className="choice-label">{kind.label}</span>
                  <span className="choice-detail">{kind.meaning}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="policy-field">
          <div className="policy-field-head">
            <span className="policy-field-index">02</span>
            <span className="policy-field-question">Say it</span>
          </div>
          <p className="policy-field-hint">
            The title states the knowledge itself, not its topic — “Starter is priced at $99”, not “Pricing”.
          </p>
          <div className="policy-field-body">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Starter is priced at $99 per month"
              className="policy-input"
              maxLength={160}
            />
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="The detail an agent needs: when it was decided, why, and where it applies."
              rows={4}
              className="policy-input mt-2"
              maxLength={4000}
            />
          </div>
        </div>

        <div className="policy-field">
          <div className="policy-field-head">
            <span className="policy-field-index">03</span>
            <span className="policy-field-question">How much should it weigh?</span>
          </div>
          <div className="policy-field-body">
            <div className="choice-row">
              {WEIGHTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={importance === option.value}
                  onClick={() => setImportance(option.value)}
                  className={`choice${importance === option.value ? " choice-active" : ""} tone-idle`}
                >
                  <span className="choice-label">{option.label}</span>
                  <span className="choice-detail">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {workspaces.length > 0 && (
          <div className="policy-field">
            <div className="policy-field-head">
              <span className="policy-field-index">04</span>
              <span className="policy-field-question">Where does it apply?</span>
            </div>
            <p className="policy-field-hint">
              Knowledge kept to a workspace is only ever recalled into work running inside it.
            </p>
            <div className="policy-field-body">
              <select
                className="brain-select"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
              >
                <option value="">The whole company</option>
                {workspaces.map((entry) => (
                  <option key={entry.workspace.id} value={entry.workspace.id}>
                    Only {entry.workspace.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4">
            <Failure
              headline="That knowledge was not recorded"
              detail={error}
              consequence="Nothing was written. The Brain is unchanged."
            />
          </div>
        )}
      </div>

      <footer className="composer-sheet-foot">
        <span className="t-machine">Recorded as current, indexed for recall, checked for contradictions</span>

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
                title: title.trim(),
                content: content.trim(),
                type,
                importance,
                workspaceId: workspaceId || undefined,
              })
            }
          >
            <Check size={13} />
            {busy ? "Recording…" : "Record it"}
          </button>
        </div>
      </footer>
    </section>
  );
}
