import {
  Activity,
  Brain,
  Boxes,
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

const navigation = [
  {
    label: "COMMAND",
    icon: Command,
  },
  {
    label: "WORK",
    icon: GitBranch,
  },
  {
    label: "AGENTS",
    icon: Sparkles,
  },
  {
    label: "TOOLS",
    icon: Wrench,
  },
  {
    label: "COMPANY BRAIN",
    icon: Brain,
  },
  {
    label: "ARTIFACTS",
    icon: FileOutput,
  },
  {
    label: "APPROVALS",
    icon: ShieldCheck,
  },
  {
    label: "ACTIVITY",
    icon: Activity,
  },
];

const organizationNavigation = [
  {
    label: "ORGANIZATION",
    icon: Network,
  },
  {
    label: "GOVERNANCE",
    icon: Settings,
  },
];

function App() {
  return (
    <div className="min-h-screen bg-[#070a0d] text-[#e6edf3]">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-white/[0.07] bg-[#090d11]/95">
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
            {navigation.map((item, index) => {
              const Icon = item.icon;
              const active = index === 0;

              return (
                <button
                  key={item.label}
                  className={[
                    "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition",
                    active
                      ? "border border-cyan-400/15 bg-cyan-400/[0.08] text-cyan-200"
                      : "text-slate-500 hover:bg-white/[0.035] hover:text-slate-200",
                  ].join(" ")}
                >
                  <Icon
                    size={16}
                    strokeWidth={1.7}
                  />

                  <span className="text-[11px] font-medium tracking-[0.08em]">
                    {item.label}
                  </span>

                  {active && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)]" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mb-3 mt-8 px-3 font-mono-ui text-[9px] uppercase tracking-[0.18em] text-slate-600">
            Organization
          </div>

          <nav className="space-y-1">
            {organizationNavigation.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.label}
                  className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-slate-500 transition hover:bg-white/[0.035] hover:text-slate-200"
                >
                  <Icon
                    size={16}
                    strokeWidth={1.7}
                  />

                  <span className="text-[11px] font-medium tracking-[0.08em]">
                    {item.label}
                  </span>
                </button>
              );
            })}
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

      <main className="ml-[280px] min-h-screen">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-white/[0.07] bg-[#070a0d]/80 px-7 backdrop-blur-xl">
          <div>
            <div className="font-mono-ui text-[9px] uppercase tracking-[0.2em] text-slate-600">
              WORKSPACE
            </div>

            <h1 className="mt-1 text-lg font-semibold tracking-tight">
              Command Center
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button className="hidden items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-slate-500 transition hover:border-white/[0.14] hover:text-slate-200 sm:flex">
              <Search size={14} />

              <span className="text-[11px]">
                Search
              </span>

              <kbd className="font-mono-ui rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-slate-600">
                ⌘K
              </kbd>
            </button>

            <div className="flex items-center gap-2 rounded-full border border-emerald-400/10 bg-emerald-400/[0.04] px-3 py-1.5">
              <span className="status-dot status-dot-live" />

              <span className="font-mono-ui text-[9px] uppercase tracking-[0.12em] text-emerald-300/80">
                System operational
              </span>
            </div>
          </div>
        </header>

        <section className="grid-background min-h-[calc(100vh-72px)] p-7">
          <div className="mx-auto max-w-[1400px]">
            <div className="mb-7">
              <div className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-cyan-400/70">
                AI-NATIVE OPERATING SYSTEM
              </div>

              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                What should UNI-OFFICE accomplish?
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Describe an objective. UNI-OFFICE will plan the work,
                delegate tasks to agents, use available tools, and return
                the result.
              </p>
            </div>

            <div className="glass-panel rounded-2xl p-5 shadow-2xl shadow-black/20">
              <textarea
                className="min-h-[180px] w-full resize-none bg-transparent text-lg leading-8 text-slate-200 outline-none placeholder:text-slate-700"
                placeholder="Tell UNI-OFFICE what you want done..."
              />

              <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4">
                <div className="flex items-center gap-2 text-slate-600">
                  <Boxes size={15} />

                  <span className="font-mono-ui text-[9px] uppercase tracking-[0.12em]">
                    Attach context
                  </span>
                </div>

                <button className="flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-2.5 text-[11px] font-medium text-cyan-200 transition hover:bg-cyan-300/15">
                  <Command size={14} />
                  Create Work
                </button>
              </div>
            </div>

            <div className="mt-7 grid gap-4 md:grid-cols-3">
              {[
                ["ACTIVE WORK", "03"],
                ["ACTIVE AGENTS", "07"],
                ["PENDING APPROVALS", "02"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="glass-panel rounded-xl p-5"
                >
                  <div className="font-mono-ui text-[9px] uppercase tracking-[0.16em] text-slate-600">
                    {label}
                  </div>

                  <div className="mt-3 text-2xl font-semibold text-slate-200">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;