import { Link } from "react-router-dom";

import type { GovernedAgent, GovernedTool } from "../../lib/api";

import {
  accessLabel,
  accessTone,
  readableCapability,
  riskTone,
} from "../../lib/governance";

import { toneClass } from "../../lib/tone";
import { profileOf } from "../../lib/workforce";

import { AgentMark } from "../AgentMark";
import { Chip } from "../primitives";

/**
 * What each agent may actually do.
 *
 * The important column is the one that is easy to get wrong: an agent holding
 * a tool grant is not the same as an agent being permitted to use it. Both
 * are shown, because the gap between them is precisely what governance is
 * for, and hiding it would make a blocked tool look like one that was never
 * granted.
 */
export function GovernedWorkforce({ agents }: { agents: GovernedAgent[] }) {
  return (
    <div className="governed-grid">
      {agents.map((agent) => {
        const granted = agent.tools.filter(
          (tool) => tool.access !== "not_granted",
        );

        return (
          <article key={agent.agentId} className="governed-agent">
            <header className="governed-agent-head">
              <span className="governed-agent-mark">
                <AgentMark
                  agentId={agent.agentId}
                  capabilities={agent.capabilities}
                  tools={granted.length}
                  type={agent.type}
                  size={30}
                />
              </span>

              <span className="min-w-0 flex-1">
                <Link
                  to={`/agents/${agent.agentId}`}
                  className="governed-agent-name"
                >
                  {agent.name}
                </Link>
                <span className="governed-agent-role">
                  {profileOf(agent).label}
                </span>
              </span>

              {agent.policyIds.length > 0 && (
                <Chip tone="active">
                  {agent.policyIds.length}{" "}
                  {agent.policyIds.length === 1 ? "rule" : "rules"}
                </Chip>
              )}
            </header>

            <div className="governed-capabilities">
              {agent.capabilities.map((capability) => (
                <span key={capability} className="governed-capability">
                  {readableCapability(capability)}
                </span>
              ))}
            </div>

            {granted.length === 0 ? (
              <p className="governed-empty">
                Holds no tools. It can only reason and write.
              </p>
            ) : (
              <ul className="governed-tools">
                {granted.map((tool) => (
                  <li
                    key={tool.toolId}
                    className={`governed-tool ${toneClass[accessTone(tool.access)]}`}
                  >
                    <span className="governed-tool-name">{tool.name}</span>

                    <span className="governed-tool-access">
                      {accessLabel(tool.access)}
                    </span>

                    {/* Why, in the backend's own words. A blocked tool that
                        does not say which rule blocked it is an argument
                        waiting to happen. */}
                    <span className="governed-tool-why">{tool.explanation}</span>
                  </li>
                ))}
              </ul>
            )}

            {(agent.deniedCount > 0 || agent.approvalRequiredCount > 0) && (
              <footer className="governed-agent-foot">
                {agent.deniedCount > 0 && (
                  <span className="governed-count governed-count-denied">
                    {agent.deniedCount} blocked
                  </span>
                )}
                {agent.approvalRequiredCount > 0 && (
                  <span className="governed-count">
                    {agent.approvalRequiredCount} sent to a person
                  </span>
                )}
              </footer>
            )}
          </article>
        );
      })}
    </div>
  );
}

/**
 * What each tool is, and who can reach it.
 *
 * "Granted" and "permitted" are shown side by side for the same reason as
 * above: the difference between them is the whole of what a policy did.
 */
export function GovernedTools({ tools }: { tools: GovernedTool[] }) {
  return (
    <div className="tool-grid">
      {tools.map((tool) => (
        <article
          key={tool.toolId}
          className={`governed-tool-card ${toneClass[riskTone(tool.risk)]}`}
        >
          <header className="governed-tool-card-head">
            <span className="governed-tool-card-name">{tool.name}</span>
            <Chip tone={riskTone(tool.risk)}>{tool.risk} risk</Chip>
          </header>

          <p className="governed-tool-card-description">{tool.description}</p>

          <div className="governed-tool-card-facts">
            <Fact
              label="Granted to"
              value={`${tool.grantedAgentCount} ${
                tool.grantedAgentCount === 1 ? "agent" : "agents"
              }`}
            />
            <Fact
              label="Can use it"
              value={`${tool.permittedAgentCount} ${
                tool.permittedAgentCount === 1 ? "agent" : "agents"
              }`}
              // The one number on this card that means something went wrong
              // if it disagrees with the one beside it.
              warn={tool.permittedAgentCount < tool.grantedAgentCount}
            />
            <Fact label="Calls" value={String(tool.callCount)} />
            <Fact
              label="Blocked"
              value={String(tool.blockedCount)}
              warn={tool.blockedCount > 0}
            />
          </div>

          {tool.policyNames.length > 0 && (
            <footer className="governed-tool-card-foot">
              Governed by {tool.policyNames.join(", ")}
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}

function Fact({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className={`governed-fact${warn ? " governed-fact-warn" : ""}`}>
      <span className="governed-fact-value">{value}</span>
      <span className="governed-fact-label">{label}</span>
    </div>
  );
}
