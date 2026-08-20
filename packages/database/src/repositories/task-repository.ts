import type {
  Task,
  TaskId,
  WorkId,
} from "@unioffice/core";

export interface TaskRepository {
  create(task: Task): Promise<Task>;

  findById(id: TaskId): Promise<Task | null>;

  findByWork(workId: WorkId): Promise<Task[]>;

  update(task: Task): Promise<Task>;

  delete(id: TaskId): Promise<void>;
}