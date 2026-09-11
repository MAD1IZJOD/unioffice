import { useEffect, useRef, useState } from "react";

import { streamUrl, type ActivityEvent } from "./api";

import { useResource, type Resource } from "./useResource";

/**
 * Watching the company rather than asking it again.
 *
 * The API keeps the connection open and pushes the events it writes. A
 * surface learns that something happened and re-reads itself; it never
 * rebuilds state from the feed, because then there would be two descriptions
 * of what a mission is and they would drift apart on the first event this
 * file had not learned to interpret.
 *
 * Polling does not go away - it becomes the safety net. Connected, a surface
 * checks itself every thirty seconds in case a write landed while the socket
 * was being re-established. Disconnected, it falls back to the interval it
 * used before any of this existed, so a browser or proxy that will not hold
 * an EventSource open degrades to exactly the old behaviour.
 */

/** How long new events are gathered before one reload is issued. */
const COALESCE_MS = 220;

/** The safety net behind a healthy connection. */
const CONNECTED_POLL_MS = 30_000;

/** Enough recent events to narrate from; not a second copy of the log. */
const MAX_BUFFERED_EVENTS = 60;

/**
 * How long a channel with no subscribers is kept before it is closed.
 *
 * StrictMode mounts, unmounts and remounts every component in development, and
 * navigation unmounts one surface a beat before the next one mounts. Without
 * this, both would tear down a working connection and immediately open
 * another - so the grace period is not an optimisation, it is what stops the
 * channel flapping on every route change.
 */
const LINGER_MS = 400;

export type LiveStatus = "connecting" | "live" | "offline";

interface Channel {
  source: EventSource;
  events: Set<(events: ActivityEvent[]) => void>;
  status: Set<(status: LiveStatus) => void>;
  current: LiveStatus;
  closing?: ReturnType<typeof setTimeout>;
}

/**
 * One connection per thing being watched, shared by everything watching it.
 *
 * The shell watches the whole company and so does the Command Center, which
 * is one channel between them rather than two identical streams delivering
 * the same bytes twice to the same tab.
 */
const channels = new Map<string, Channel>();

function join(
  workId: string | undefined,
  onEvents: (events: ActivityEvent[]) => void,
  onStatus: (status: LiveStatus) => void,
): () => void {
  const key = workId ?? "";
  let channel = channels.get(key);

  if (channel) {
    clearTimeout(channel.closing);
    channel.closing = undefined;
  } else {
    const source = new EventSource(streamUrl({ workId }));

    const created: Channel = {
      source,
      events: new Set(),
      status: new Set(),
      current: "connecting",
    };

    const announce = (status: LiveStatus) => {
      created.current = status;
      created.status.forEach((listener) => listener(status));
    };

    source.addEventListener("open", () => announce("live"));

    source.addEventListener("activity", (message) => {
      let batch: unknown;

      try {
        batch = (
          JSON.parse((message as MessageEvent<string>).data) as {
            events: unknown;
          }
        ).events;
      } catch {
        // A frame this build cannot read is not a reason to tear the
        // connection down; the next one is probably fine.
        return;
      }

      if (!Array.isArray(batch) || batch.length === 0) return;

      announce("live");
      created.events.forEach((listener) =>
        listener(batch as ActivityEvent[]),
      );
    });

    // EventSource reconnects on its own. This only records that the channel
    // is not carrying anything right now, which is what decides whether the
    // surfaces behind it fall back to polling quickly.
    source.onerror = () => {
      announce(
        source.readyState === EventSource.CLOSED ? "offline" : "connecting",
      );
    };

    channel = created;
    channels.set(key, created);
  }

  const active = channel;

  active.events.add(onEvents);
  active.status.add(onStatus);
  onStatus(active.current);

  let left = false;

  return () => {
    if (left) return;
    left = true;

    active.events.delete(onEvents);
    active.status.delete(onStatus);

    if (active.events.size > 0) return;

    active.closing = setTimeout(() => {
      if (active.events.size > 0) return;

      active.source.close();

      if (channels.get(key) === active) {
        channels.delete(key);
      }
    }, LINGER_MS);
  };
}

export interface LiveFeed {
  status: LiveStatus;
  /** Increments once per delivered batch. A cheap thing to depend on. */
  revision: number;
  /** The most recent events, newest first. Bounded. */
  events: ActivityEvent[];
  lastEventAt?: string;
}

/**
 * Subscribes to the live channel and reports what arrives.
 *
 * `workId` narrows it server-side, so a mission's tab is not sent the whole
 * company's log only to throw most of it away.
 */
export function useLiveFeed(
  options: { workId?: string; enabled?: boolean } = {},
): LiveFeed {
  const { workId, enabled = true } = options;

  const [connection, setConnection] = useState<LiveStatus>("connecting");
  const [revision, setRevision] = useState(0);
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  // Pointing the feed somewhere else starts it over. Adjusted during render -
  // React's documented alternative to an effect for state derived from
  // something the component already has - so the first paint after the change
  // does not show the previous mission's events as if they were this one's.
  const [watching, setWatching] = useState(workId);

  if (watching !== workId) {
    setWatching(workId);
    setConnection("connecting");
    setRevision(0);
    setEvents([]);
  }

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;

    return join(
      workId,
      (batch) => {
        setEvents((current) =>
          [...batch].reverse().concat(current).slice(0, MAX_BUFFERED_EVENTS),
        );

        setRevision((current) => current + 1);
      },
      setConnection,
    );
  }, [enabled, workId]);

  return {
    // Derived rather than stored: a disabled feed is offline by definition,
    // and writing that into state would be a render just to agree with it.
    status: enabled ? connection : "offline",
    revision,
    events,
    lastEventAt: events[0]?.timestamp,
  };
}

export interface LiveResource<T> extends Resource<T> {
  /** True while the channel is genuinely carrying events. */
  live: boolean;
  status: LiveStatus;
  /** The events that arrived since this surface last read itself. */
  feed: ActivityEvent[];
}

/**
 * One API read, kept current by the live channel.
 *
 * `load` must be stable (wrap it in useCallback). It is a dependency of the
 * underlying resource, and a new function every render would re-fetch every
 * render.
 */
export function useLiveResource<T>(
  load: () => Promise<T>,
  options: {
    workId?: string;
    /** Used when the channel is not available. */
    fallbackPollMs?: number;
    enabled?: boolean;
  } = {},
): LiveResource<T> {
  const { workId, fallbackPollMs = 8_000, enabled = true } = options;

  const feed = useLiveFeed({ workId, enabled });
  const connected = feed.status === "live";

  const resource = useResource<T>(load, {
    pollMs: connected ? CONNECTED_POLL_MS : fallbackPollMs,
    enabled,
  });

  // useResource memoizes its loader, so this is stable as long as `load` is -
  // which it has to be anyway. No ref needed to reach it from the effect.
  const { reload } = resource;
  const { revision } = feed;

  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (revision === 0) return;

    // A mission that is genuinely busy writes a dozen events in a second.
    // Reloading per event would be a dozen reads of the same row; this makes
    // it one, a fifth of a second behind the last of them.
    clearTimeout(pending.current);

    pending.current = setTimeout(() => reload(), COALESCE_MS);

    return () => clearTimeout(pending.current);
  }, [revision, reload]);

  return {
    ...resource,
    live: connected,
    status: feed.status,
    feed: feed.events,
  };
}
