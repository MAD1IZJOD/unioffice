import { ArrowLeft, Archive, Pencil, Play, RotateCcw, ShieldAlert } from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  createSkill,
  fetchSkill,
  fetchTools,
  fetchWorkspaces,
  formatRelativeTime,
  setSkillStatus,
  updateSkill,
  type SkillDraft,
  type SkillItem,
  type ToolDescriptor,
  type WorkspaceSummary,
} from "../lib/api";

import { useCan } from "../lib/access";
import { CATEGORY_LABEL, skillPath, skillStanding } from "../lib/skills";
import { useResource } from "../lib/useResource";

import { Connecting, Failure, StatusPill } from "../components/primitives";
import { SkillEditor, type SkillEditorResult } from "../components/SkillEditor";

const EMPTY_DRAFT: SkillDraft = {
  slug: "",
  name: "",
  description: "",
  category: "operations",
  instructions: "",
  inputs: [],
  outputs: [],
  requiredTools: [],
  requiredCapabilities: [],
  approval: "none",
  memory: "recall",
};

function draftOf(skill: SkillItem): SkillDraft {
  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    instructions: skill.instructions,
    inputs: skill.inputs,
    outputs: skill.outputs,
    requiredTools: skill.requiredTools,
    requiredCapabilities: skill.requiredCapabilities,
    approval: skill.approval,
    memory: skill.memory,
  };
}

/** Writing a new skill, optionally starting from a system skill to replace it. */
export function NewSkill() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = params.get("from");
  const canManage = useCan("skills.manage");

  const base = useResource<SkillItem | null>(
    useCallback(() => (from ? fetchSkill(from) : Promise.resolve(null)), [from]),
  );
  const tools = useResource<ToolDescriptor[]>(useCallback(() => fetchTools(), []), { enabled: canManage });
  const workspaces = useResource<WorkspaceSummary[]>(useCallback(() => fetchWorkspaces(), []), { enabled: canManage });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!canManage) {
    return (
      <div className="mx-auto max-w-[980px] pt-6">
        <Failure
          headline="Your role cannot write skills"
          detail="Owners and admins write the company's skills. You can still read every skill in the catalogue."
          action={<Link to="/skills" className="button-quiet">Skills</Link>}
        />
      </div>
    );
  }

  if (base.loading || tools.loading || workspaces.loading) {
    return <div className="mx-auto max-w-[980px]"><Connecting what="Preparing the editor…" /></div>;
  }

  async function submit(result: SkillEditorResult) {
    setBusy(true);
    setError(undefined);

    try {
      const created = await createSkill(result.draft, { workspaceId: result.workspaceId, status: result.status });
      navigate(skillPath(created));
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[980px] fade-up">
      <Link to="/skills" className="button-quiet mb-6 mt-4 inline-flex">
        <ArrowLeft size={12} />
        Skills
      </Link>

      <h2 className="t-page-title">{base.data ? `Replace ${base.data.name} for the company` : "New skill"}</h2>
      <p className="t-body mt-2 max-w-[68ch]">
        A skill describes how a kind of work is done. It is offered to the planner only once it is active and an agent
        that already meets its requirements holds it.
      </p>

      <SkillEditor
        mode="create"
        initial={base.data ? draftOf(base.data) : EMPTY_DRAFT}
        tools={tools.data ?? []}
        workspaces={workspaces.data ?? []}
        busy={busy}
        error={error}
        onSubmit={(result) => void submit(result)}
        onCancel={() => navigate("/skills")}
      />
    </div>
  );
}

/** One skill: its procedure, what it needs, who holds it, and its standing. */
export default function Skill() {
  const { skillRef = "" } = useParams();
  const canManage = useCan("skills.manage");

  const skill = useResource<SkillItem>(useCallback(() => fetchSkill(skillRef), [skillRef]), { enabled: Boolean(skillRef) });
  const tools = useResource<ToolDescriptor[]>(useCallback(() => fetchTools(), []), { enabled: canManage });

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (skill.loading) {
    return <div className="mx-auto max-w-[1240px]"><Connecting what="Opening the skill…" /></div>;
  }

  if (skill.error || !skill.data) {
    const missing = skill.error?.status === 404;

    return (
      <div className="mx-auto max-w-[1240px] pt-4">
        <Failure
          headline={missing ? "This skill is not here" : "UNIOFFICE couldn't open this skill"}
          detail={missing
            ? "No skill with this reference exists for this company, or it belongs to a workspace you have not been given."
            : (skill.error?.message ?? "The API returned nothing for this skill.")}
          action={
            <>
              {!missing && <button type="button" className="button-ghost" onClick={skill.reload}>Try again</button>}
              <Link to="/skills" className="button-quiet">Skills</Link>
            </>
          }
        />
      </div>
    );
  }

  const current = skill.data;
  const standing = skillStanding(current);
  const editable = canManage && current.scope !== "system";

  async function act(change: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);

    try {
      await change();
      setEditing(false);
      skill.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-up">
      <header className={`place tone-${standing.tone}`}>
        <div className="place-inner">
          <Link to="/skills" className="button-quiet mb-6 inline-flex">
            <ArrowLeft size={12} />
            Skills
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="place-name">{current.name}</h2>
            <StatusPill tone={standing.tone}>{standing.label}</StatusPill>
          </div>

          <p className="place-description">{current.description}</p>

          <div className="place-slug">
            {CATEGORY_LABEL[current.category]} · {current.slug} · version {current.version}
            {current.scope !== "system" && ` · updated ${formatRelativeTime(current.updatedAt)}`}
          </div>

          {current.overriddenBy && (
            <p className="config-hint mt-4 max-w-[68ch]">
              The company replaced this skill with its own:{" "}
              <Link to={skillPath(current.overriddenBy)} className="text-blue-ink">{current.overriddenBy.name}</Link>.
              Plans and agents use that one.
            </p>
          )}

          {current.overrides === "system" && current.status === "active" && (
            <p className="config-hint mt-4 max-w-[68ch]">This replaces the system skill with the same slug for the company.</p>
          )}

          {(canManage && !editing) && (
            <div className="mt-7 flex flex-wrap items-center gap-2">
              {editable && current.status !== "archived" && (
                <button type="button" className="button-ghost" disabled={busy} onClick={() => setEditing(true)}>
                  <Pencil size={12} />
                  Edit
                </button>
              )}
              {editable && current.status === "draft" && (
                <button type="button" className="button-primary" disabled={busy} onClick={() => void act(() => setSkillStatus(current.id, "active", current.version))}>
                  <Play size={12} />
                  Activate
                </button>
              )}
              {editable && current.status === "active" && (
                <button type="button" className="button-quiet" disabled={busy} onClick={() => void act(() => setSkillStatus(current.id, "archived", current.version))}>
                  <Archive size={12} />
                  Archive
                </button>
              )}
              {editable && current.status === "archived" && (
                <button type="button" className="button-quiet" disabled={busy} onClick={() => void act(() => setSkillStatus(current.id, "draft", current.version))}>
                  <RotateCcw size={12} />
                  Restore as draft
                </button>
              )}
              {current.scope === "system" && !current.overriddenBy && (
                <Link to={`/skills/new?from=${encodeURIComponent(current.id)}`} className="button-ghost">
                  <Pencil size={12} />
                  Adapt for the company
                </Link>
              )}
            </div>
          )}

          {error && !editing && (
            <div className="mt-4 max-w-[68ch]">
              <Failure headline="That change was not made" detail={error} />
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1240px]">
        {editing ? (
          <SkillEditor
            mode="edit"
            initial={draftOf(current)}
            tools={tools.data ?? []}
            workspaces={[]}
            busy={busy}
            error={error}
            onSubmit={(result) => void act(() => updateSkill(current.id, result.draft, current.version))}
            onCancel={() => {
              setEditing(false);
              setError(undefined);
            }}
          />
        ) : (
          <div className="dossier">
            <div className="min-w-0">
              <section className="dossier-block" aria-label="Procedure">
                <div className="dossier-question">How the work is done</div>
                <div className="skill-procedure">{current.instructions}</div>
                <p className="dossier-answer">
                  Agents read this as guidance for the step. It cannot change their rules, tools or permissions.
                </p>
              </section>

              <section className="dossier-block" aria-label="Inputs and outputs">
                <div className="dossier-question">Works from</div>
                <Fields fields={current.inputs} empty="Whatever the step is given." />
                <div className="dossier-question mt-6">Produces</div>
                <Fields fields={current.outputs} empty="A plain answer." />
              </section>

              <section className="dossier-block" aria-label="Requirements">
                <div className="dossier-question">What an agent needs</div>
                <div className="token-set">
                  {current.requiredTools.map((tool) => <span key={tool} className="token token-tool">{tool}</span>)}
                  {current.requiredCapabilities.map((capability) => <span key={capability} className="token">{capability.replace(/_/g, " ")}</span>)}
                  {current.requiredTools.length + current.requiredCapabilities.length === 0 && <span className="token">Nothing beyond being assigned it</span>}
                </div>
                <p className="dossier-answer">
                  {current.approval === "required" ? (
                    <>
                      <ShieldAlert size={11} className="mr-1 inline align-[-1px]" />
                      Every step that follows this skill waits for an owner or admin to approve it.
                    </>
                  ) : "Governance decides each step as usual; the skill adds no approval of its own."}{" "}
                  {current.memory === "none"
                    ? "Steps work only from what they are given - no company knowledge is recalled."
                    : "Steps are handed the company knowledge relevant to them."}
                </p>
              </section>

              <section className="dossier-block" aria-label="Agents">
                <div className="dossier-question">Who holds it</div>
                {current.agents.length === 0 ? (
                  <p className="dossier-answer">No agent holds this skill, so the planner never offers it. Assign it on an agent's profile.</p>
                ) : (
                  <div className="agent-tools">
                    {current.agents.map((agent) => (
                      <div key={agent.id} className={`agent-tool ${agent.fits ? "tone-live" : "tone-warning"}`}>
                        <Link to={`/workforce/${agent.id}`} className="agent-tool-name">{agent.name}</Link>
                        <StatusPill tone={agent.fits ? "live" : "warning"}>{agent.fits ? "Can use it" : "Cannot use it"}</StatusPill>
                        <span className="agent-tool-why">
                          {agent.fits
                            ? "Holds every tool and capability it needs."
                            : `Missing ${[...agent.missingTools, ...agent.missingCapabilities].join(", ")}.`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Fields({ fields, empty }: { fields: SkillItem["inputs"]; empty: string }) {
  if (fields.length === 0) {
    return <p className="dossier-answer">{empty}</p>;
  }

  return (
    <div className="skill-fields">
      {fields.map((field) => (
        <div key={field.name} className="skill-field">
          <span className="skill-field-name">{field.name}{field.required ? "" : " (optional)"}</span>
          <span>{field.description} <span className="t-machine">{field.type}</span></span>
        </div>
      ))}
    </div>
  );
}
