import {
  Activity,
  ArrowRight,
  Boxes,
  Brain,
  ChevronRight,
  CircleAlert,
  Command as CommandIcon,
  FileOutput,
  LayoutGrid,
  Menu,
  Network,
  Plus,
  RotateCcw,
  Scale,
  Search,
  ShieldAlert,
  Users,
  Wrench,
  X,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchOverview, type CompanyOverview } from "./lib/api";

import { useResource } from "./lib/useResource";

import {
  attentionTime,
  collectAttention,
  summarizeAttention,
  type AttentionItem,
} from "./lib/attention";

import { toneClass } from "./lib/tone";
import { profileOf } from "./lib/workforce";

interface NavEntry {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Where the number beside this surface comes from, if it has one. */
  badge?: (overview: CompanyOverview) => number;
}

/**
 * Navigation grouped by intent rather than by table.
 *
 * Artifacts moved out of "System" and into an Output group of its own. It was
 * filed next to Tools and Governance, which reads as machinery you configure;
 * it is in fact the pile of things the company made, which is the opposite
 * end of the product and deserves to be found on its own terms.
 */
const NAV_GROUPS: Array<{ label: string; entries: NavEntry[] }> = [
  {
    label: "Operate",
    entries: [
      { label: "Command Center", path: "/command", icon: CommandIcon },
      {
        label: "Missions",
        path: "/missions",
        icon: LayoutGrid,
        badge: (overview) => overview.work.active.length,
      },
      {
        label: "Approvals",
        path: "/approvals",
        icon: ShieldAlert,
        badge: (overview) => overview.approvals.length,
      },
    ],
  },
  {
    label: "Workforce",
    entries: [
      { label: "Agents", path: "/agents", icon: Users },
      { label: "Organization", path: "/organization", icon: Network },
    ],
  },
  {
    label: "Intelligence",
    entries: [
      { label: "Company Brain", path: "/brain", icon: Brain },
      { label: "Activity", path: "/activity", icon: Activity },
    ],
  },
  {
    label: "Output",
    entries: [{ label: "Artifacts", path: "/artifacts", icon: FileOutput }],
  },
  {
    label: "System",
    entries: [
      { label: "Tools", path: "/tools", icon: Wrench },
      { label: "Governance", path: "/governance", icon: Scale },
    ],
  },
];

const ALL_ENTRIES = NAV_GROUPS.flatMap((group) => group.entries);

const ATTENTION_ICON: Record<AttentionItem["kind"], LucideIcon> = {
  decision: ShieldAlert,
  failure: CircleAlert,
  recovering: RotateCcw,
};

/** The group a route belongs to, shown as context in the header. */
function locate(pathname: string): { group: string; title: string } {
  if (pathname === "/missions/new") {
    return { group: "Operate", title: "Open a mission" };
  }

  if (pathname.startsWith("/missions/")) {
    return { group: "Operate", title: "Mission" };
  }

  if (pathname.startsWith("/workspaces/")) {
    return { group: "Workforce", title: "Workspace" };
  }

  if (pathname.startsWith("/agents/")) {
    return { group: "Workforce", title: "Agent" };
  }

  for (const group of NAV_GROUPS) {
    const entry = group.entries.find((candidate) => candidate.path === pathname);

    if (entry) {
      return { group: group.label, title: entry.label };
    }
  }

  return { group: "Operate", title: "Command Center" };
}

function Navigation({
  overview,
  onNavigate,
}: {
  overview?: CompanyOverview;
  onNavigate?: () => void;
}) {
  return (
    <nav>
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="sidebar-section-label">{group.label}</div>

          <div className="space-y-0.5">
            {group.entries.map((entry) => {
              const count = overview ? entry.badge?.(overview) ?? 0 : 0;

              return (
                <NavLink
                  key={entry.path}
                  to={entry.path}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "nav-item-active" : "nav-item-idle"}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <entry.icon
                        size={14}
                        strokeWidth={1.9}
                        className={isActive ? "text-[#84b4fb]" : "opacity-70"}
                      />

                      <span>{entry.label}</span>

                      {count > 0 && <span className="nav-badge">{count}</span>}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <NavLink
      to="/command"
      onClick={onNavigate}
      className="flex items-center gap-2.5"
    >
      <span className="brand-icon">
        <Boxes size={14} strokeWidth={2} />
      </span>

      <span>
        <span className="brand-name block">UNI-OFFICE</span>
        <span className="brand-subtitle block">OPERATING SYSTEM</span>
      </span>
    </NavLink>
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);

  // The shell reads the same overview every page reads, so the counts in the
  // rail can never disagree with the surface they point at.
  const overview = useResource<CompanyOverview>(
    useCallback(() => fetchOverview(12), []),
    { pollMs: 20_000 },
  );

  const attention = useMemo(
    () => collectAttention(overview.data),
    [overview.data],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setCommandOpen(true);
        setPaletteIndex(0);
      }

      // The attention queue is the one thing that must be reachable from
      // anywhere without hunting for it. Alt rather than Ctrl: Ctrl+J is
      // Chrome's downloads shelf, and taking a browser shortcut away from
      // someone is worse than the convenience of owning it.
      if (event.altKey && !event.ctrlKey && !event.metaKey && key === "a") {
        event.preventDefault();
        setAttentionOpen((open) => !open);
      }

      if (event.key === "Escape") {
        setCommandOpen(false);
        setAttentionOpen(false);
        setPaletteQuery("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Navigating anywhere - including with the browser's back button - closes
  // the overlays. Adjusted during render rather than in an effect, which is
  // React's documented way to react to a value the component already has.
  const [lastPath, setLastPath] = useState(location.pathname);

  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMobileOpen(false);
    setAttentionOpen(false);
  }

  // Everything the palette offers is something this build can actually do:
  // an action that exists, a mission that exists, an agent on the roster, or
  // a decision genuinely waiting. Nothing is listed to fill the list out.
  const paletteResults = useMemo(() => {
    const needle = paletteQuery.trim().toLowerCase();
    const data = overview.data;

    const actions = [
      {
        key: "action:new-mission",
        label: "Open a mission",
        path: "/missions/new",
        icon: Plus,
        kind: "Action",
      },
    ];

    const active = (data?.work.active ?? []).map((item) => ({
      key: `mission:${item.id}`,
      label: item.objective,
      path: `/missions/${item.id}`,
      icon: LayoutGrid,
      kind: "Active mission",
    }));

    const recent = (data?.work.recentlyCompleted ?? []).slice(0, 10).map(
      (item) => ({
        key: `mission:${item.id}`,
        label: item.objective,
        path: `/missions/${item.id}`,
        icon: LayoutGrid,
        kind: "Recent mission",
      }),
    );

    const decisions = (data?.approvals ?? []).map((approval) => ({
      key: `approval:${approval.id}`,
      label: approval.action,
      path: `/missions/${approval.workId}`,
      icon: ShieldAlert,
      kind: "Waiting on you",
    }));

    const surfaces = ALL_ENTRIES.map((entry) => ({
      key: `surface:${entry.path}`,
      label: entry.label,
      path: entry.path,
      icon: entry.icon,
      kind: "Surface",
    }));

    const agents = (data?.agents ?? []).map((agent) => ({
      key: `agent:${agent.agentId}`,
      label: `${agent.name} — ${profileOf(agent).label}`,
      path: `/agents/${agent.agentId}`,
      icon: Users,
      kind: "Agent",
    }));

    return [
      ...actions,
      ...decisions,
      ...active,
      ...surfaces,
      ...agents,
      ...recent,
    ].filter((entry) => !needle || entry.label.toLowerCase().includes(needle));
  }, [paletteQuery, overview.data]);

  const { group, title } = locate(location.pathname);
  const attentionCount = attention.length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
        </div>

        <div className="sidebar-content">
          <Navigation overview={overview.data} />
        </div>

        <div className="sidebar-footer">
          <div className="user-card">
            <span className="user-avatar">M</span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-semibold text-[#a7b0bd]">
                Madhavan
              </span>
              <span className="t-machine block">ADMINISTRATOR</span>
            </span>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/75 lg:hidden"
        />
      )}

      <aside
        className={`mobile-sidebar ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="sidebar-brand justify-between">
          <Brand onNavigate={() => setMobileOpen(false)} />

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="icon-button"
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        <div className="sidebar-content">
          <Navigation
            overview={overview.data}
            onNavigate={() => setMobileOpen(false)}
          />
        </div>
      </aside>

      <div className="mobile-topbar">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="icon-button"
          aria-label="Open navigation"
        >
          <Menu size={17} />
        </button>

        <span className="mobile-brand">UNI-OFFICE</span>

        <div className="flex items-center gap-2">
          {/* On a phone the attention queue outranks search, so it stays in
              the bar rather than behind the drawer. */}
          <button
            type="button"
            onClick={() => setAttentionOpen(true)}
            className={`icon-button${attentionCount > 0 ? " icon-button-attention" : ""}`}
            aria-label={`Attention queue, ${attentionCount} items`}
          >
            <ShieldAlert size={15} />
            {attentionCount > 0 && (
              <span className="attention-count">{attentionCount}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="icon-button"
            aria-label="Search"
          >
            <Search size={15} />
          </button>
        </div>
      </div>

      <main className="main-content">
        <header className="topbar">
          <div className="min-w-0">
            <div className="topbar-eyebrow">
              <span>{group}</span>
              <ChevronRight size={9} />
              <span className="text-[#6f7887]">{title}</span>
            </div>

            <h1 className="topbar-title truncate">{title}</h1>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="search-button"
              onClick={() => setCommandOpen(true)}
            >
              <Search size={13} />
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </button>

            <div className="relative">
              <button
                type="button"
                className={`attention-button${attentionCount > 0 ? " attention-button-live" : ""}`}
                aria-expanded={attentionOpen}
                aria-label={`Attention queue, ${attentionCount} items`}
                onClick={() => setAttentionOpen((open) => !open)}
              >
                <ShieldAlert size={13} />
                <span className="attention-button-label">
                  {attentionCount > 0 ? summarizeAttention(attention) : "Clear"}
                </span>
                <kbd>Alt A</kbd>
              </button>

              {attentionOpen && (
                <AttentionPanel
                  items={attention}
                  onClose={() => setAttentionOpen(false)}
                />
              )}
            </div>

            <div
              className={`system-status${overview.error ? " system-status-down" : ""}`}
              title={overview.error?.message}
            >
              <span
                className={`pill-dot ${overview.error ? "tone-error" : "tone-active"}`}
              />
              <span>
                {overview.error
                  ? "OFFLINE"
                  : overview.loading
                    ? "CONNECTING"
                    : "OPERATIONAL"}
              </span>
            </div>
          </div>
        </header>

        {/* Keyed on the path so every navigation replays the page's entrance
            rather than swapping content inside a static frame. */}
        <section className="page-surface" key={location.pathname}>
          <Outlet />
        </section>
      </main>

      {commandOpen && (
        <div
          className="command-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          onClick={() => setCommandOpen(false)}
        >
          <div
            className="command-palette"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-[#1e232b] px-4 py-3.5">
              <Search size={15} className="text-[#84b4fb]" />

              <input
                autoFocus
                value={paletteQuery}
                onChange={(event) => {
                  setPaletteQuery(event.target.value);
                  setPaletteIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setPaletteIndex((index) =>
                      Math.min(index + 1, paletteResults.length - 1),
                    );
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setPaletteIndex((index) => Math.max(index - 1, 0));
                  }

                  if (event.key === "Enter") {
                    const target = paletteResults[paletteIndex];
                    if (!target) return;
                    event.preventDefault();
                    setCommandOpen(false);
                    setPaletteQuery("");
                    navigate(target.path);
                  }
                }}
                placeholder="Open a mission, find one, or go to a surface…"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#f2f4f7] outline-none placeholder:text-[#535b68]"
              />

              <kbd className="rounded-sm border border-[#2a313c] px-1.5 py-0.5 font-mono text-[8px] text-[#535b68]">
                ESC
              </kbd>
            </div>

            <div className="scroll-area max-h-[360px] p-1.5">
              {paletteResults.length === 0 ? (
                <div className="px-2 py-6 text-center text-[11px] text-[#6f7887]">
                  Nothing matches “{paletteQuery}”.
                </div>
              ) : (
                paletteResults.map(
                  ({ key, label, path, icon: Icon, kind }, index) => (
                    <NavLink
                      key={key}
                      to={path}
                      onClick={() => {
                        setCommandOpen(false);
                        setPaletteQuery("");
                      }}
                      onMouseEnter={() => setPaletteIndex(index)}
                      className={`palette-item${index === paletteIndex ? " palette-item-active" : ""}`}
                    >
                      <span className="palette-icon">
                        <Icon size={12} />
                      </span>

                      <span className="min-w-0 flex-1 truncate">{label}</span>

                      <span className="t-machine shrink-0">{kind}</span>
                    </NavLink>
                  ),
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The attention queue.
 *
 * Every entry says what it is, why it stopped and what happens next, because
 * a list of red labels with no consequence attached is just an alarm. The
 * empty state is a full sentence rather than a dash - "nothing needs you" is
 * a genuinely good answer and should read like one.
 */
function AttentionPanel({
  items,
  onClose,
}: {
  items: AttentionItem[];
  onClose: () => void;
}) {
  return (
    <div className="attention-panel" role="region" aria-label="Attention queue">
      <div className="attention-panel-head">
        <span className="t-eyebrow">What needs you</span>

        <span className="t-machine">
          {items.length === 0 ? "CLEAR" : summarizeAttention(items)}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="attention-empty">
          <p>Nothing needs your decision.</p>
          <p className="attention-empty-detail">
            The company runs unattended until it reaches a step it will not
            take on its own.
          </p>
        </div>
      ) : (
        <div className="attention-list">
          {items.slice(0, 8).map((item) => {
            const Icon = ATTENTION_ICON[item.kind];

            return (
              <NavLink
                key={`${item.kind}:${item.id}`}
                to={item.to}
                onClick={onClose}
                className={`attention-item ${toneClass[item.tone]}`}
              >
                <Icon size={13} className="attention-item-icon" />

                <span className="min-w-0 flex-1">
                  <span className="attention-item-label">{item.label}</span>
                  <span className="attention-item-detail">{item.detail}</span>
                  <span className="attention-item-consequence">
                    {item.consequence}
                  </span>
                </span>

                <span className="t-machine shrink-0">
                  {attentionTime(item)}
                </span>
              </NavLink>
            );
          })}

          {items.length > 8 && (
            <NavLink to="/approvals" onClick={onClose} className="attention-more">
              {items.length - 8} more
              <ArrowRight size={11} />
            </NavLink>
          )}
        </div>
      )}
    </div>
  );
}
