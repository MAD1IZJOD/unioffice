import type { AgentSummary } from "./api";

/**
 * What kind of work an agent does, derived from the capabilities the backend
 * actually granted it.
 *
 * The workforce needs to look like six distinct people rather than six copies
 * of one avatar, but hard-coding a look per name would be decoration that
 * stops being true the moment the seed changes. So the discipline is computed
 * from the routing vocabulary the delegator itself uses: an agent draws and
 * reads as an engineer because it genuinely holds the engineering
 * capabilities, not because someone typed its name into a lookup table.
 */
export type Discipline =
  | "orchestration"
  | "engineering"
  | "quantitative"
  | "research"
  | "operations"
  | "communication"
  | "general";

/**
 * Capabilities that discriminate. `decision_support` and `writing` are shared
 * by several agents, so they are deliberately absent - counting them would
 * pull every specialist towards whichever discipline claimed them.
 */
const CAPABILITY_DISCIPLINE: Record<string, Discipline> = {
  planning: "orchestration",
  coordination: "orchestration",
  coding: "engineering",
  technical_design: "engineering",
  data_transformation: "engineering",
  calculation: "quantitative",
  financial_analysis: "quantitative",
  research: "research",
  synthesis: "research",
  people_operations: "operations",
  process_design: "operations",
  communication: "communication",
  stakeholder_messaging: "communication",
};

export interface DisciplineProfile {
  /** Shown as the agent's role, in place of the raw agent type. */
  label: string;
  /** One line naming the job, used under the agent's name. */
  role: string;
  /** The shape the agent's mark is drawn as. */
  figure: Discipline;
}

export const DISCIPLINES: Record<Discipline, DisciplineProfile> = {
  orchestration: {
    label: "Orchestration",
    role: "Plans the work and routes it",
    figure: "orchestration",
  },
  engineering: {
    label: "Engineering",
    role: "Builds and transforms",
    figure: "engineering",
  },
  quantitative: {
    label: "Quantitative",
    role: "Measures and calculates",
    figure: "quantitative",
  },
  research: {
    label: "Research",
    role: "Reads, synthesises, writes",
    figure: "research",
  },
  operations: {
    label: "Operations",
    role: "Designs how the work runs",
    figure: "operations",
  },
  communication: {
    label: "Communication",
    role: "Turns work into messages",
    figure: "communication",
  },
  general: {
    label: "Specialist",
    role: "General assignment",
    figure: "general",
  },
};

export function disciplineOf(agent: {
  type?: string;
  capabilities?: string[];
}): Discipline {
  const scores = new Map<Discipline, number>();

  for (const capability of agent.capabilities ?? []) {
    const discipline = CAPABILITY_DISCIPLINE[capability];
    if (!discipline) continue;
    scores.set(discipline, (scores.get(discipline) ?? 0) + 1);
  }

  // An orchestrator is an orchestrator even if it also plans and analyses;
  // the type is the stronger signal when the backend states it.
  if (agent.type === "orchestrator") return "orchestration";

  let best: Discipline = "general";
  let bestScore = 0;

  for (const [discipline, score] of scores) {
    if (score > bestScore) {
      best = discipline;
      bestScore = score;
    }
  }

  return best;
}

export function profileOf(agent: {
  type?: string;
  capabilities?: string[];
}): DisciplineProfile {
  return DISCIPLINES[disciplineOf(agent)];
}

/** Groups a roster by discipline, in a stable reading order. */
export const DISCIPLINE_ORDER: Discipline[] = [
  "orchestration",
  "engineering",
  "quantitative",
  "research",
  "operations",
  "communication",
  "general",
];

export function groupByDiscipline<T extends { type?: string; capabilities?: string[] }>(
  agents: T[],
): Array<{ discipline: Discipline; profile: DisciplineProfile; members: T[] }> {
  return DISCIPLINE_ORDER.map((discipline) => ({
    discipline,
    profile: DISCIPLINES[discipline],
    members: agents.filter((agent) => disciplineOf(agent) === discipline),
  })).filter((group) => group.members.length > 0);
}

/** The agent an id belongs to, for attributing work to a name. */
export function agentNamed(
  agents: Array<Pick<AgentSummary, "id" | "name">>,
  id: string | undefined,
): string | undefined {
  if (!id) return undefined;
  return agents.find((agent) => agent.id === id)?.name;
}
