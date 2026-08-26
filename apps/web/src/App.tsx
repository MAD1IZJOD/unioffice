import {
  Activity,
  Brain,
  ChevronDown,
  Command,
  FileOutput,
  GitBranch,
  LayoutDashboard,
  Network,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";

import {
  NavLink,
  Outlet,
} from "react-router-dom";

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

export default function App() {
  return (
    <div className="app-shell min-h-screen bg-[#070a0d] text-[#e6edf3]">
      <aside className="sidebar fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/[0.07] bg-[#090d11]/95">
        <div className="flex h-[72px] items-center border-b border-white/[0.07] px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10">
              <LayoutDashboard
                size={18}
                className="text-cyan-300"
              />
            </div>

            <div>
              <div className="text-[14px] font-semibold tracking-[0.18em]">
                UNI-OFFICE
              </div>

              <div className="font-mono-ui mt-0.5 text-[9px] uppercase tracking-[0.18em] text-slate-500">
                AI OPERATING SYSTEM
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-5">
          <div className="mb-3 px-3 font-mono-ui text-[9px] uppercase tracking-[0.18em] text-slate-600">
            Workspace
          </div>

          <nav className="space-y-1">
            {navigation.map(
              ([
                label,
                path,
                Icon,
              ]) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) =>
                    [
                      "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition",
                      isActive
                        ? "border border-cyan-400/15 bg-cyan-400/[0.08] text-cyan-200"
                        : "text-slate-500 hover:bg-white/[0.035] hover:text-slate-200",
                    ].join(" ")
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        size={16}
                        strokeWidth={1.7}
                      />

                      <span className="text-[11px] font-medium tracking-[0.08em]">
                        {label}
                      </span>

                      {isActive && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)]" />
                      )}
                    </>
                  )}
                </NavLink>
              ),
            )}
          </nav>

          <div className="mb-3 mt-8 px-3 font-mono-ui text-[9px] uppercase tracking-[0.18em] text-slate-600">
            Organization
          </div>

          <nav className="space-y-1">
            {organizationNavigation.map(
              ([
                label,
                path,
                Icon,
              ]) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) =>
                    [
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition",
                      isActive
                        ? "border border-cyan-400/15 bg-cyan-400/[0.08] text-cyan-200"
                        : "text-slate-500 hover:bg-white/[0.035] hover:text-slate-200",
                    ].join(" ")
                  }
                >
                  <Icon
                    size={16}
                    strokeWidth={1.7}
                  />

                  <span className="text-[11px] font-medium tracking-[0.08em]">
                    {label}
                  </span>
                </NavLink>
              ),
            )}
          </nav>
        </div>

        <div className="border-t border-white/[0.07] p-4">
          <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
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

      <div className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-white/[0.07] bg-[#090d11]/95 px-4 backdrop-blur-xl md:hidden">
  <div className="flex items-center gap-2">
    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10">
      <LayoutDashboard
        size={16}
        className="text-cyan-300"
      />
    </div>

    <span className="text-[12px] font-semibold tracking-[0.14em]">
      UNI-OFFICE
    </span>
  </div>

  <button
    type="button"
    className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2 text-slate-400"
    aria-label="Open navigation"
  >
    <Command size={16} />
  </button>
</div>

      <main className="main-content min-h-screen">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-white/[0.07] bg-[#070a0d]/80 px-7 backdrop-blur-xl">
          <div>
            <div className="font-mono-ui text-[9px] uppercase tracking-[0.2em] text-slate-600">
              UNI-OFFICE
            </div>

            <h1 className="mt-1 text-lg font-semibold tracking-tight">
  Command Center
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-slate-500 sm:flex">
              <Search size={14} />

              <span className="text-[11px]">
                Search
              </span>

              <kbd className="font-mono-ui rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-slate-600">
  Ctrl K
              </kbd>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-emerald-400/10 bg-emerald-400/[0.04] px-3 py-1.5">
              <span className="status-dot status-dot-live" />

              <span className="font-mono-ui text-[9px] uppercase tracking-[0.12em] text-emerald-300/80">
                System operational
              </span>
            </div>
          </div>
        </header>

        <section className="grid-background min-h-[calc(100vh-72px)] p-7 max-md:px-4 max-md:pt-20">
          <Outlet />
        </section>
      </main>
    </div>
  );
}