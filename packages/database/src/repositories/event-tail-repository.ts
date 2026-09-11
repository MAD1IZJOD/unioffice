import type {
  Event,
  OrganizationId,
} from "@unioffice/core";

/**
 * Reading the event log forwards.
 *
 * This is deliberately not part of EventRepository. Every other consumer of
 * the log - the overview, a workspace, an agent's history - asks "what has
 * happened", and answers it once per request. Tailing asks "what has happened
 * since I last looked", repeatedly, on behalf of connected clients, and is the
 * only caller that needs a cursor. Keeping it as its own port means the half
 * dozen services that read events never have to know the stream exists.
 */
export interface EventTailRepository {
  /**
   * Events at or after `since`, oldest first.
   *
   * Inclusive on purpose. Event timestamps come from whichever process
   * recorded them, so two events can share a millisecond and a worker's clock
   * can sit slightly behind the API's. An exclusive cursor drops those; the
   * caller de-duplicates by id instead, which loses nothing.
   */
  findSince(
    organizationId: OrganizationId,
    since: Date,
    limit?: number,
  ): Promise<Event[]>;
}
