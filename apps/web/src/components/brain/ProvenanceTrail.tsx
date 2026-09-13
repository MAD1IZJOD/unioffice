import { Link } from "react-router-dom";

import type { KnowledgeDetail } from "../../lib/api";

import { kindLabel, sourceLabel } from "../../lib/knowledge";

interface TrailNode {
  kind: string;
  name: string;
  to?: string;
  self?: boolean;
}

/**
 * Where this knowledge came from, as a chain.
 *
 * Built only from references the backend confirmed belong to this
 * organization. A mission the row points at but that could not be confirmed
 * is simply absent - the trail is shorter, never invented.
 */
export function ProvenanceTrail({ detail }: { detail: KnowledgeDetail }) {
  const { provenance, knowledge } = detail;
  const nodes: TrailNode[] = [];

  if (provenance.mission) {
    nodes.push({
      kind: "Mission",
      name: provenance.mission.objective,
      to: `/missions/${provenance.mission.id}`,
    });
  }

  if (provenance.task) {
    nodes.push({ kind: "Step", name: provenance.task.title });
  }

  if (provenance.agent) {
    nodes.push({
      kind: "Agent",
      name: provenance.agent.name,
      to: `/agents/${provenance.agent.id}`,
    });
  }

  if (provenance.artifact) {
    nodes.push({ kind: "Artifact", name: provenance.artifact.name });
  }

  if (nodes.length === 0) {
    nodes.push({ kind: "Source", name: sourceLabel(provenance.sourceType) });
  }

  nodes.push({ kind: kindLabel(knowledge.type), name: knowledge.title, self: true });

  return (
    <ol className="provenance-trail" aria-label="Where this knowledge came from">
      {nodes.map((node, index) => (
        <li
          key={`${node.kind}-${index}`}
          className={`provenance-node${node.self ? " provenance-node-self" : ""}`}
        >
          <span className="provenance-kind">{node.kind}</span>
          {node.to ? (
            <Link to={node.to} className="provenance-name">
              {node.name}
            </Link>
          ) : (
            <span className="provenance-name">{node.name}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
