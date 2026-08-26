import {
  ArrowUpRight,
  Bot,
  Boxes,
  CheckCircle2,
  CircleDashed,
  Clock3,
  LoaderCircle,
  Plus,
  Sparkles,
} from "lucide-react";

import { useState } from "react";

type ExecutionState =
  | "idle"
  | "received"
  | "planning"
  | "executing"
  | "completed";

const stages = [
  {
    id: "received",
    label: "REQUEST RECEIVED",
    description: "Objective accepted",
  },
  {
    id: "planning",
    label: "PLANNING",
    description: "Preparing work plan",
  },
  {
    id: "executing",
    label: "EXECUTING",
    description: "Agents performing work",
  },
  {
    id: "completed",
    label: "COMPLETED",
    description: "Work finished",
  },
] as const;

function getStageIndex(
  state: ExecutionState,
) {
  return stages.findIndex(
    (stage) => stage.id === state,
  );
}

export default function Command() {
  const [input, setInput] = useState("");

  const [state, setState] =
    useState<ExecutionState>("idle");

  const [result, setResult] =
    useState("");

  const [startedAt, setStartedAt] =
    useState<Date | null>(null);

  async function createWork() {
    const objective = input.trim();

    if (!objective || state !== "idle") {
      return;
    }

    setStartedAt(new Date());
    setResult("");
    setState("received");

    await wait(600);

    setState("planning");

    await wait(1000);

    setState("executing");

    await wait(1500);

    setResult(
      `UNI-OFFICE accepted the objective: "${objective}". The execution pipeline is ready to delegate this work to an agent.`,
    );

    setState("completed");
  }

  function reset() {
    setInput("");
    setResult("");
    setStartedAt(null);
    setState("idle");
  }

  const currentStage =
    getStageIndex(state);

  return (
    <div className="mx-auto max-w-[1380px] fade-up">
      {/* Hero */}
      <div className="mb-7">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-400/[0.045] px-3 py-1.5">
          <span className="status-dot status-dot-live" />

          <span className="font-mono-ui text-[9px] font-medium uppercase tracking-[0.16em] text-cyan-300">
            AI-NATIVE OPERATING SYSTEM
          </span>
        </div>

        <h2 className="mt-5 text-[34px] font-semibold tracking-[-0.04em] text-slate-100 max-sm:text-[28px]">
          Command Center
        </h2>

        <p className="mt-2 max-w-[700px] text-[13px] leading-6 text-slate-400">
          Give UNI-OFFICE an objective. The system can
          turn that objective into work, assign agents,
          execute tools and return the result.
        </p>
      </div>

      {/* Main command area */}
      <div className="command-grid">
        <div>
          <div className="glass-panel overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-[#202b35] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/15 bg-cyan-400/[0.06]">
                  <Sparkles
                    size={15}
                    className="text-cyan-300"
                  />
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-200">
                    New Work
                  </div>

                  <div className="mt-0.5 font-mono-ui text-[8px] uppercase tracking-[0.14em] text-slate-500">
                    Define an objective
                  </div>
                </div>
              </div>

              <span className="font-mono-ui text-[8px] uppercase tracking-[0.14em] text-slate-600">
                COMMAND
              </span>
            </div>

            <div className="p-5">
              <label
                htmlFor="work-objective"
                className="font-mono-ui text-[9px] uppercase tracking-[0.14em] text-slate-500"
              >
                Objective
              </label>

              <textarea
                id="work-objective"
                value={input}
                onChange={(event) =>
                  setInput(event.target.value)
                }
                disabled={state !== "idle"}
                className="command-textarea mt-4 min-h-[210px] w-full bg-transparent text-[17px] leading-8 text-slate-100 placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Describe what you want UNI-OFFICE to accomplish..."
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#202b35] bg-[#0c1218] px-5 py-4">
              <div className="flex items-center gap-2">
                <Boxes
                  size={14}
                  className="text-slate-500"
                />

                <span className="font-mono-ui text-[9px] uppercase tracking-[0.12em] text-slate-500">
                  Context ready
                </span>

                <span className="h-1 w-1 rounded-full bg-emerald-400" />

                <span className="font-mono-ui text-[9px] text-emerald-400">
                  READY
                </span>
              </div>

              <button
                type="button"
                onClick={createWork}
                disabled={
                  !input.trim() ||
                  state !== "idle"
                }
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.10] px-4 py-2.5 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.16] disabled:cursor-not-allowed disabled:opacity-30"
              >
                Create Work
                <ArrowUpRight size={14} />
              </button>
            </div>
          </div>

          {/* Execution */}
          {state !== "idle" && (
            <div className="glass-panel mt-5 rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-mono-ui text-[9px] uppercase tracking-[0.15em] text-slate-500">
                    Execution pipeline
                  </div>

                  <div className="mt-1.5 text-[14px] font-semibold text-slate-200">
                    Work is being processed
                  </div>
                </div>

                {startedAt && (
                  <div className="flex items-center gap-2 rounded-lg border border-[#25313c] bg-[#0c1218] px-3 py-2">
                    <Clock3
                      size={13}
                      className="text-slate-500"
                    />

                    <span className="font-mono-ui text-[9px] text-slate-400">
                      {startedAt.toLocaleTimeString()}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-6 grid gap-2 md:grid-cols-4">
                {stages.map(
                  (stage, index) => {
                    const active =
                      index === currentStage;

                    const completed =
                      index < currentStage;

                    return (
                      <div
                        key={stage.id}
                        className={[
                          "rounded-xl border p-4 transition-all",
                          completed
                            ? "border-emerald-400/20 bg-emerald-400/[0.055]"
                            : active
                              ? "border-cyan-400/25 bg-cyan-400/[0.065]"
                              : "border-[#202b35] bg-[#0d1319]",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between">
                          {completed ? (
                            <CheckCircle2
                              size={16}
                              className="text-emerald-400"
                            />
                          ) : active ? (
                            <LoaderCircle
                              size={16}
                              className="animate-spin text-cyan-300"
                            />
                          ) : (
                            <CircleDashed
                              size={16}
                              className="text-slate-600"
                            />
                          )}

                          <span className="font-mono-ui text-[8px] text-slate-600">
                            0{index + 1}
                          </span>
                        </div>

                        <div className="mt-4 font-mono-ui text-[9px] font-semibold tracking-[0.1em] text-slate-300">
                          {stage.label}
                        </div>

                        <div className="mt-1 text-[10px] text-slate-500">
                          {completed
                            ? "Complete"
                            : active
                              ? stage.description
                              : "Waiting"}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>

              {state === "executing" && (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.035] p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/15 bg-cyan-400/[0.06]">
                    <Bot
                      size={17}
                      className="text-cyan-300"
                    />
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-200">
                      Agent Runtime
                    </div>

                    <div className="mt-1 font-mono-ui text-[9px] text-slate-500">
                      Preparing agent execution
                    </div>
                  </div>

                  <span className="ml-auto status-dot status-dot-live" />
                </div>
              )}

              {result && (
                <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.035] p-5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      size={14}
                      className="text-emerald-400"
                    />

                    <span className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-emerald-300">
                      Result
                    </span>
                  </div>

                  <p className="mt-3 text-[13px] leading-6 text-slate-300">
                    {result}
                  </p>
                </div>
              )}

              {state === "completed" && (
                <button
                  type="button"
                  onClick={reset}
                  className="mt-5 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 transition hover:text-slate-200"
                >
                  <Plus size={13} />
                  Create another work item
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          <div className="panel-muted rounded-2xl p-5">
            <div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">
              System state
            </div>

            <div className="mt-5 flex items-center gap-3">
              <span className="status-dot status-dot-live" />

              <div>
                <div className="text-[13px] font-semibold text-slate-200">
                  Operational
                </div>

                <div className="mt-1 text-[10px] text-slate-500">
                  All core services available
                </div>
              </div>
            </div>

            <div className="mt-5 border-t border-[#202b35] pt-4">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-500">
                  Model
                </span>

                <span className="font-mono-ui text-slate-300">
                  QWEN3:8B
                </span>
              </div>

              <div className="mt-3 flex justify-between text-[10px]">
                <span className="text-slate-500">
                  Runtime
                </span>

                <span className="font-mono-ui text-emerald-400">
                  READY
                </span>
              </div>
            </div>
          </div>

          <div className="panel-muted rounded-2xl p-5">
            <div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">
              Quick examples
            </div>

            <div className="mt-4 space-y-2">
              {[
                "Build a calculator app",
                "Analyze this dataset",
                "Research a competitor",
              ].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() =>
                    setInput(example)
                  }
                  disabled={state !== "idle"}
                  className="w-full rounded-lg border border-[#202b35] bg-[#10161d] px-3 py-2.5 text-left text-[10px] text-slate-400 transition hover:border-[#34424f] hover:bg-[#141b23] hover:text-slate-200 disabled:opacity-40"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Metrics */}
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {[
          {
            label: "ACTIVE WORK",
            value: "03",
            detail: "Currently executing",
          },
          {
            label: "ACTIVE AGENTS",
            value: "07",
            detail: "Ready for delegation",
          },
          {
            label: "PENDING APPROVALS",
            value: "02",
            detail: "Require human review",
          },
        ].map((metric) => (
          <div
            key={metric.label}
            className="panel-muted rounded-xl p-5"
          >
            <div className="font-mono-ui text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">
              {metric.label}
            </div>

            <div className="mt-3 flex items-end justify-between">
              <div className="text-[28px] font-semibold tracking-[-0.03em] text-slate-100">
                {metric.value}
              </div>

              <div className="pb-1 text-[9px] text-slate-600">
                {metric.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) =>
    setTimeout(resolve, milliseconds),
  );
}