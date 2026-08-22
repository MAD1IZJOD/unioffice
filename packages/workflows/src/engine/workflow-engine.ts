import type {
  WorkflowId,
} from "@unioffice/core";

import type {
  WorkflowDefinition,
  WorkflowNode,
} from "../definitions/workflow-definition.js";

export type WorkflowNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkflowNodeState {
  nodeId: string;

  status: WorkflowNodeStatus;
}

export interface WorkflowState {
  workflowId: WorkflowId;

  nodes: WorkflowNodeState[];

  status:
    | "pending"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled";
}

export interface WorkflowEngine {
  initialize(
    definition: WorkflowDefinition,
  ): WorkflowState;

  getReadyNodes(
    definition: WorkflowDefinition,
    state: WorkflowState,
  ): WorkflowNode[];

  transitionNode(
    state: WorkflowState,
    nodeId: string,
    status: WorkflowNodeStatus,
  ): WorkflowState;
}

export class DefaultWorkflowEngine
  implements WorkflowEngine
{
  initialize(
    definition: WorkflowDefinition,
  ): WorkflowState {
    return {
      workflowId: definition.id,

      nodes: definition.nodes.map((node) => ({
        nodeId: node.id,
        status: "pending",
      })),

      status: "pending",
    };
  }

  getReadyNodes(
    definition: WorkflowDefinition,
    state: WorkflowState,
  ): WorkflowNode[] {
    return definition.nodes.filter((node) => {
      const nodeState = state.nodes.find(
        (item) => item.nodeId === node.id,
      );

      if (!nodeState || nodeState.status !== "pending") {
        return false;
      }

      return node.dependsOn.every(
        (dependencyId) => {
          const dependency = state.nodes.find(
            (item) =>
              item.nodeId === dependencyId,
          );

          return (
            dependency?.status === "completed"
          );
        },
      );
    });
  }

  transitionNode(
    state: WorkflowState,
    nodeId: string,
    status: WorkflowNodeStatus,
  ): WorkflowState {
    const node = state.nodes.find(
      (item) => item.nodeId === nodeId,
    );

    if (!node) {
      throw new Error(
        `Workflow node not found: ${nodeId}`,
      );
    }

    if (!this.isValidTransition(
      node.status,
      status,
    )) {
      throw new Error(
        `Invalid workflow transition: ${node.status} -> ${status}`,
      );
    }

    const nodes = state.nodes.map(
      (item) =>
        item.nodeId === nodeId
          ? { ...item, status }
          : item,
    );

    return {
      ...state,
      nodes,
      status: this.calculateWorkflowStatus(
        nodes,
      ),
    };
  }

  private isValidTransition(
    from: WorkflowNodeStatus,
    to: WorkflowNodeStatus,
  ): boolean {
    const transitions: Record<
      WorkflowNodeStatus,
      WorkflowNodeStatus[]
    > = {
      pending: ["ready", "cancelled"],
      ready: ["running", "cancelled"],
      running: [
        "completed",
        "failed",
        "waiting",
        "cancelled",
      ],
      waiting: [
        "ready",
        "failed",
        "cancelled",
      ],
      completed: [],
      failed: [],
      cancelled: [],
    };

    return transitions[from].includes(to);
  }

  private calculateWorkflowStatus(
    nodes: WorkflowNodeState[],
  ): WorkflowState["status"] {
    if (
      nodes.some(
        (node) => node.status === "failed",
      )
    ) {
      return "failed";
    }

    if (
      nodes.length > 0 &&
      nodes.every(
        (node) => node.status === "completed",
      )
    ) {
      return "completed";
    }

    if (
      nodes.some(
        (node) => node.status === "waiting",
      )
    ) {
      return "waiting";
    }

    if (
      nodes.some(
        (node) =>
          node.status === "running" ||
          node.status === "ready",
      )
    ) {
      return "running";
    }

    return "pending";
  }
}