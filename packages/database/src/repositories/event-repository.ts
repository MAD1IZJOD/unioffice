import type {
  Event,
  WorkId,
} from "@unioffice/core";

export interface EventRepository {
  create(event: Event): Promise<Event>;

  findByWork(workId: WorkId): Promise<Event[]>;
}
