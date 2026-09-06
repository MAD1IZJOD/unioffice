import {
  Activity,
  Bell,
  Boxes,
  Brain,
  ChevronRight,
  Command as CommandIcon,
  FileOutput,
  LayoutGrid,
  Menu,
  Network,
  Search,
  Settings,
  ShieldAlert,
  Users,
  Wrench,
  X,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

import { NavLink, Outlet, useLocation } from "react-router-dom";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchOverview,
  formatRelativeTime,
  type CompanyOverview,
} from "./lib/api";

import { useResource } from "./lib/useResource";
import { describeEvent } from "./lib/events";

interface NavEntry {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Where the number beside this surface comes from, if it has one. */
  badge?: (overview: CompanyOverview) => number;
}

/**
 * Navigation grouped by what the person is trying to do, not by which table
 * the data came from. Running the company, staffing it, understanding it, and
 * the machinery underneath are four different intents, and the old flat list
 * of ten equal entries made you read all of them every time.
 */
const NAV_GROUPS: Array<{ label: string; entries: NavEntry[] }> = [
  {
    label: "Operate",
    entries: [
      { label: "Command Center", path: "/command", icon: CommandIcon },
      {
        label: "Work",
        path: "/work",
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
    label: "System",
    entries: [
      { label: "Tools", path: "/tools", icon: Wrench },
      { label: "Artifacts", path: "/artifacts", icon: FileOutput },
      { label: "Governance", path: "/governance", icon: Settings },
    ],
  },
];

const ALL_ENTRIES = NAV_GROUPS.flatMap((group) => group.entries);

/** The group a route belongs to, shown as context in the header. */
function locate(pathname: string): { group: string; title: string } {
  if (pathname.startsWith("/work/")) {
    return { group: "Operate", title: "Work detail" };
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

                      {count > 0 && (
                        <span className="nav-badge">{count}</span>
                      )}
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

  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");

  // The shell reads the same overview every page reads, so the counts in the
  // rail can never disagree with the surface they point at.
  const overview = useResource<CompanyOverview>(
    useCallback(() => fetchOverview(12), []),
    { pollMs: 20_000 },
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
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

  const attention = useMemo(() => {
    const data = overview.data;
    if (!data) return [];

    return [
      ...data.approvals.map((approval) => ({
        id: approval.id,
        tone: "tone-warning",
        label: approval.action,
        detail: approval.reason,
        to: "/approvals",
      })),
      ...data.work.recentlyCompleted
        .filter((work) => work.status === "failed")
        .slice(0, 3)
        .map((work) => ({
          id: work.id,
          tone: "tone-error",
          label: "Work failed",
          detail: work.objective,
          to: `/work/${work.id}`,
        })),
      ...data.activity.slice(0, 2).map((event) => {
        const described = describeEvent(event);
        return {
          id: event.id,
          tone: described.tone,
          label: described.title,
          detail: formatRelativeTime(event.timestamp),
          to: event.workId ? `/work/${event.workId}` : "/activity",
        };
      }),
    ];
  }, [overview.data]);

  const pendingCount = overview.data?.approvals.length ?? 0;

  const paletteResults = useMemo(() => {
    const needle = paletteQuery.trim().toLowerCase();

    const surfaces = ALL_ENTRIES.map((entry) => ({
      key: entry.path,
      label: entry.label,
      path: entry.path,
      icon: entry.icon,
      kind: "Go to",
    }));

    const work = (overview.data?.work.active ?? [])
      .concat(overview.data?.work.recentlyCompleted ?? [])
      .slice(0, 8)
      .map((item) => ({
        key: item.id,
        label: item.objective,
        path: `/work/${item.id}`,
        icon: LayoutGrid,
        kind: "Work",
      }));

    return [...surfaces, ...work].filter(
      (entry) => !needle || entry.label.toLowerCase().includes(needle),
    );
  }, [paletteQuery, overview.data]);

  const { group, title } = locate(location.pathname);

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

        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="icon-button"
          aria-label="Search"
        >
          <Search size={15} />
        </button>
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
                className={`icon-button${pendingCount > 0 ? " icon-button-attention" : ""}`}
                aria-label={`Attention queue, ${pendingCount} awaiting approval`}
                onClick={() => setAttentionOpen((open) => !open)}
              >
                <Bell size={14} />

                {pendingCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#e5484d] px-1 font-mono text-[8px] font-semibold text-white">
                    {pendingCount}
                  </span>
                )}
              </button>

              {attentionOpen && (
                <div className="notification-popover">
                  <div className="flex items-center justify-between border-b border-[#1e232b] px-3 py-2.5">
                    <span className="t-eyebrow">Attention</span>

                    {pendingCount > 0 && (
                      <span className="rounded-sm bg-[rgba(229,72,77,0.1)] px-1.5 py-0.5 font-mono text-[8px] text-[#ff7176]">
                        {pendingCount} WAITING
                      </span>
                    )}
                  </div>

                  <div className="space-y-0.5 p-1.5">
                    {attention.length === 0 ? (
                      <div className="px-2 py-5 text-center text-[10.5px] text-[#6f7887]">
                        Nothing needs you.
                      </div>
                    ) : (
                      attention.slice(0, 6).map((entry) => (
                        <NavLink
                          key={entry.id}
                          to={entry.to}
                          onClick={() => setAttentionOpen(false)}
                          className="notification-item"
                        >
                          <span className={`pill-dot mt-1 ${entry.tone}`} />

                          <span className="min-w-0">
                            <span className="block truncate">{entry.label}</span>

                            {entry.detail && (
                              <span className="mt-0.5 block truncate text-[9.5px] text-[#535b68]">
                                {entry.detail}
                              </span>
                            )}
                          </span>
                        </NavLink>
                      ))
                    )}
                  </div>
                </div>
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

        <section className="page-surface">
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
                onChange={(event) => setPaletteQuery(event.target.value)}
                placeholder="Go to a surface, or find an objective..."
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
                paletteResults.map(({ key, label, path, icon: Icon, kind }) => (
                  <NavLink
                    key={key}
                    to={path}
                    onClick={() => {
                      setCommandOpen(false);
                      setPaletteQuery("");
                    }}
                    className="palette-item"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[#1e232b] bg-[#0e1116] text-[#6f7887]">
                      <Icon size={12} />
                    </span>

                    <span className="min-w-0 flex-1 truncate">{label}</span>

                    <span className="t-machine shrink-0">{kind}</span>
                  </NavLink>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
