import type {
  Event,
  OrganizationId,
} from "@unioffice/core";

import type {
  EventTailRepository,
} from "@unioffice/database";

export interface ExecutionStreamOptions {
  /** How often a watched organization's log is read forward. */
  tailIntervalMs?: number;

  /**
   * How far back each read reaches beyond the cursor.
   *
   * The API and the worker are separate processes with separate clocks, and
   * an event is stamped by whichever one recorded it. Without an overlap a
   * worker running a few hundred milliseconds behind the API would write
   * events the tail had already read past. The overlap re-reads them and the
   * seen-id set throws the duplicates away.
   */
  lookbackMs?: number;

  /** Most events one read will return. */
  batchLimit?: number;

  log?: (message: string) => void;
}

export type ExecutionStreamListener = (events: Event[]) => void;

export interface ExecutionStreamSubscription {
  close(): void;
}

const DEFAULT_TAIL_INTERVAL_MS = 1_000;
const DEFAULT_LOOKBACK_MS = 5_000;
const DEFAULT_BATCH_LIMIT = 200;

/**
 * Remembering more ids than a single batch can hold, so an event seen in one
 * read is still recognised in the next overlapping one.
 */
const SEEN_CAPACITY = 600;

interface OrganizationTail {
  listeners: Set<ExecutionStreamListener>;
  cursor: Date;
  seen: Set<string>;
  timer: ReturnType<typeof setInterval>;
  reading: boolean;
}

/**
 * One reader of the event log, shared by everyone watching the company.
 *
 * The alternative - every open tab polling every surface it renders - is what
 * this replaces. Ten tabs watching four missions used to be forty independent
 * reads on their own clocks; this is one read per second per organization, and
 * none at all when nobody is watching, because the tail only exists while it
 * has listeners.
 *
 * It carries no business logic and derives no state. It reports that rows were
 * written, which is the one thing the browser cannot find out for itself, and
 * leaves what those rows mean to the services that already decide that.
 */
export class ExecutionStream {
  private readonly tailIntervalMs: number;
  private readonly lookbackMs: number;
  private readonly batchLimit: number;
  private readonly log: (message: string) => void;

  private readonly tails = new Map<OrganizationId, OrganizationTail>();

  constructor(
    private readonly eventTailRepository: EventTailRepository,
    options: ExecutionStreamOptions = {},
  ) {
    this.tailIntervalMs = options.tailIntervalMs ?? DEFAULT_TAIL_INTERVAL_MS;
    this.lookbackMs = options.lookbackMs ?? DEFAULT_LOOKBACK_MS;
    this.batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;
    this.log = options.log ?? (() => {});
  }

  /** How many organizations are currently being read. Used by tests. */
  get watchedCount(): number {
    return this.tails.size;
  }

  /**
   * Starts receiving events recorded from now on.
   *
   * Deliberately not a replay: the history of a mission or a company is
   * already a plain read, and serving it twice through two mechanisms is how
   * the two end up disagreeing. This says what is new.
   */
  subscribe(
    organizationId: OrganizationId,
    listener: ExecutionStreamListener,
  ): ExecutionStreamSubscription {
    const tail = this.tails.get(organizationId) ?? this.open(organizationId);

    tail.listeners.add(listener);

    let closed = false;

    return {
      close: () => {
        // Guarded because a dropped connection can fire close twice, and the
        // second call would otherwise decide the tail has no listeners left
        // while another subscriber is still attached.
        if (closed) return;
        closed = true;

        tail.listeners.delete(listener);

        if (tail.listeners.size === 0) {
          clearInterval(tail.timer);
          this.tails.delete(organizationId);
        }
      },
    };
  }

  /** Reads every watched organization once. Exposed so tests need no timers. */
  async tick(): Promise<void> {
    await Promise.all(
      [...this.tails.keys()].map((organizationId) => this.read(organizationId)),
    );
  }

  /** Stops every tail. Called when the server shuts down. */
  stop(): void {
    for (const tail of this.tails.values()) {
      clearInterval(tail.timer);
      tail.listeners.clear();
    }

    this.tails.clear();
  }

  private open(organizationId: OrganizationId): OrganizationTail {
    const tail: OrganizationTail = {
      listeners: new Set(),
      cursor: new Date(),
      seen: new Set(),
      reading: false,
      timer: setInterval(() => {
        void this.read(organizationId);
      }, this.tailIntervalMs),
    };

    // Nothing should be kept alive by a poll; the process must be able to
    // exit while a tail is still notionally running.
    tail.timer.unref?.();

    this.tails.set(organizationId, tail);

    return tail;
  }

  private async read(organizationId: OrganizationId): Promise<void> {
    const tail = this.tails.get(organizationId);

    if (!tail || tail.reading) {
      // A read slower than the interval must not stack up behind itself; a
      // database having a bad minute would otherwise queue reads until it had
      // a worse one.
      return;
    }

    tail.reading = true;

    try {
      const since = new Date(tail.cursor.getTime() - this.lookbackMs);
      const events = await this.eventTailRepository.findSince(
        organizationId,
        since,
        this.batchLimit,
      );

      const fresh = events.filter((event) => !tail.seen.has(event.id));

      for (const event of events) {
        tail.seen.add(event.id);

        if (event.timestamp.getTime() > tail.cursor.getTime()) {
          tail.cursor = event.timestamp;
        }
      }

      this.prune(tail);

      if (fresh.length === 0) return;

      for (const listener of tail.listeners) {
        try {
          listener(fresh);
        } catch (error) {
          // One broken subscriber must not stop the others being told.
          this.log(`Stream listener failed: ${messageOf(error)}`);
        }
      }
    } catch (error) {
      // A failed read is not fatal. The cursor is untouched, so the next read
      // covers the same ground and nothing is skipped.
      this.log(`Could not tail events: ${messageOf(error)}`);
    } finally {
      tail.reading = false;
    }
  }

  private prune(tail: OrganizationTail): void {
    if (tail.seen.size <= SEEN_CAPACITY) return;

    // Sets iterate in insertion order, so the oldest ids go first - and they
    // are the ones furthest outside the lookback window, which is exactly the
    // set that can no longer come back.
    const excess = tail.seen.size - SEEN_CAPACITY;
    let removed = 0;

    for (const id of tail.seen) {
      tail.seen.delete(id);
      if (++removed >= excess) break;
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
