import { Plus, Search, ShieldAlert } from "lucide-react";

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { fetchSkills, type SkillCategory, type SkillItem } from "../lib/api";
import { useCan } from "../lib/access";
import { CATEGORY_LABEL, CATEGORY_ORDER, matchesSkill, skillPath, skillStanding } from "../lib/skills";
import { useResource } from "../lib/useResource";

import {
  Chapter,
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
  StatusPill,
} from "../components/primitives";

type ScopeFilter = "all" | "system" | "company";

/**
 * What the workforce knows how to do.
 *
 * A tool is something an agent can execute; a skill is how a kind of work is
 * done well - the procedure, what it takes in and produces, and what it needs.
 * The planner names a skill for a step, and the step only goes to an agent
 * that holds the skill and already has everything it requires.
 */
export default function Skills() {
  const canManage = useCan("skills.manage");
  const skills = useResource<SkillItem[]>(useCallback(() => fetchSkills(), []), { pollMs: 60_000 });

  const [category, setCategory] = useState<SkillCategory | "all">("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [query, setQuery] = useState("");

  const all = useMemo(() => skills.data ?? [], [skills.data]);

  const shown = useMemo(() => all
    .filter((skill) => category === "all" || skill.category === category)
    .filter((skill) => scope === "all" || (scope === "system" ? skill.scope === "system" : skill.scope !== "system"))
    .filter((skill) => matchesSkill(skill, query)), [all, category, scope, query]);

  if (skills.error && !skills.data) {
    return (
      <div className="mx-auto max-w-[1240px] pt-6">
        <Failure
          headline="UNIOFFICE couldn't load the skills"
          detail={skills.error.message}
          consequence="Nothing was changed. Agents keep the skills they hold."
          action={<button type="button" className="button-ghost" onClick={skills.reload}>Try again</button>}
        />
      </div>
    );
  }

  const live = all.filter((skill) => skill.status === "active" && !skill.overriddenBy);
  const held = live.filter((skill) => skill.agents.length > 0);
  const gated = live.filter((skill) => skill.approval === "required");

  return (
    <div className="fade-up">
      <PageOpening
        eyebrow="Workforce"
        title="SKILLS"
        lead={skills.loading ? "READING…" : `${live.length} WAYS OF WORKING.`}
        detail="A skill is how a kind of work is done: the procedure, what it takes in, what it produces and what it needs. It never grants a tool or a permission - an agent can only hold a skill it already has everything for."
        action={canManage ? (
          <Link to="/skills/new" className="button-primary">
            <Plus size={12} />
            New skill
          </Link>
        ) : undefined}
        meta={
          <>
            <Reading label="In force" value={skills.loading ? "—" : live.length} tone="active" />
            <Reading label="Held by an agent" value={skills.loading ? "—" : held.length} tone="live" />
            <Reading label="Need approval" value={skills.loading ? "—" : gated.length} tone="warning" />
          </>
        }
      />

      <div className="mx-auto max-w-[1240px]">
        <div className="skill-toolbar">
          <div className="filter-tabs" role="tablist" aria-label="Category">
            {(["all", ...CATEGORY_ORDER] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={category === entry}
                className={`filter-tab ${category === entry ? "filter-tab-active" : ""}`}
                onClick={() => setCategory(entry)}
              >
                {entry === "all" ? "All" : CATEGORY_LABEL[entry]}
              </button>
            ))}
          </div>

          <select aria-label="Where skills come from" className="config-input member-role" value={scope} onChange={(event) => setScope(event.target.value as ScopeFilter)}>
            <option value="all">Every source</option>
            <option value="system">Shipped with UNIOFFICE</option>
            <option value="company">Written by the company</option>
          </select>

          <label className="search-field">
            <Search size={12} aria-hidden="true" />
            <input
              aria-label="Search skills"
              placeholder="Search skills, tools, capabilities"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-ink-primary outline-none"
            />
          </label>
        </div>

        {skills.loading ? (
          <Connecting what="Reading the skills…" />
        ) : shown.length === 0 ? (
          <Quiet
            line={all.length === 0 ? "No skills are available yet." : "No skill matches."}
            detail={all.length === 0 ? "System skills ship with UNIOFFICE; if none are listed, the API could not provide them." : "Try another category, source or search."}
          />
        ) : (
          CATEGORY_ORDER.filter((entry) => shown.some((skill) => skill.category === entry)).map((entry, index) => (
            <section key={entry} aria-label={CATEGORY_LABEL[entry]} className="mb-8">
              <Chapter index={String(index + 1).padStart(2, "0")} title={CATEGORY_LABEL[entry]} />

              <div className="skill-list" role="list">
                {shown.filter((skill) => skill.category === entry).map((skill) => {
                  const standing = skillStanding(skill);

                  return (
                    <Link key={skill.id} to={skillPath(skill)} className="skill-row" role="listitem" aria-label={skill.name}>
                      <span className="min-w-0">
                        <span className="skill-name">{skill.name}</span>
                        <span className="skill-summary block">{skill.description}</span>
                        <span className="skill-requirements">
                          {skill.requiredTools.map((tool) => (
                            <span key={tool} className="token token-tool">{tool}</span>
                          ))}
                          {skill.requiredCapabilities.map((capability) => (
                            <span key={capability} className="token">{capability.replace(/_/g, " ")}</span>
                          ))}
                        </span>
                      </span>

                      <span className="skill-meta">
                        <StatusPill tone={standing.tone}>{standing.label}</StatusPill>
                        <span className="t-meta">
                          {skill.agents.length === 0 ? "No agent holds it" : skill.agents.length === 1 ? `Held by ${skill.agents[0]!.name}` : `Held by ${skill.agents.length} agents`}
                        </span>
                        {skill.approval === "required" && (
                          <span className="t-meta">
                            <ShieldAlert size={10} className="mr-1 inline align-[-1px]" />
                            Every step needs approval
                          </span>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
