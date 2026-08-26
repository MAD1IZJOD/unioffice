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
    items: string[];
  }
> = {
  Work: {
    eyebrow: "WORKSPACE",
    title: "Work",
    description:
      "Track objectives, execution state, agents and generated results.",
    icon: GitBranch,
    items: [
      "Active work",
      "Queued objectives",
      "Completed work",
    ],
  },

  Agents: {
    eyebrow: "INTELLIGENCE",
    title: "Agents",
    description:
      "Manage the agents responsible for executing organizational work.",
    icon: Sparkles,
    items: [
      "Active agents",
      "Capabilities",
      "Assignments",
    ],
  },

  Tools: {
    eyebrow: "EXECUTION",
    title: "Tools",
    description:
      "Inspect the capabilities available to UNI-OFFICE agents.",
    icon: Wrench,
    items: [
      "Calculator",
      "File system",
      "External integrations",
    ],
  },

  "Company Brain": {
    eyebrow: "MEMORY",
    title: "Company Brain",
    description:
      "Central context and organizational memory for AI agents.",
    icon: Brain,
    items: [
      "Company knowledge",
      "Recent memories",
      "Retrieved context",
    ],
  },

  Artifacts: {
    eyebrow: "OUTPUTS",
    title: "Artifacts",
    description:
      "Results and files produced by UNI-OFFICE work.",
    icon: FileOutput,
    items: [
      "Reports",
      "Applications",
      "Generated documents",
    ],
  },

  Approvals: {
    eyebrow: "GOVERNANCE",
    title: "Approvals",
    description:
      "Review actions that require human authorization.",
    icon: ShieldCheck,
    items: [
      "Pending approvals",
      "Approved actions",
      "Rejected actions",
    ],
  },

  Activity: {
    eyebrow: "AUDIT",
    title: "Activity",
    description:
      "A chronological record of system and agent activity.",
    icon: Activity,
    items: [
      "Agent events",
      "Tool calls",
      "Execution history",
    ],
  },

  Organization: {
    eyebrow: "ORGANIZATION",
    title: "Organization",
    description:
      "Configure the organization, workspaces and operating structure.",
    icon: Network,
    items: [
      "Organization settings",
      "Workspaces",
      "Members",
    ],
  },

  Governance: {
    eyebrow: "CONTROL",
    title: "Governance",
    description:
      "Policies, permissions, approvals and audit controls.",
    icon: ShieldCheck,
    items: [
      "Policies",
      "Permissions",
      "Audit",
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
    <div className="mx-auto max-w-[1200px] fade-up">
      <div className="max-w-3xl">
        <div className="font-mono-ui text-[9px] uppercase tracking-[0.2em] text-slate-600">
          {data.eyebrow}
        </div>

        <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-100">
          {data.title}
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-500">
          {data.description}
        </p>
      </div>

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {data.items.map(
          (item, index) => (
            <div
              key={item}
              className="glass-panel group rounded-2xl p-5 transition hover:border-white/[0.12]"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025]">
                  <Icon
                    size={16}
                    className="text-slate-500 group-hover:text-cyan-300"
                  />
                </div>

                <span className="font-mono-ui text-[9px] text-slate-700">
                  0{index + 1}
                </span>
              </div>

              <div className="mt-6 text-sm font-medium text-slate-300">
                {item}
              </div>

              <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-700">
                View section
                <ArrowUpRight
                  size={11}
                />
              </div>
            </div>
          ),
        )}
      </div>

      <div className="mt-8 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.025] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/10 bg-cyan-400/[0.05]">
            <Icon
              size={16}
              className="text-cyan-300/70"
            />
          </div>

          <div>
            <div className="text-sm font-medium text-slate-300">
              UNI-OFFICE subsystem
            </div>

            <p className="mt-1 text-[11px] leading-5 text-slate-600">
              This interface is connected to the
              planned UNI-OFFICE architecture. The
              underlying subsystem will be wired into
              the real execution pipeline as the
              backend implementation progresses.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}