import {
  Activity,
  ArrowUpRight,
  Brain,
  FileOutput,
  GitBranch,
  Network,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";

const pageData: Record<
  string,
  {
    eyebrow: string;
    title: string;
    description: string;
    icon: typeof Activity;
    items: {
      title: string;
      value: string;
      status: string;
    }[];
  }
> = {
  Work: {
    eyebrow: "WORKSPACE",
    title: "Work",
    description:
      "Track objectives from creation through planning, delegation, execution and completion.",
    icon: GitBranch,
    items: [
      {
        title: "Active work",
        value: "03",
        status: "EXECUTING",
      },
      {
        title: "Queued objectives",
        value: "05",
        status: "QUEUED",
      },
      {
        title: "Completed work",
        value: "27",
        status: "COMPLETED",
      },
    ],
  },

  Agents: {
    eyebrow: "INTELLIGENCE",
    title: "Agents",
    description:
      "Manage the autonomous workers responsible for executing organizational tasks.",
    icon: Sparkles,
    items: [
      {
        title: "Active agents",
        value: "07",
        status: "ACTIVE",
      },
      {
        title: "Available capabilities",
        value: "18",
        status: "READY",
      },
      {
        title: "Current assignments",
        value: "11",
        status: "RUNNING",
      },
    ],
  },

  Tools: {
    eyebrow: "EXECUTION",
    title: "Tools",
    description:
      "Inspect the capabilities agents can invoke to interact with computation, data and external systems.",
    icon: Wrench,
    items: [
      {
        title: "Calculator",
        value: "READY",
        status: "AVAILABLE",
      },
      {
        title: "File system",
        value: "READY",
        status: "AVAILABLE",
      },
      {
        title: "External integrations",
        value: "04",
        status: "REGISTERED",
      },
    ],
  },

  "Company Brain": {
    eyebrow: "MEMORY",
    title: "Company Brain",
    description:
      "Central organizational context available to agents during planning and execution.",
    icon: Brain,
    items: [
      {
        title: "Company knowledge",
        value: "128",
        status: "INDEXED",
      },
      {
        title: "Recent memories",
        value: "42",
        status: "AVAILABLE",
      },
      {
        title: "Retrieved context",
        value: "09",
        status: "ACTIVE",
      },
    ],
  },

  Artifacts: {
    eyebrow: "OUTPUTS",
    title: "Artifacts",
    description:
      "Results, files and other outputs produced by UNI-OFFICE work.",
    icon: FileOutput,
    items: [
      {
        title: "Reports",
        value: "12",
        status: "READY",
      },
      {
        title: "Applications",
        value: "04",
        status: "READY",
      },
      {
        title: "Generated documents",
        value: "31",
        status: "READY",
      },
    ],
  },

  Approvals: {
    eyebrow: "GOVERNANCE",
    title: "Approvals",
    description:
      "Review actions that require human authorization before execution can continue.",
    icon: ShieldCheck,
    items: [
      {
        title: "Pending approvals",
        value: "02",
        status: "REVIEW",
      },
      {
        title: "Approved actions",
        value: "19",
        status: "APPROVED",
      },
      {
        title: "Rejected actions",
        value: "03",
        status: "REJECTED",
      },
    ],
  },

  Activity: {
    eyebrow: "AUDIT",
    title: "Activity",
    description:
      "A chronological record of work, agent decisions, tool calls and system events.",
    icon: Activity,
    items: [
      {
        title: "Agent events",
        value: "184",
        status: "RECORDED",
      },
      {
        title: "Tool calls",
        value: "76",
        status: "RECORDED",
      },
      {
        title: "Execution history",
        value: "42",
        status: "TRACKED",
      },
    ],
  },

  Organization: {
    eyebrow: "ORGANIZATION",
    title: "Organization",
    description:
      "Configure the organization, workspaces and operating structure.",
    icon: Network,
    items: [
      {
        title: "Organization",
        value: "1",
        status: "ACTIVE",
      },
      {
        title: "Workspaces",
        value: "03",
        status: "ACTIVE",
      },
      {
        title: "Members",
        value: "08",
        status: "ACTIVE",
      },
    ],
  },

  Governance: {
    eyebrow: "CONTROL",
    title: "Governance",
    description:
      "Policies, permissions, approvals and audit controls that constrain autonomous execution.",
    icon: ShieldCheck,
    items: [
      {
        title: "Policies",
        value: "12",
        status: "ACTIVE",
      },
      {
        title: "Permissions",
        value: "28",
        status: "DEFINED",
      },
      {
        title: "Audit",
        value: "ON",
        status: "ENABLED",
      },
    ],
  },
};

export default function PlaceholderPage({
  title,
}: {
  title: string;
}) {
  const data =
    pageData[title] ??
    pageData.Work;

  const Icon = data.icon;

  return (
    <div className="mx-auto max-w-[1250px] fade-up">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-3xl">
          <div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-400/75">
            {data.eyebrow}
          </div>

          <h2 className="mt-3 text-[32px] font-semibold tracking-[-0.04em] text-slate-100">
            {data.title}
          </h2>

          <p className="mt-2 text-[13px] leading-6 text-slate-400">
            {data.description}
          </p>
        </div>

        <div className="hidden items-center gap-2 rounded-lg border border-[#202b35] bg-[#0d1319] px-3 py-2 sm:flex">
          <span className="status-dot status-dot-live" />

          <span className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-400">
            Subsystem ready
          </span>
        </div>
      </div>

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {data.items.map((item, index) => (
          <div
            key={item.title}
            className="glass-panel rounded-xl p-5 transition hover:border-[#334250]"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#27333e] bg-[#111820]">
                <Icon
                  size={16}
                  className="text-slate-400"
                />
              </div>

              <span className="font-mono-ui text-[8px] text-slate-600">
                0{index + 1}
              </span>
            </div>

            <div className="mt-6 flex items-end justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold text-slate-300">
                  {item.title}
                </div>

                <div className="mt-2 font-mono-ui text-[8px] uppercase tracking-[0.12em] text-emerald-400/80">
                  {item.status}
                </div>
              </div>

              <div className="text-[25px] font-semibold tracking-[-0.03em] text-slate-100">
                {item.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="glass-panel rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                System overview
              </div>

              <div className="mt-1.5 text-[14px] font-semibold text-slate-200">
                {data.title} subsystem
              </div>
            </div>

            <Icon
              size={17}
              className="text-cyan-300/70"
            />
          </div>

          <div className="mt-5 space-y-3">
            {[
              "Core interface initialized",
              "Data layer ready for integration",
              "Runtime connection available",
            ].map((event, index) => (
              <div
                key={event}
                className="flex items-center gap-3 rounded-lg border border-[#202b35] bg-[#0d1319] px-4 py-3"
              >
                <span
                  className={[
                    "h-1.5 w-1.5 rounded-full",
                    index === 2
                      ? "bg-amber-400"
                      : "bg-emerald-400",
                  ].join(" ")}
                />

                <span className="text-[10px] text-slate-400">
                  {event}
                </span>

                <span className="ml-auto font-mono-ui text-[8px] text-slate-600">
                  READY
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-muted rounded-xl p-5">
          <div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">
            Architecture
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-400/15 bg-cyan-400/[0.05]">
              <Icon
                size={17}
                className="text-cyan-300"
              />
            </div>

            <div>
              <div className="text-[11px] font-semibold text-slate-200">
                UNI-OFFICE
              </div>

              <div className="mt-1 font-mono-ui text-[8px] text-slate-500">
                CONTROL PLANE
              </div>
            </div>
          </div>

          <p className="mt-5 text-[11px] leading-5 text-slate-500">
            This interface is being connected to the
            underlying UNI-OFFICE execution architecture.
            The visual layer is ready for the real runtime,
            repositories and services.
          </p>

          <button
            type="button"
            className="mt-5 inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 transition hover:text-cyan-300"
          >
            View subsystem
            <ArrowUpRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}