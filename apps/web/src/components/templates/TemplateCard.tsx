import { ArrowRight } from "lucide-react";

import { Link } from "react-router-dom";

import type { MissionTemplateView } from "../../lib/api";
import { COMPLEXITY_DETAIL, COMPLEXITY_LABEL } from "../../lib/templates";

import { Chip, StatusPill } from "../primitives";

/**
 * One kind of mission the company knows how to start.
 *
 * Everything on the card is read from the API: the likely team is the real
 * roster matched on capability, and the approval line counts the active rules
 * that could stop that team. What actually gets planned - and whether a rule
 * fires - is decided later, by the orchestrator and by governance.
 */
export function TemplateCard({
  view,
  index,
}: {
  view: MissionTemplateView;
  index: number;
}) {
  const { template, likelyTeam, planner, governance } = view;
  const team = [planner?.name, ...likelyTeam.map((member) => member.name)].filter(Boolean);
  const gating = governance.gatingPolicies.length;

  return (
    <article className="template-card" aria-labelledby={`template-${template.id}`}>
      <div className="template-card-head">
        <span className="template-card-index">{String(index + 1).padStart(2, "0")}</span>
        <Chip tone="idle" title={COMPLEXITY_DETAIL[template.complexity]}>
          {COMPLEXITY_LABEL[template.complexity]}
        </Chip>
      </div>

      <h3 id={`template-${template.id}`} className="template-card-name">
        {template.name}
      </h3>

      <p className="template-card-purpose">{template.purpose}</p>

      <dl className="template-card-facts">
        <div>
          <dt>Leaves behind</dt>
          <dd>{template.outcome}</dd>
        </div>

        <div>
          <dt>Likely team</dt>
          <dd>
            {team.length > 0
              ? team.join(" · ")
              : "Nobody on the roster holds these disciplines yet"}
          </dd>
        </div>
      </dl>

      <div className="template-card-foot">
        {gating > 0 ? (
          <span
            title={governance.gatingPolicies.map((policy) => policy.name).join(", ")}
          >
            <StatusPill tone="warning">
              {gating === 1 ? "A rule may ask for approval" : `${gating} rules may ask for approval`}
            </StatusPill>
          </span>
        ) : (
          <span className="t-machine">No rule gates this team today</span>
        )}

        <Link
          to={`/missions/new/${template.id}`}
          className="button-primary template-card-start"
          aria-label={`Start mission: ${template.name}`}
        >
          Start mission
          <ArrowRight size={12} />
        </Link>
      </div>
    </article>
  );
}
