import type {
  AgentId,
  Task,
  TaskId,
  WorkId,
} from "@unioffice/core";

export interface TaskRepository {
  create(task: Task): Promise<Task>;

  findById(id: TaskId): Promise<Task | null>;

  findByWork(workId: WorkId): Promise<Task[]>;

  /**
   * Everything one agent has been given, newest first. The agent detail view
   * needs an agent's whole record, and reading every work item in the
   * organization to find it does not scale past a demo.
   */
  findByAgent(agentId: AgentId, limit?: number): Promise<Task[]>;

  /**
   * Atomically transition a ready task to running. A null result means another
   * executor already changed its state, so callers must not invoke the model.
   */
  claimReadyForExecution(
    id: TaskId,
    startedAt: Date,
  ): Promise<Task | null>;

  update(task: Task): Promise<Task>;

  delete(id: TaskId): Promise<void>;
}
