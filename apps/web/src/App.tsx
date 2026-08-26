import {
  Activity,
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

import { useState } from "react";

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
            >
              <Search size={14} />

              <span>Search</span>

              <kbd>Ctrl K</kbd>
            </button>

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
    </div>
  );
}
