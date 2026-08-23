import {
  ArrowUpRight,
  Bot,
  Boxes,
  CheckCircle2,
  CircleDashed,
  Clock3,
  LoaderCircle,
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
  },
  {
    id: "planning",
    label: "PLANNING",
  },
  {
    id: "executing",
    label: "EXECUTING",
  },
  {
    id: "completed",
    label: "COMPLETED",
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

    await wait(500);

    setState("planning");

    await wait(900);

    setState("executing");

    await wait(1200);

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
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-8">
        <div className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-cyan-400/70">
          AI-NATIVE OPERATING SYSTEM
        </div>

        <h2 className="mt-2 text-3xl font-semibold tracking-tight">
          Command Center
        </h2>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Give UNI-OFFICE an objective. The system will
          eventually plan the work, delegate it to agents,
          execute tools, and return the result.
        </p>
      </div>

      <div className="glass-panel rounded-2xl p-5">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles
            size={15}
            className="text-cyan-300"
          />

          <span className="font-mono-ui text-[9px] uppercase tracking-[0.15em] text-slate-500">
            New work
          </span>
        </div>

        <textarea
          value={input}
          onChange={(event) =>
            setInput(event.target.value)
          }
          disabled={state !== "idle"}
          className="min-h-[180px] w-full resize-none bg-transparent text-lg leading-8 text-slate-200 outline-none placeholder:text-slate-700 disabled:opacity-50"
          placeholder="Tell UNI-OFFICE what you want done..."
        />

        <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4">
          <div className="flex items-center gap-2 text-slate-600">
            <Boxes size={15} />

            <span className="font-mono-ui text-[9px] uppercase tracking-[0.12em]">
              Context ready
            </span>
          </div>

          <button
            onClick={createWork}
            disabled={
              !input.trim() ||
              state !== "idle"
            }
            className="flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-2.5 text-[11px] font-medium text-cyan-200 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUpRight size={14} />
            Create Work
          </button>
        </div>
      </div>

      {state !== "idle" && (
        <div className="glass-panel mt-5 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono-ui text-[9px] uppercase tracking-[0.16em] text-slate-600">
                Execution
              </div>

              <div className="mt-1 text-sm font-medium">
                Work is being processed
              </div>
            </div>

            {startedAt && (
              <div className="flex items-center gap-2 text-slate-600">
                <Clock3 size={13} />

                <span className="font-mono-ui text-[9px]">
                  {startedAt.toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            {stages.map((stage, index) => {
              const active =
                index === currentStage;

              const completed =
                index < currentStage;

              return (
                <div
                  key={stage.id}
                  className={[
                    "rounded-xl border p-4 transition",
                    completed
                      ? "border-emerald-400/15 bg-emerald-400/[0.04]"
                      : active
                        ? "border-cyan-400/20 bg-cyan-400/[0.05]"
                        : "border-white/[0.06] bg-white/[0.015]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between">
                    {completed ? (
                      <CheckCircle2
                        size={16}
                        className="text-emerald-300"
                      />
                    ) : active ? (
                      <LoaderCircle
                        size={16}
                        className="animate-spin text-cyan-300"
                      />
                    ) : (
                      <CircleDashed
                        size={16}
                        className="text-slate-700"
                      />
                    )}

                    <span className="font-mono-ui text-[9px] text-slate-700">
                      0{index + 1}
                    </span>
                  </div>

                  <div className="mt-3 font-mono-ui text-[9px] tracking-[0.12em] text-slate-400">
                    {stage.label}
                  </div>
                </div>
              );
            })}
          </div>

          {state === "executing" && (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-cyan-400/10 bg-cyan-400/[0.025] p-4">
              <Bot
                size={17}
                className="text-cyan-300"
              />

              <div>
                <div className="text-[11px] font-medium text-slate-300">
                  Agent Runtime
                </div>

                <div className="font-mono-ui mt-1 text-[9px] text-slate-600">
                  Preparing agent execution
                </div>
              </div>
            </div>
          )}

          {result && (
            <div className="mt-5 rounded-xl border border-emerald-400/10 bg-emerald-400/[0.025] p-5">
              <div className="font-mono-ui text-[9px] uppercase tracking-[0.15em] text-emerald-300/70">
                Result
              </div>

              <p className="mt-3 text-sm leading-7 text-slate-300">
                {result}
              </p>
            </div>
          )}

          {state === "completed" && (
            <button
              onClick={reset}
              className="mt-5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 transition hover:text-slate-200"
            >
              Create another work item
            </button>
          )}
        </div>
      )}

      <div className="mt-7 grid gap-4 md:grid-cols-3">
        {[
          [
            "ACTIVE WORK",
            "03",
          ],
          [
            "ACTIVE AGENTS",
            "07",
          ],
          [
            "PENDING APPROVALS",
            "02",
          ],
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
  );
}

function wait(
  milliseconds: number,
) {
  return new Promise<void>(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds,
      ),
  );
}