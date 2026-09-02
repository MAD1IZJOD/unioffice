import {
  Activity,
  ArrowUpRight,
  Bell,
  Brain,
  ChevronDown,
  Command,
  FileOutput,
  GitBranch,
  LayoutDashboard,
  Menu,
  Network,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";

import {
  NavLink,
  Outlet,
  useLocation,
} from "react-router-dom";

import {
  useEffect,
  useState,
} from "react";

const navigation = [
  ["COMMAND", "/command", Command],
  ["WORK", "/work", GitBranch],
  ["AGENTS", "/agents", Sparkles],
  ["TOOLS", "/tools", Wrench],
  ["COMPANY BRAIN", "/brain", Brain],
  ["ARTIFACTS", "/artifacts", FileOutput],
  ["APPROVALS", "/approvals", ShieldCheck],
  ["ACTIVITY", "/activity", Activity],
] as const;

const organizationNavigation = [
  ["ORGANIZATION", "/organization", Network],
  ["GOVERNANCE", "/governance", Settings],
] as const;

const pageTitles: Record<string, string> = {
  "/": "Command Center",
  "/command": "Command Center",
  "/work": "Work",
  "/agents": "Agents",
  "/tools": "Tools",
  "/brain": "Company Brain",
  "/artifacts": "Artifacts",
  "/approvals": "Approvals",
  "/activity": "Activity",
  "/organization": "Organization",
  "/governance": "Governance",
};

const quickNavigation = [
  {
    label: "Command Center",
    path: "/command",
    icon: Command,
  },
  {
    label: "Organization map",
    path: "/organization",
    icon: Network,
  },
  {
    label: "Approval queue",
    path: "/approvals",
    icon: ShieldCheck,
  },
  {
    label: "Company Brain",
    path: "/brain",
    icon: Brain,
  },
];

function Navigation({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="space-y-1">
        {navigation.map(([label, path, Icon]) => (
          <NavLink
            key={path}
            to={path}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                "nav-item group",
                isActive
                  ? "nav-item-active"
                  : "nav-item-idle",
              ].join(" ")
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={16}
                  strokeWidth={1.8}
                  className={
                    isActive
                      ? "text-cyan-300"
                      : "text-slate-500 group-hover:text-slate-300"
                  }
                />

                <span>{label}</span>

                {isActive && (
                  <span className="nav-active-indicator" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>

      <div className="sidebar-section-label">
        Organization
      </div>

      <div className="space-y-1">
        {organizationNavigation.map(
          ([label, path, Icon]) => (
            <NavLink
              key={path}
              to={path}
              onClick={onNavigate}
              className={({ isActive }) =>
                [
                  "nav-item group",
                  isActive
                    ? "nav-item-active"
                    : "nav-item-idle",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={16}
                    strokeWidth={1.8}
                    className={
                      isActive
                        ? "text-cyan-300"
                        : "text-slate-500 group-hover:text-slate-300"
                    }
                  />

                  <span>{label}</span>

                  {isActive && (
                    <span className="nav-active-indicator" />
                  )}
                </>
              )}
            </NavLink>
          ),
        )}
      </div>
    </>
  );
}

function UserCard() {
  return (
    <div className="user-card">
      <div className="relative">
        <div className="user-avatar">
          M
        </div>

        <span className="status-dot status-dot-live absolute -bottom-0.5 -right-0.5 border-2 border-[#0b1015]" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-semibold text-slate-200">
          Madhavan
        </div>

        <div className="mt-0.5 font-mono-ui text-[9px] uppercase tracking-[0.12em] text-slate-500">
          Administrator
        </div>
      </div>

      <ChevronDown
        size={14}
        className="text-slate-500"
      />
    </div>
  );
}

export default function App() {
  const location = useLocation();

  const [mobileOpen, setMobileOpen] =
    useState(false);

  const [commandOpen, setCommandOpen] =
    useState(false);

  const [notificationsOpen, setNotificationsOpen] =
    useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setCommandOpen(true);
      }

      if (event.key === "Escape") {
        setCommandOpen(false);
        setNotificationsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () =>
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
  }, []);

  const title =
    pageTitles[location.pathname] ??
    "Operating System";

  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <NavLink
            to="/command"
            className="flex items-center gap-3"
          >
            <div className="brand-icon">
              <LayoutDashboard size={17} />
            </div>

            <div>
              <div className="brand-name">
                UNI-OFFICE
              </div>

              <div className="brand-subtitle">
                AI OPERATING SYSTEM
              </div>
            </div>
          </NavLink>
        </div>

        <div className="sidebar-content">
          <div className="sidebar-section-label mt-0">
            Workspace
          </div>

          <nav>
            <Navigation />
          </nav>
        </div>

        <div className="sidebar-footer">
          <UserCard />
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={[
          "mobile-sidebar",
          mobileOpen
            ? "translate-x-0"
            : "-translate-x-full",
        ].join(" ")}
      >
        <div className="sidebar-brand">
          <div className="flex items-center justify-between">
            <NavLink
              to="/command"
              onClick={() =>
                setMobileOpen(false)
              }
              className="flex items-center gap-3"
            >
              <div className="brand-icon">
                <LayoutDashboard size={17} />
              </div>

              <span className="brand-name">
                UNI-OFFICE
              </span>
            </NavLink>

            <button
              type="button"
              onClick={() =>
                setMobileOpen(false)
              }
              className="icon-button"
              aria-label="Close navigation"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="sidebar-content">
          <div className="sidebar-section-label mt-0">
            Workspace
          </div>

          <nav>
            <Navigation
              onNavigate={() =>
                setMobileOpen(false)
              }
            />
          </nav>
        </div>

        <div className="sidebar-footer">
          <UserCard />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="mobile-topbar">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="icon-button"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>

        <span className="mobile-brand">
          UNI-OFFICE
        </span>

        <span className="status-dot status-dot-live" />
      </div>

      {/* Main */}
      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="topbar-eyebrow">
              UNI-OFFICE / CONTROL PLANE
            </div>

            <h1 className="topbar-title">
              {title}
            </h1>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="search-button"
              onClick={() => setCommandOpen(true)}
            >
              <Search size={14} />

              <span>Search</span>

              <kbd>Ctrl K</kbd>
            </button>

            <div className="relative">
              <button
                type="button"
                className="icon-button relative"
                aria-label="Open notifications"
                onClick={() =>
                  setNotificationsOpen(
                    (isOpen) => !isOpen,
                  )
                }
              >
                <Bell size={15} />

                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.95)]" />
              </button>

              {notificationsOpen && (
                <div className="notification-popover">
                  <div className="flex items-center justify-between border-b border-[#202b35] px-4 py-3">
                    <span className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      Attention queue
                    </span>

                    <span className="rounded-full bg-amber-400/10 px-2 py-1 font-mono-ui text-[8px] text-amber-300">
                      02 NEW
                    </span>
                  </div>

                  <div className="space-y-1 p-2">
                    <NavLink
                      to="/approvals"
                      onClick={() =>
                        setNotificationsOpen(false)
                      }
                      className="notification-item"
                    >
                      <span className="status-dot status-dot-warning" />
                      <span>
                        Two approval gates need review
                      </span>
                    </NavLink>

                    <NavLink
                      to="/work"
                      onClick={() =>
                        setNotificationsOpen(false)
                      }
                      className="notification-item"
                    >
                      <span className="status-dot status-dot-live" />
                      <span>
                        Atlas shared an execution update
                      </span>
                    </NavLink>
                  </div>
                </div>
              )}
            </div>

            <div className="system-status">
              <span className="status-dot status-dot-live" />

              <span>
                SYSTEM OPERATIONAL
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
          aria-label="Quick navigation"
          onClick={() => setCommandOpen(false)}
        >
          <div
            className="command-palette"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-[#263440] px-4 py-4">
              <Search size={16} className="text-cyan-300" />

              <input
                autoFocus
                placeholder="Jump to a system surface..."
                className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-600"
              />

              <kbd className="rounded border border-[#2c3945] px-1.5 py-1 font-mono-ui text-[8px] text-slate-500">
                ESC
              </kbd>
            </div>

            <div className="p-2">
              <div className="px-2 pb-2 pt-1 font-mono-ui text-[8px] uppercase tracking-[0.16em] text-slate-600">
                Navigate
              </div>

              {quickNavigation.map(
                ({ label, path, icon: Icon }) => (
                  <NavLink
                    key={path}
                    to={path}
                    onClick={() => setCommandOpen(false)}
                    className="palette-item"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2a3844] bg-[#10171e] text-slate-400">
                      <Icon size={14} />
                    </span>

                    <span>{label}</span>

                    <ArrowUpRight className="ml-auto text-slate-600" size={14} />
                  </NavLink>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
