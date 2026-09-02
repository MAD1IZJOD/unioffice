import type {
  Event,
  Task,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  EventRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

export class WorkQueryService {
  constructor(
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventRepository: EventRepository,
  ) {}

  async getWork(workId: WorkId): Promise<Work> {
    const work = await this.workRepository.findById(workId);

    if (!work) {
      throw new Error(`Work not found: ${workId}`);
    }

    return work;
  }

  async getTasks(workId: WorkId): Promise<Task[]> {
    await this.getWork(workId);

    return this.taskRepository.findByWork(workId);
  }

  async getEvents(workId: WorkId): Promise<Event[]> {
    await this.getWork(workId);

    return this.eventRepository.findByWork(workId);
  }
}
