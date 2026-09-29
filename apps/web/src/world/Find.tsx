import { useId, useMemo, useState, type FocusEvent, type KeyboardEvent } from "react";

import { Search } from "lucide-react";

import type { WorldSnapshot } from "../lib/api";

import { searchWorld, type SearchHit } from "./search";

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  agent: "Agent",
  room: "Room",
  mission: "Mission",
  result: "Result",
  handoff: "Handoff",
};

const keyOf = (hit: SearchHit) =>
  hit.select.kind === "handoff" ? `handoff:${hit.select.key}` : `${hit.select.kind}:${hit.select.id}`;

/**
 * Finding something in the office by name.
 *
 * It looks only through the snapshot already on screen, so it can never
 * turn up anything the map could not show. Picking a hit does what clicking
 * the thing would: selects it, and brings it into view on the map. Enter
 * picks the first hit; Escape clears the search.
 */
export function Find({ snapshot, onPick }: { snapshot: WorldSnapshot; onPick: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => searchWorld(snapshot, query), [snapshot, query]);
  const listId = useId();
  const searching = open && query.trim().length > 0;

  const pick = (hit: SearchHit) => {
    onPick(hit);
    setQuery("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setQuery("");
      return;
    }

    if (event.key === "Enter" && hits[0]) {
      event.preventDefault();
      pick(hits[0]);
    }
  };

  // The hits stay open while focus is anywhere inside the search, so moving
  // from the field to a hit does not close them on the way.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  return (
    <div className="world-find" role="search" onFocus={() => setOpen(true)} onBlur={onBlur}>
      <label className="world-find-field">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Find an agent, room, mission or result"
          aria-label="Find in the office"
          aria-controls={searching && hits.length > 0 ? listId : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
        />
      </label>

      {searching &&
        (hits.length === 0 ? (
          <p className="world-find-hits world-find-empty" role="status">
            Nothing in the office matches “{query.trim()}”.
          </p>
        ) : (
          <ul id={listId} className="world-find-hits" aria-label="Matches">
            {hits.map((hit) => (
              <li key={keyOf(hit)}>
                <button type="button" onClick={() => pick(hit)}>
                  <span className="world-find-kind">{KIND_LABEL[hit.kind]}</span>{" "}
                  <span className="world-find-label">{hit.label}</span>{" "}
                  <span className="world-find-detail">{hit.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
