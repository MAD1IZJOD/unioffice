import {
  DefaultAgentRuntime,
} from "./default-agent-runtime.js";

import {
  OllamaModelProvider,
} from "./ollama-model-provider.js";

import type {
  AgentDefinition,
} from "../definitions/agent-definition.js";

import type {
  AgentExecutionContext,
} from "./agent-runtime.js";

import type {
  AgentId,
  TaskId,
  WorkId,
} from "@unioffice/core";

const definition: AgentDefinition = {
  id: "research-agent",

  name: "Research Agent",

  description:
    "A general-purpose research agent.",

  type: "specialist",

  systemInstructions:
    [
      "You are a research agent inside UNI-OFFICE.",

      "Analyze the user's task carefully.",

      "Break complex requests into logical steps.",

      "Do not claim to have accessed information or tools you did not actually access.",

      "Give concise, useful answers.",
    ].join("\n"),

  capabilities: [
    "research",
    "analysis",
    "summarization",
  ],

  toolIds: [],

  constraints: {},

  metadata: {},
};

const context: AgentExecutionContext = {
  agentId:
    "agent:research" as AgentId,

  taskId:
    "task:test" as TaskId,

  workId:
    "work:test" as WorkId,

  input:
    "Explain why AI agents need tools instead of only an LLM. Give three concrete examples.",

  context: {},
};

const runtime =
  new DefaultAgentRuntime(
    new OllamaModelProvider(),
    {
      model: "qwen3:8b",

      maxTokens: 300,
      think: false ,
    },
  );

const result =
  await runtime.execute(
    definition,
    context,
  );

console.log(
  "Status:",
  result.status,
);

console.log(
  "\nOutput:\n",
  result.output,
);

console.log(
  "\nTool calls:",
  result.toolCalls,
);

console.log(
  "\nMetadata:",
  result.metadata,
);

if (result.error) {
  console.error(
    "\nError:",
    result.error,
  );

  process.exitCode = 1;
}