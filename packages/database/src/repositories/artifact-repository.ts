import type {
  Artifact,
  ArtifactId,
  TaskId,
  WorkId,
} from "@unioffice/core";

export interface ArtifactRepository {
  create(artifact: Artifact): Promise<Artifact>;

  findById(id: ArtifactId): Promise<Artifact | null>;

  findByWork(workId: WorkId): Promise<Artifact[]>;

  findByTask(taskId: TaskId): Promise<Artifact[]>;
}
