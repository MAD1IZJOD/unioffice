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
   * The tasks belonging to several work items at once.
   *
   * The company overview needs every task of every live and recently finished
   * mission to work out who is doing what. Asking per mission was one network
   * round trip each - fourteen of them on a company with a fortnight of
   * history, which is how a dashboard read came to take the better part of a
   * minute.
   */
  findByWorkIds(workIds: WorkId[]): Promise<Task[]>;

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
