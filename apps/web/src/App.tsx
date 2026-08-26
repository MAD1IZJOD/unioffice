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
  const renderNavigation = (
    items: typeof navigation,
  ) =>
    items.map(([label, path, Icon]) => (
      <NavLink
        key={path}
        to={path}
        onClick={onNavigate}
        className={({ isActive }) =>
          [
            "group flex items-center gap-3 rounded-xl px-3 py-2.5",
            "border transition-all duration-200",
            isActive
              ? "border-cyan-400/15 bg-cyan-400/[0.08] text-cyan-200"
              : "border-transparent text-slate-500 hover:border-white/[0.05] hover:bg-white/[0.035] hover:text-slate-200",
          ].join(" ")
        }
      >
        {({ isActive }) => (
          <>
            <Icon
              size={16}
              strokeWidth={1.7}
              className={
                isActive
                  ? "text-cyan-300"
                  : "text-slate-600 group-hover:text-slate-400"
              }
            />

            <span className="text-[11px] font-medium tracking-[0.08em]">
              {label}
            </span>

            {isActive && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.8)]" />
            )}
          </>
        )}
      </NavLink>
    ));

  return (
    <>
      {renderNavigation(navigation)}

      <div className="mb-3 mt-8 px-3 font-mono-ui text-[9px] uppercase tracking-[0.18em] text-slate-600">
        Organization
      </div>

      {organizationNavigation.map(
        ([label, path, Icon]) => (
          <NavLink
            key={path}
            to={path}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-xl px-3 py-2.5",
                "border transition-all duration-200",
                isActive
                  ? "border-cyan-400/15 bg-cyan-400/[0.08] text-cyan-200"
                  : "border-transparent text-slate-500 hover:border-white/[0.05] hover:bg-white/[0.035] hover:text-slate-200",
              ].join(" ")
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={16}
                  strokeWidth={1.7}
                  className={
                    isActive
                      ? "text-cyan-300"
                      : "text-slate-600 group-hover:text-slate-400"
                  }
                />

                <span className="text-[11px] font-medium tracking-[0.08em]">
                  {label}
                </span>

                {isActive && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.8)]" />
                )}
              </>
            )}
          </NavLink>
        ),
      )}
    </>
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
    <div className="app-shell min-h-screen bg-[#06090c] text-[#e6edf3]">
      {/* Desktop sidebar */}
      <aside className="sidebar fixed inset-y-0 left-0 z-40 hidden w-[260px] flex-col border-r border-white/[0.07] bg-[#090d11]/95 lg:flex">
        <div className="flex h-[72px] items-center border-b border-white/[0.07] px-5">
          <NavLink
            to="/command"
            className="flex items-center gap-3"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/[0.08]">
              <LayoutDashboard
                size={17}
                className="text-cyan-300"
              />
            </div>

            <div>
              <div className="text-[13px] font-semibold tracking-[0.17em]">
                UNI-OFFICE
              </div>

              <div className="font-mono-ui mt-1 text-[8px] uppercase tracking-[0.2em] text-slate-600">
                AI OPERATING SYSTEM
              </div>
            </div>
          </NavLink>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-5">
          <div className="mb-3 px-3 font-mono-ui text-[9px] uppercase tracking-[0.18em] text-slate-600">
            Workspace
          </div>

          <nav className="space-y-1">
            <Navigation />
          </nav>
        </div>

        <div className="border-t border-white/[0.07] p-3">
          <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
            <div className="relative">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-400/20 bg-emerald-400/10">
                <span className="text-[11px] font-semibold text-emerald-300">
                  M
                </span>
              </div>

              <span className="status-dot status-dot-live absolute -bottom-0.5 -right-0.5 border-2 border-[#090d11]" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium text-slate-200">
                Madhavan
              </div>

              <div className="font-mono-ui text-[9px] text-slate-600">
                ADMIN
              </div>
            </div>

            <ChevronDown
              size={14}
              className="text-slate-600"
            />
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() =>
            setMobileOpen(false)
          }
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col",
          "border-r border-white/[0.07] bg-[#090d11]",
          "transition-transform duration-300 lg:hidden",
          mobileOpen
            ? "translate-x-0"
            : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-[72px] items-center justify-between border-b border-white/[0.07] px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/[0.08]">
              <LayoutDashboard
                size={17}
                className="text-cyan-300"
              />
            </div>

            <span className="text-[13px] font-semibold tracking-[0.17em]">
              UNI-OFFICE
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              setMobileOpen(false)
            }
            className="rounded-lg p-2 text-slate-500 hover:bg-white/[0.04] hover:text-slate-200"
            aria-label="Close navigation"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-5">
          <div className="mb-3 px-3 font-mono-ui text-[9px] uppercase tracking-[0.18em] text-slate-600">
            Workspace
          </div>

          <nav className="space-y-1">
            <Navigation
              onNavigate={() =>
                setMobileOpen(false)
              }
            />
          </nav>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-white/[0.07] bg-[#070a0d]/90 px-4 backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() =>
            setMobileOpen(true)
          }
          className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-2 text-slate-400"
          aria-label="Open navigation"
        >
          <Menu size={17} />
        </button>

        <span className="text-[11px] font-semibold tracking-[0.16em]">
          UNI-OFFICE
        </span>

        <div className="status-dot status-dot-live" />
      </div>

      {/* Main */}
      <main className="main-content min-h-screen">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-white/[0.07] bg-[#070a0d]/80 px-7 backdrop-blur-xl max-lg:mt-14">
          <div>
            <div className="font-mono-ui text-[9px] uppercase tracking-[0.2em] text-slate-600">
              UNI-OFFICE
            </div>

            <h1 className="mt-1 text-[17px] font-semibold tracking-tight text-slate-100">
              {title}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="hidden items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-slate-500 transition hover:border-white/[0.12] hover:text-slate-300 sm:flex"
            >
              <Search size={14} />

              <span className="text-[11px]">
                Search
              </span>

              <kbd className="font-mono-ui rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-slate-600">
                Ctrl K
              </kbd>
            </button>

            <div className="hidden items-center gap-2 rounded-full border border-emerald-400/10 bg-emerald-400/[0.04] px-3 py-1.5 sm:flex">
              <span className="status-dot status-dot-live" />

              <span className="font-mono-ui text-[9px] uppercase tracking-[0.12em] text-emerald-300/80">
                Operational
              </span>
            </div>
          </div>
        </header>

        <section className="grid-background min-h-[calc(100vh-72px)] p-7 max-md:p-4 max-md:pt-6">
          <Outlet />
        </section>
      </main>
    </div>
  );
}