import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Brain,
  Check,
  Database,
  FileOutput,
  GitBranch,
  LockKeyhole,
  Network,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";
import { useState } from "react";

type Accent = "cyan" | "violet" | "emerald" | "amber";

type PageConfig = {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  action: string;
  accent: Accent;
};

const pageData: Record<string, PageConfig> = {
  Work: { eyebrow: "EXECUTION PORTFOLIO", title: "Work", description: "Every company objective, from first intent to recorded outcome. Atlas keeps the handoffs visible.", icon: GitBranch, action: "New objective", accent: "cyan" },
  Agents: { eyebrow: "AI WORKFORCE", title: "Agents", description: "Specialists are organized around company functions, not chat windows. Hire the capability you need.", icon: Sparkles, action: "Add agent", accent: "violet" },
  Tools: { eyebrow: "EXECUTION LAYER", title: "Tools", description: "Approved capabilities that agents can use while completing company work.", icon: Wrench, action: "Connect tool", accent: "emerald" },
  "Company Brain": { eyebrow: "SHARED ORGANIZATIONAL MEMORY", title: "Company Brain", description: "The context that lets agents act like one company: decisions, facts, conventions and outcomes.", icon: Brain, action: "Add knowledge", accent: "cyan" },
  Artifacts: { eyebrow: "WORK OUTPUTS", title: "Artifacts", description: "Reports, plans, files and deliverables created through UNI-OFFICE work.", icon: FileOutput, action: "Create artifact", accent: "violet" },
  Approvals: { eyebrow: "HUMAN CONTROL POINTS", title: "Approvals", description: "Autonomy stays useful when consequential actions wait for the right person.", icon: ShieldCheck, action: "Configure gates", accent: "amber" },
  Activity: { eyebrow: "ORGANIZATIONAL PULSE", title: "Activity", description: "A live, auditable record of what the company brain and workforce are doing.", icon: Activity, action: "Export activity", accent: "cyan" },
  Organization: { eyebrow: "COMPANY TOPOLOGY", title: "Organization", description: "A living map of the AI workforce. Departments own capabilities, agents own work and people keep control.", icon: Network, action: "Design department", accent: "cyan" },
  Governance: { eyebrow: "CONTROL FRAMEWORK", title: "Governance", description: "The policies, permissions and audit controls that make AI action safe to scale.", icon: LockKeyhole, action: "New policy", accent: "emerald" },
};

const agents = [
  ["Atlas", "Company orchestration", "Revenue", "24 agents", "cyan"],
  ["Forge", "Engineering delivery", "Engineering", "31 agents", "violet"],
  ["Ledger", "Operations intelligence", "Operations", "22 agents", "emerald"],
  ["Nova", "Product strategy", "Product", "18 agents", "amber"],
  ["Kindred", "People operations", "People", "14 agents", "slate"],
  ["Relay", "Customer resolution", "Support", "28 agents", "blue"],
] as const;

const activityItems = [
  ["Atlas", "built a work plan for the product launch", "2m ago", "cyan"],
  ["Forge", "requested product requirements from Nova", "8m ago", "violet"],
  ["Ledger", "recorded a vendor decision in Company Brain", "17m ago", "emerald"],
  ["Relay", "flagged an enterprise support escalation", "24m ago", "slate"],
] as const;

const accentClasses: Record<Accent, string> = {
  cyan: "border-cyan-400/20 bg-cyan-400/[0.07] text-cyan-200",
  violet: "border-violet-400/20 bg-violet-400/[0.07] text-violet-200",
  emerald: "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200",
  amber: "border-amber-400/20 bg-amber-400/[0.07] text-amber-200",
};

function toneClasses(tone: string) {
  if (tone === "cyan") return accentClasses.cyan;
  if (tone === "violet") return accentClasses.violet;
  if (tone === "emerald") return accentClasses.emerald;
  if (tone === "amber") return accentClasses.amber;
  return "border-slate-500/25 bg-slate-500/10 text-slate-300";
}

function IconBadge({ icon: Icon, accent }: { icon: LucideIcon; accent: Accent }) {
  return <span className={["flex h-10 w-10 items-center justify-center rounded-xl border", accentClasses[accent]].join(" ")}><Icon size={17} /></span>;
}

function PageHeader({ data, onAction }: { data: PageConfig; onAction: () => void }) {
  const Icon = data.icon;
  return <div className="flex flex-wrap items-end justify-between gap-5">
    <div className="max-w-3xl"><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-300/75">{data.eyebrow}</div><div className="mt-3 flex items-center gap-3"><IconBadge icon={Icon} accent={data.accent} /><h2 className="text-[32px] font-semibold tracking-[-0.045em] text-slate-100 max-sm:text-[28px]">{data.title}</h2></div><p className="mt-3 max-w-2xl text-[13px] leading-6 text-slate-400">{data.description}</p></div>
    <button type="button" onClick={onAction} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.10] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.16]"><Plus size={13} />{data.action}</button>
  </div>;
}

function OrganizationMap() {
  return <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1fr)_285px]">
    <div className="glass-panel overflow-hidden rounded-2xl"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#202b35] px-5 py-4"><div><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">Operating map</div><div className="mt-1 text-[13px] font-semibold text-slate-200">The AI-native organization</div></div><div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.055] px-3 py-1.5 font-mono-ui text-[8px] font-semibold tracking-[0.12em] text-emerald-300"><span className="status-dot status-dot-live" />137 SPECIALISTS AVAILABLE</div></div>
      <div className="relative overflow-hidden p-5 sm:p-8"><div className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(125,211,252,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,0.045)_1px,transparent_1px)] [background-size:28px_28px]" /><div className="relative mx-auto max-w-[870px]"><div className="mx-auto flex w-fit items-center gap-3 rounded-2xl border border-cyan-300/25 bg-[#10212a] px-5 py-4 shadow-[0_0_40px_rgba(34,211,238,0.09)]"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300/[0.10] text-cyan-200"><Brain size={18} /></span><div><div className="text-[12px] font-semibold text-slate-100">Company Brain</div><div className="mt-1 font-mono-ui text-[8px] uppercase tracking-[0.14em] text-cyan-300">Shared operating context</div></div></div><div className="mx-auto h-8 w-px bg-gradient-to-b from-cyan-300/50 to-slate-600/20" /><div className="mx-auto flex w-fit items-center gap-3 rounded-xl border border-violet-400/25 bg-violet-400/[0.06] px-4 py-3"><Zap size={15} className="text-violet-300" /><span className="text-[11px] font-semibold text-slate-100">Atlas / Orchestrator</span><span className="font-mono-ui text-[8px] text-violet-300">PLANS · DELEGATES · RECORDS</span></div><div className="mx-auto h-8 w-px bg-gradient-to-b from-violet-300/40 to-slate-600/20" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{agents.map(([name, description, department, count, tone]) => <button key={name} type="button" className="group rounded-xl border border-[#263440] bg-[#0d141b]/95 p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-[#111b23]"><div className="flex items-start justify-between gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b3a46] bg-[#121d25] text-slate-300 group-hover:text-cyan-200"><Bot size={14} /></span><span className="font-mono-ui text-[8px] uppercase tracking-[0.12em] text-slate-600">{count}</span></div><div className="mt-4 text-[12px] font-semibold text-slate-100">{name}</div><div className="mt-1 text-[10px] text-slate-500">{description}</div><div className={["mt-3 inline-flex rounded-full border px-2 py-1 font-mono-ui text-[8px] uppercase tracking-[0.12em]", toneClasses(tone)].join(" ")}>{department}</div></button>)}</div></div></div>
    </div>
    <aside className="space-y-4"><div className="panel-muted rounded-2xl p-5"><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Organization signal</div><div className="mt-5 text-[30px] font-semibold tracking-[-0.045em] text-slate-100">6</div><div className="mt-1 text-[11px] text-slate-500">department clusters online</div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#1a252e]"><div className="h-full w-[76%] rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" /></div><div className="mt-2 flex justify-between font-mono-ui text-[8px] text-slate-600"><span>CAPABILITY COVERAGE</span><span>76%</span></div></div><div className="panel-muted rounded-2xl p-5"><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Design principle</div><p className="mt-4 text-[13px] font-medium leading-6 text-slate-300">“Hire agents, not seats.”</p><p className="mt-2 text-[10px] leading-5 text-slate-500">Scale new capabilities by adding clear roles to a connected organization—not isolated chatbots.</p></div></aside>
  </div>;
}

function AgentsPage() {
  const [department, setDepartment] = useState("All departments");
  return <div className="mt-8"><div className="glass-panel rounded-2xl p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-[220px] flex-1 items-center gap-3 rounded-lg border border-[#263440] bg-[#0b1117] px-3 py-2.5"><Search size={14} className="text-slate-500" /><input className="w-full bg-transparent text-[11px] text-slate-200 outline-none placeholder:text-slate-600" placeholder="Search agents and capabilities" /></div><div className="flex flex-wrap gap-2">{["All departments", "Revenue", "Engineering", "Operations"].map((item) => <button key={item} type="button" onClick={() => setDepartment(item)} className={["rounded-lg border px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.1em] transition", department === item ? "border-cyan-300/25 bg-cyan-300/[0.09] text-cyan-100" : "border-[#263440] bg-[#10171e] text-slate-500 hover:text-slate-300"].join(" ")}>{item}</button>)}</div></div></div>
    <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{agents.map(([name, description, area, count, tone], index) => <div key={name} className="glass-panel group rounded-2xl p-5 transition hover:-translate-y-0.5 hover:border-[#3a4d5c]"><div className="flex items-start justify-between"><span className={["flex h-10 w-10 items-center justify-center rounded-xl border", toneClasses(tone)].join(" ")}><Bot size={17} /></span><span className="font-mono-ui text-[8px] text-slate-600">0{index + 1}</span></div><div className="mt-6 flex items-end justify-between gap-3"><div><div className="text-[14px] font-semibold text-slate-100">{name}</div><div className="mt-1 text-[10px] text-slate-500">{description}</div></div><ArrowUpRight size={16} className="text-slate-600 transition group-hover:text-cyan-300" /></div><div className="mt-5 flex items-center justify-between border-t border-[#202b35] pt-4"><span className="font-mono-ui text-[8px] uppercase tracking-[0.12em] text-slate-500">{area}</span><span className="text-[10px] font-semibold text-slate-300">{count}</span></div></div>)}</div>
  </div>;
}

function WorkPage() {
  const columns = [["Planning", "cyan", ["Prepare Q4 product launch", "Research new market"]], ["Delegated", "violet", ["Onboarding friction review", "Renewal risk analysis"]], ["In review", "amber", ["Vendor renewal recommendation"]], ["Complete", "emerald", ["Competitor landscape brief"]]] as const;
  return <div className="mt-8 overflow-x-auto pb-2"><div className="grid min-w-[900px] grid-cols-4 gap-4">{columns.map(([stage, tone, work]) => <div key={stage} className="rounded-2xl border border-[#202b35] bg-[#0b1117]/75 p-3"><div className="flex items-center justify-between px-1 pb-3"><div className="flex items-center gap-2"><span className={["h-2 w-2 rounded-full", tone === "cyan" ? "bg-cyan-300" : tone === "violet" ? "bg-violet-300" : tone === "amber" ? "bg-amber-300" : "bg-emerald-300"].join(" ")} /><span className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">{stage}</span></div><span className="font-mono-ui text-[8px] text-slate-600">0{work.length}</span></div><div className="space-y-3">{work.map((item, index) => <button key={item} type="button" className="w-full rounded-xl border border-[#263440] bg-[#10171e] p-4 text-left transition hover:border-cyan-300/25 hover:bg-[#131e27]"><div className="flex items-start justify-between gap-3"><span className="text-[11px] font-semibold leading-5 text-slate-200">{item}</span><ArrowUpRight size={13} className="shrink-0 text-slate-600" /></div><div className="mt-4 flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-300/[0.08] text-cyan-300"><Bot size={10} /></span><span className="font-mono-ui text-[8px] text-slate-500">{index % 2 ? "FORGE" : "ATLAS"}</span><span className="ml-auto text-[8px] text-slate-600">{index + 1}h ago</span></div></button>)}</div></div>)}</div></div>;
}

function BrainPage() {
  const memories = [["Product launch decision", "Q4 launch will focus on self-serve activation before enterprise expansion.", "Decision", "2m ago"], ["Customer signal", "Enterprise customers request SSO during onboarding more often than any other feature.", "Insight", "18m ago"], ["Operating convention", "All spending commitments above $5,000 require Ledger approval.", "Policy", "1h ago"]];
  return <div className="mt-8 grid gap-5 xl:grid-cols-[1.45fr_0.85fr]"><div className="glass-panel rounded-2xl p-5 sm:p-6"><div className="flex items-center justify-between"><div><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Context stream</div><div className="mt-1.5 text-[14px] font-semibold text-slate-200">What the company knows right now</div></div><Database size={18} className="text-cyan-300" /></div><div className="mt-6 space-y-3">{memories.map(([title, detail, kind, time]) => <div key={title} className="rounded-xl border border-[#263440] bg-[#0d141b] p-4"><div className="flex items-center justify-between gap-3"><span className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.06] px-2 py-1 font-mono-ui text-[8px] uppercase tracking-[0.11em] text-cyan-200">{kind}</span><span className="font-mono-ui text-[8px] text-slate-600">{time}</span></div><div className="mt-3 text-[12px] font-semibold text-slate-200">{title}</div><p className="mt-1.5 text-[10px] leading-5 text-slate-500">{detail}</p></div>)}</div></div><aside className="space-y-4"><div className="panel-muted rounded-2xl p-5"><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Memory health</div><div className="mt-5 flex items-end justify-between"><span className="text-[32px] font-semibold tracking-[-0.04em] text-slate-100">128</span><span className="mb-1 text-[10px] text-emerald-300">+12 this week</span></div><div className="mt-2 text-[10px] text-slate-500">indexed organizational memories</div></div><div className="panel-muted rounded-2xl p-5"><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Connected to work</div><div className="mt-4 space-y-3">{["Product positioning", "Approval policy", "Customer onboarding"].map((topic) => <div key={topic} className="flex items-center gap-3 text-[10px] text-slate-400"><span className="status-dot status-dot-live" />{topic}<ArrowUpRight size={12} className="ml-auto text-slate-600" /></div>)}</div></div></aside></div>;
}

function ApprovalPage() {
  const [approved, setApproved] = useState<string[]>([]);
  const gates = [["Approve vendor renewal", "Ledger recommends renewing the analytics vendor at $3,600 per month.", "Financial commitment", "Medium"], ["Authorize customer outreach", "Relay prepared a follow-up sequence for 24 at-risk enterprise accounts.", "External communication", "Low"]];
  return <div className="mt-8 grid gap-5 xl:grid-cols-[1.45fr_0.85fr]"><div className="space-y-4">{gates.map(([title, detail, type, risk]) => { const isApproved = approved.includes(title); return <div key={title} className={["glass-panel rounded-2xl p-5 transition", isApproved ? "border-emerald-400/25" : ""].join(" ")}><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-3"><span className={["flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", isApproved ? accentClasses.emerald : accentClasses.amber].join(" ")}>{isApproved ? <Check size={18} /> : <AlertTriangle size={18} />}</span><div><div className="text-[13px] font-semibold text-slate-100">{title}</div><p className="mt-1.5 max-w-xl text-[10px] leading-5 text-slate-500">{isApproved ? "Approval recorded. Atlas can continue the work when execution is connected." : detail}</p></div></div><span className="rounded-full border border-[#303d49] bg-[#111920] px-2.5 py-1 font-mono-ui text-[8px] uppercase tracking-[0.12em] text-slate-400">{type}</span></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#202b35] pt-4"><span className="font-mono-ui text-[8px] uppercase tracking-[0.13em] text-slate-500">Risk: <span className={risk === "Medium" ? "text-amber-300" : "text-emerald-300"}>{risk}</span></span>{!isApproved && <div className="flex gap-2"><button type="button" className="rounded-lg border border-[#2f3d49] px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400 transition hover:text-slate-200">Review</button><button type="button" onClick={() => setApproved((current) => [...current, title])} className="rounded-lg border border-emerald-300/25 bg-emerald-400/[0.08] px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-emerald-200 transition hover:bg-emerald-400/[0.15]">Approve</button></div>}</div></div>})}</div><aside className="panel-muted rounded-2xl p-5"><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Governance rule</div><div className="mt-4 text-[14px] font-semibold leading-6 text-slate-200">Humans keep the final say.</div><p className="mt-2 text-[10px] leading-5 text-slate-500">Approval gates are a first-class workflow state. They keep agents fast without making actions invisible or irreversible.</p><div className="mt-5 rounded-xl border border-[#263440] bg-[#0b1117] p-4"><div className="flex justify-between text-[10px]"><span className="text-slate-500">Pending gates</span><span className="font-mono-ui text-amber-300">{gates.length - approved.length}</span></div><div className="mt-3 flex justify-between text-[10px]"><span className="text-slate-500">Approved today</span><span className="font-mono-ui text-emerald-300">{approved.length}</span></div></div></aside></div>;
}

function GenericPage({ data }: { data: PageConfig }) {
  const Icon = data.icon;
  return <div className="mt-8 grid gap-5 xl:grid-cols-[1.45fr_0.85fr]"><div className="glass-panel rounded-2xl p-5"><div className="flex items-center justify-between"><div><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Live surface</div><div className="mt-1.5 text-[14px] font-semibold text-slate-200">Recent company signals</div></div><Icon size={17} className="text-cyan-300" /></div><div className="mt-6 space-y-3">{activityItems.map(([agent, action, time, tone]) => <div key={action} className="flex gap-3 rounded-xl border border-[#263440] bg-[#0d141b] p-4"><span className={["mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", toneClasses(tone)].join(" ")}><Bot size={13} /></span><div className="min-w-0 flex-1"><div className="text-[11px] leading-5 text-slate-300"><span className="font-semibold text-slate-100">{agent}</span> {action}</div><div className="mt-1 font-mono-ui text-[8px] text-slate-600">{time}</div></div><ArrowUpRight size={13} className="mt-1 text-slate-600" /></div>)}</div></div><aside className="space-y-4"><div className="panel-muted rounded-2xl p-5"><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">System readiness</div><div className="mt-5 flex items-center gap-3"><span className="status-dot status-dot-live" /><div><div className="text-[13px] font-semibold text-slate-200">Ready for runtime</div><div className="mt-1 text-[10px] text-slate-500">Interface contracts prepared</div></div></div></div><div className="panel-muted rounded-2xl p-5"><div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Next connection</div><p className="mt-3 text-[10px] leading-5 text-slate-500">This surface is ready to receive real-time data once the product runtime is connected.</p></div></aside></div>;
}

export default function PlaceholderPage({ title }: { title: string }) {
  const data = pageData[title] ?? pageData.Work;
  const [notice, setNotice] = useState("");
  function handleAction() { setNotice(`${data.action} is ready to connect to the live runtime.`); window.setTimeout(() => setNotice(""), 2600); }
  return <div className="mx-auto max-w-[1380px] fade-up"><PageHeader data={data} onAction={handleAction} />{notice && <div className="mt-5 flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-4 py-3 text-[10px] text-cyan-100"><Check size={13} />{notice}</div>}{title === "Organization" ? <OrganizationMap /> : title === "Agents" ? <AgentsPage /> : title === "Work" ? <WorkPage /> : title === "Company Brain" ? <BrainPage /> : title === "Approvals" ? <ApprovalPage /> : <GenericPage data={data} />}</div>;
}
