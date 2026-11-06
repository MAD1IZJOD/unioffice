import type { Work } from "@unioffice/core";
import type { SupabaseWorkRepository } from "@unioffice/database";

export interface ReconcileResult {
  recoveredWork: Work[];
  interruptedTaskCount: number;
}

/** Closes abandoned API work. The database excludes work owned by the queue. */
export class StaleRunReconciler {
  constructor(
    private readonly workRepository: Pick<SupabaseWorkRepository, "findByStatuses" | "reconcileAbandonedRun">,
    private readonly staleAfterMs = 15 * 60 * 1000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<ReconcileResult> {
    const detectedAt = this.now();
    const cutoff = new Date(detectedAt.getTime() - this.staleAfterMs);
    const candidates = await this.workRepository.findByStatuses(["executing", "planning"]);
    const recoveredWork: Work[] = [];
    let interruptedTaskCount = 0;

    for (const work of candidates) {
      if (work.updatedAt > cutoff) continue;
      const recovered = await this.workRepository.reconcileAbandonedRun(work, cutoff, detectedAt);
      if (!recovered) continue;

      recoveredWork.push(recovered.work);
      interruptedTaskCount += recovered.interruptedTaskCount;
    }

    return { recoveredWork, interruptedTaskCount };
  }
}
