import {
  ArrowRight,
  Brain,
  CalendarX2,
  ChevronRight,
  CircleAlert,
  Clock,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  RotateCcw,
  Scale,
  Search,
  ShieldAlert,
  UserX,
  Users,
  Wrench,
  X,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { fetchFeatures, type AttentionItem, type FeatureCatalog } from "./lib/api";
import {
  buildNavigation,
  FALLBACK_FEATURES,
  locate,
  type NavigationContext,
  type NavigationGroup,
} from "./lib/navigation";
import { useResource } from "./lib/useResource";

import {
  useMissionControlResource,
  type ShellOutletContext,
} from "./lib/missionControl";

import {
  attentionPath,
  attentionRun,
  attentionTime,
  attentionTone,
  summarizeAttention,
} from "./lib/attention";

import { useAccess, useCan } from "./lib/access";
import { signOut } from "./lib/session";
import { toneClass } from "./lib/tone";
import { profileOf } from "./lib/workforce";
import { BrandMark } from "./components/BrandMark";

const ATTENTION_ICON: Record<AttentionItem["kind"], LucideIcon> = {
  decision: ShieldAlert,
  governance: Scale,
  configuration: Wrench,
  failure: CircleAlert,
  stalled: Clock,
  agent_unavailable: UserX,
  interrupted: RotateCcw,
  conflict: Brain,
  lessons: Brain,
  recovering: RotateCcw,
  schedule: CalendarX2,
};

function Navigation({
  groups,
  context,
  onNavigate,
}: {
  groups: NavigationGroup[];
  context: NavigationContext;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="sidebar-section-label">{group.label}</div>

          <div className="space-y-0.5">
            {group.entries.map((entry) => {
              const count = entry.badge?.(context) ?? 0;

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
                        className={isActive ? "text-blue-ink" : "opacity-70"}
                      />

                      <span>{entry.label}</span>

                      {entry.status !== "available" && (
                        <span
                          className={`nav-status nav-status-${entry.status}`}
                          title={entry.note ?? undefined}
                          aria-label={entry.status === "limited" ? "Limited" : "Needs configuration"}
                        />
                      )}

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

/** The signed-in person and their role, as the API reported them. */
function UserCard() {
  const access = useAccess();
  const email = access?.me.user.email ?? "";
  const role = access?.me.organization?.role;

  return (
    <div className="user-card">
      <span className="user-avatar">{(email[0] ?? "?").toUpperCase()}</span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-(length:--text-sm) font-semibold text-ink-secondary" title={email}>
          {email || "Signed in"}
        </span>
        {role && <span className="t-machine block">{role.toUpperCase()}</span>}
      </span>

      <button
        type="button"
        className="icon-button"
        aria-label="Sign out"
        title="Sign out"
        onClick={() => void signOut()}
      >
        <LogOut size={13} />
      </button>
    </div>
  );
}

/**
 * The one action the rail always offers: give the company a job. Shown to
 * anyone whose role may open missions somewhere; the page it leads to checks
 * the chosen workspace, and the server checks again.
 */
function RailLaunch({ onNavigate }: { onNavigate?: () => void }) {
  const canCreate = useCan("missions.create");
  if (!canCreate) return null;

  return (
    <NavLink to="/missions/new" end onClick={onNavigate} className="rail-launch">
      <Plus size={14} strokeWidth={2.2} />
      <span>New mission</span>
    </NavLink>
  );
}

function Brand({ onNavigate, version }: { onNavigate?: () => void; version: string }) {
  return (
    <NavLink
      to="/command"
      onClick={onNavigate}
      className="flex items-center gap-2.5"
    >
      <BrandMark />

      <span>
        <span className="brand-name block">UNIOFFICE</span>
        <span className="brand-subtitle block">OPERATING SYSTEM {version}</span>
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

  // One read of the company's operational state for the whole shell. The rail
  // badges, the attention drawer, the palette and the Command Center all show
  // this same answer, and the live channel refreshes it once per burst of
  // activity rather than once per surface.
  const missionControl = useMissionControlResource();

  // What the product can do here, for this person. Rarely changes, so it is
  // read once and refreshed occasionally; until it answers, the rail shows
  // the product's own surfaces.
  const featureCatalog = useResource<FeatureCatalog>(useCallback(() => fetchFeatures(), []), { pollMs: 300_000 });
  const groups = useMemo(
    () => buildNavigation(featureCatalog.data?.features ?? FALLBACK_FEATURES),
    [featureCatalog.data],
  );
  const version = featureCatalog.data?.product.version ?? "2.1";
  const online = useOnline();

  const queue = missionControl.data?.attention;
  const attentionItems = useMemo(() => queue?.items ?? [], [queue]);
  const context = useMemo<NavigationContext>(
    () => ({ missionControl: missionControl.data }),
    [missionControl.data],
  );
  const outletContext: ShellOutletContext = { missionControl };

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
    const data = missionControl.data;

    const actions = [
      {
        key: "action:new-mission",
        label: "New mission",
        path: "/missions/new",
        icon: Plus,
        kind: "Action",
      },
    ];

    const active = [...(data?.running ?? []), ...(data?.blocked ?? [])].map((item) => ({
      key: `mission:${item.id}`,
      label: item.name ?? item.objective,
      path: `/missions/${item.id}`,
      icon: LayoutGrid,
      kind: "Active mission",
    }));

    const recent = (data?.finished ?? []).slice(0, 10).map(
      (item) => ({
        key: `mission:${item.id}`,
        label: item.name ?? item.objective,
        path: `/missions/${item.id}`,
        icon: LayoutGrid,
        kind: "Recent mission",
      }),
    );

    const decisions = attentionItems
      .filter((item) => item.severity === "action" && item.actionable !== false)
      .map((item) => ({
        key: `attention:${item.id}`,
        label: item.label,
        path: attentionPath(item),
        icon: ShieldAlert,
        kind: "Needs you",
      }));

    const surfaces = groups.flatMap((group) => group.entries).map((entry) => ({
      key: `surface:${entry.path}`,
      label: entry.label,
      path: entry.path,
      icon: entry.icon,
      kind: "Surface",
    }));

    const agents = (data?.workforce.roster ?? []).map((agent) => ({
      key: `agent:${agent.agentId}`,
      label: `${agent.name} — ${profileOf(agent).label}`,
      path: `/workforce/${agent.agentId}`,
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
  }, [paletteQuery, missionControl.data, attentionItems, groups]);

  const { group, title } = locate(location.pathname, groups);
  const attentionCount = queue?.actionCount ?? 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand version={version} />
        </div>

        <div className="sidebar-content">
          <RailLaunch />
          <Navigation groups={groups} context={context} />
        </div>

        <div className="sidebar-footer">
          <UserCard />
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
          <Brand version={version} onNavigate={() => setMobileOpen(false)} />

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
          <RailLaunch onNavigate={() => setMobileOpen(false)} />
          <Navigation
            groups={groups}
            context={context}
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

        <span className="mobile-brand">UNIOFFICE</span>

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
              <span className="text-ink-muted">{title}</span>
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
                  {attentionCount > 0
                  ? summarizeAttention(attentionItems)
                  : "Clear"}
                </span>
                <kbd>Alt A</kbd>
              </button>

              {attentionOpen && (
                <AttentionPanel
                  items={attentionItems}
                  onClose={() => setAttentionOpen(false)}
                />
              )}
            </div>

            <div
              className={`system-status${!online || missionControl.error ? " system-status-down" : ""}`}
              role="status"
              title={!online ? "This device has no network connection." : missionControl.error?.message}
            >
              <span
                className={`pill-dot ${!online || missionControl.error ? "tone-error" : "tone-active"}`}
              />
              <span>
                {!online
                  ? "OFFLINE"
                  : missionControl.error
                    ? "RECONNECTING"
                    : missionControl.loading
                      ? "CONNECTING"
                      : "OPERATIONAL"}
              </span>
            </div>
          </div>
        </header>

        {/* Keyed on the path so every navigation replays the page's entrance
            rather than swapping content inside a static frame. */}
        {!online && (
          <div className="shell-banner" role="alert">
            This device is offline. What is on screen may be out of date; UNIOFFICE will refresh when the connection returns.
          </div>
        )}

        <section className="page-surface" key={location.pathname}>
          <Outlet context={outletContext} />
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
            <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
              <Search size={15} className="text-blue-ink" />

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
                placeholder="Start a mission, find one, or go anywhere…"
                className="min-w-0 flex-1 bg-transparent text-(length:--text-base) text-ink-primary outline-none placeholder:text-ink-faint"
              />

              <kbd className="rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-(length:--text-3xs) text-ink-faint">
                ESC
              </kbd>
            </div>

            <div className="scroll-area max-h-[360px] p-1.5">
              {paletteResults.length === 0 ? (
                <div className="px-2 py-6 text-center text-(length:--text-sm) text-ink-muted">
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
                to={attentionPath(item)}
                onClick={onClose}
                className={`attention-item ${toneClass[attentionTone(item)]}`}
              >
                <Icon size={13} className="attention-item-icon" />

                <span className="min-w-0 flex-1">
                  <span className="attention-item-label">{item.label}</span>
                  {item.run && <span className="attention-item-run">{attentionRun(item)}</span>}
                  <span className="attention-item-detail">{item.detail}</span>
                  <span className="attention-item-consequence">
                    {item.severity === "watch" && (
                      <span className="attention-item-tag">no action</span>
                    )}
                    {item.severity === "review" && (
                      <span className="attention-item-tag">worth a look</span>
                    )}
                    {item.actionable === false && (
                      <span className="attention-item-tag">not yours</span>
                    )}
                    {item.actionable === false ? item.handoff ?? item.consequence : item.consequence}
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

/** Whether the browser believes it has a network connection, kept current. */
function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("online", notify);
      window.addEventListener("offline", notify);
      return () => {
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
