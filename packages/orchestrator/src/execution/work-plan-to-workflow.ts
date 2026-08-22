import {
  createEntityId,
  type WorkflowId,
} from "@unioffice/core";

import type {
  WorkflowDefinition,
} from "@unioffice/workflows";

import type {
  WorkPlan,
} from "../planner/planner.js";

export function workPlanToWorkflow(
  plan: WorkPlan,
): WorkflowDefinition {
  const workflowId =
    createEntityId<"WorkflowId">() as WorkflowId;

  return {
    id: workflowId,

    workId: plan.workId,

    name: `Workflow for ${plan.workId}`,

    description:
      "Generated from an orchestrator work plan.",

    nodes: plan.tasks.map((task) => ({
      id: `task:${task.id}`,

      type: "task",

      name: task.title,

      taskId: task.id,

      dependsOn: task.dependsOn.map(
        (dependencyId) =>
          `task:${dependencyId}`,
      ),

      metadata: {
        description: task.description,
        assignedAgentId:
          task.assignedAgentId,
        ...task.metadata,
      },
    })),

    metadata: {},
  };
}