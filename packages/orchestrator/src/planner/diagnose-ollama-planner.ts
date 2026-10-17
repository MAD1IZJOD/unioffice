import type {
  AgentId,
  WorkId,
} from "@unioffice/core";

import {
  OllamaModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "@unioffice/agents";

import { OllamaPlanner } from "./ollama-planner.js";

const OBJECTIVE = "Calculate the total of 48,200 and 9,350, then write a one-sentence result.";
const REQUEST_TIMEOUT_MS = 60_000;

function agentIds(count: number): AgentId[] {
  return Array.from({ length: count }, (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` as AgentId,
  );
}

async function measure(label: string, count: number): Promise<void> {
  const ids = agentIds(count);
  const provider = new OllamaModelProvider({ timeoutMs: REQUEST_TIMEOUT_MS });
  let request: ModelRequest | undefined;
  let response: ModelResponse | undefined;
  const startedAt = performance.now();

  try {
    const plan = await new OllamaPlanner({
      async generate(nextRequest) {
        request = nextRequest;
        response = await provider.generate(nextRequest);
        return response;
      },
    }).plan({
      workId: "10000000-0000-4000-8000-000000000001" as WorkId,
      objective: OBJECTIVE,
      availableAgentIds: ids,
      availableTools: [{
        id: "calculator",
        name: "Calculator",
        description: "Evaluates arithmetic expressions exactly.",
      }],
      availableCapabilities: ["calculation", "writing"],
      context: {},
    });

    console.log(JSON.stringify({
      label,
      agentCount: count,
      elapsedMs: Math.round(performance.now() - startedAt),
      timeToFirstResponseMs: null,
      systemChars: request?.messages[0]?.content.length,
      userChars: request?.messages[1]?.content.length,
      inputTokens: response?.usage?.inputTokens,
      outputTokens: response?.usage?.outputTokens,
      totalDurationNs: response?.metadata.totalDuration,
      taskCount: plan.tasks.length,
      assignmentsValid: plan.tasks.every(
        (task) => !task.assignedAgentId || ids.includes(task.assignedAgentId),
      ),
      tasks: plan.tasks.map((task) => ({
        ref: task.ref,
        requiredCapabilities: task.requiredCapabilities,
        requiredTools: task.requiredTools,
        dependencyCount: task.dependsOn.length,
      })),
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      label,
      agentCount: count,
      elapsedMs: Math.round(performance.now() - startedAt),
      timeToFirstResponseMs: null,
      systemChars: request?.messages[0]?.content.length,
      userChars: request?.messages[1]?.content.length,
      inputTokens: response?.usage?.inputTokens,
      outputTokens: response?.usage?.outputTokens,
      totalDurationNs: response?.metadata.totalDuration,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
  }
}

await measure("small", 3);
await measure("full", 71);
