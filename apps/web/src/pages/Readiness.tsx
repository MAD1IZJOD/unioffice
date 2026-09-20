import { ArrowRight, Check, Zap } from "lucide-react";

import { useCallback } from "react";
import { Link } from "react-router-dom";

import {
  fetchCompanyReadiness,
  type CompanyReadiness,
  type ReadinessAbility,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  Chapter,
  Connecting,
  PageOpening,
  Quiet,
  ReadFailure,
  Reading,
  StaleNotice,
} from "../components/primitives";

/**
 * Company readiness: what your workforce can be asked for today.
 *
 * The question a person actually has on their first morning is not "which
 * skills have an agent holding every required capability and tool" - it is
 * "what can my company do, and is anything going to stop me". So the page is
 * two lists and a sentence each: what the company can be asked for, what it
 * cannot yet, and who is short of what.
 *
 * Nothing on this page is decided here. Every line is the server's answer,
 * read from the rules that route a real mission, which is the only reason it
 * is worth showing: an ability listed as ready is one a mission will actually
 * find someone for, and one listed as needing setup would really have stopped.
 *
 * The remedy is a link to the agent, never an action taken here. Whether it
 * appears at all is the server's decision too - a member or a viewer is told
 * an owner is needed rather than shown a control that would be refused.
 */

export default function Readiness() {
  const readiness = useResource<CompanyReadiness>(
    useCallback(() => fetchCompanyReadiness(), []),
    { pollMs: 60_000 },
  );

  const data = readiness.data;

  if (!data) {
    return (
      <div className="mx-auto max-w-[1080px] fade-up">
        <PageOpening
          eyebrow="Company"
          title="COMPANY READINESS"
          lead="WHAT YOUR WORKFORCE CAN DO."
          detail="Read from the same rules that route a real mission."
        />

        {readiness.error ? (
          <ReadFailure
            what="company readiness"
            error={readiness.error}
            onRetry={readiness.reload}
            consequence="Nothing is wrong with the workforce itself - this page just could not read it."
          />
        ) : (
          <Connecting what="Checking your workforce…" />
        )}
      </div>
    );
  }

  const ready = data.areas.flatMap((area) => area.ready);
  const blocked = data.areas.flatMap((area) => area.blocked);

  return (
    <div className="mx-auto max-w-[1080px] fade-up">
      <PageOpening
        eyebrow="Company"
        title="COMPANY READINESS"
        lead={data.headline}
        detail={data.detail}
        // Having something still to set up is the ordinary state of a new
        // company, not an alarm - the count in the strip says it plainly
        // enough. Only a workforce that can be given nothing at all is a
        // problem worth colouring the page over.
        tone={data.state === "ready" || data.state === "partly_ready" ? "quiet" : "broken"}
        action={
          data.firstRun.canStartMission && data.summary.ready > 0 ? (
            <Link to="/missions/new" className="button-primary">
              <Zap size={13} />
              Start mission
            </Link>
          ) : undefined
        }
        meta={
          <>
            <Reading label="Ready" value={data.summary.ready} tone="live" live={data.summary.ready > 0} />
            <Reading
              label="Needs setup"
              value={data.summary.blocked}
              tone={data.summary.blocked > 0 ? "warning" : "idle"}
              live={data.summary.blocked > 0}
            />
            <Reading label="Agents working" value={data.summary.activeAgents} tone="active" />
          </>
        }
      />

      {readiness.error && <StaleNotice error={readiness.error} onRetry={readiness.reload} />}

      {data.firstRun.pending && <FirstRun readiness={data} />}

      <Chapter index="01" title="What your company can do" />

      {ready.length === 0 ? (
        <Quiet
          line={
            data.summary.agents === 0
              ? "Nobody works here yet."
              : "There is nothing your workforce can be given yet."
          }
          detail={
            data.firstRun.canPrepareWorkforce
              ? "Every kind of work below needs someone who holds it and everything it runs on. Prepare one agent and this list fills in."
              : "An owner or an admin can prepare the workforce so it can take work."
          }
          action={
            data.firstRun.canPrepareWorkforce ? (
              <Link to="/workforce" className="button-ghost">
                The workforce
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="readiness-areas">
          {data.areas
            .filter((area) => area.ready.length > 0)
            .map((area) => (
              <section key={area.area} className="readiness-area">
                <h3 className="readiness-area-name">
                  {area.name}
                  <span className="readiness-area-count">{area.ready.length}</span>
                </h3>

                <ul className="readiness-list">
                  {area.ready.map((ability) => (
                    <Ability key={`${ability.slug}-${ability.workspace?.id ?? ""}`} ability={ability} />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}

      {blocked.length > 0 && (
        <>
          <Chapter index="02" title="What needs setting up first" />

          <p className="readiness-note">
            Each of these is something the company knows how to do, waiting on one thing before anyone can
            be given it. Until then a mission that needs it stops rather than guesses.
          </p>

          <div className="readiness-areas">
            {data.areas
              .filter((area) => area.blocked.length > 0)
              .map((area) => (
                <section key={area.area} className="readiness-area">
                  <h3 className="readiness-area-name">
                    {area.name}
                    <span className="readiness-area-count">{area.blocked.length}</span>
                  </h3>

                  <ul className="readiness-list">
                    {area.blocked.map((ability) => (
                      <Ability key={`${ability.slug}-${ability.workspace?.id ?? ""}`} ability={ability} />
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        </>
      )}

      <Chapter index={blocked.length > 0 ? "03" : "02"} title="Give the company something to do" />

      <div className="readiness-launch">
        <p className="readiness-launch-line">
          {data.summary.ready > 0
            ? "Say what needs to happen. UNIOFFICE decides who does it."
            : "Once one kind of work is ready, this is where you start."}
        </p>

        <p className="readiness-launch-detail">
          You give an objective, not instructions. A plan is made, each step goes to whoever can actually do
          it, and you are asked only when a step needs a person.
        </p>

        {data.firstRun.canStartMission ? (
          <Link to="/missions/new" className="button-primary mt-5 inline-flex">
            <Zap size={13} />
            Start a mission
          </Link>
        ) : (
          <p className="readiness-launch-detail mt-4">
            Your role can follow missions but not open them. An owner, an admin or a member can start one.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The first morning.
 *
 * Not a tour of the navigation - four things that are true or not true about
 * this company right now, in the order they have to become true, ending at a
 * real mission rather than at a "done" button. A company that has opened even
 * one mission never sees it again, because the last step is what closes it.
 */
function FirstRun({ readiness }: { readiness: CompanyReadiness }) {
  const steps = [
    {
      title: "Your workforce",
      done: readiness.summary.activeAgents > 0,
      detail:
        readiness.summary.activeAgents > 0
          ? `${readiness.summary.activeAgents} ${readiness.summary.activeAgents === 1 ? "agent works" : "agents work"} for you. They do the work; you decide what the work is.`
          : "Nobody works here yet. An agent is who a step is actually given to.",
      link: { to: "/workforce", label: "Meet them" },
    },
    {
      title: "What they can do",
      done: readiness.summary.ready > 0,
      detail:
        readiness.summary.ready > 0
          ? `${readiness.summary.ready} ${readiness.summary.ready === 1 ? "kind" : "kinds"} of work can be given to someone today${readiness.summary.blocked > 0 ? `, and ${readiness.summary.blocked} still needs setting up` : ""}.`
          : "Nothing can be given to anyone yet. The lists below say what each one is waiting on.",
    },
    {
      title: "What needs your say-so",
      done: true,
      detail:
        "Some work waits for you before it happens. You decide where that line sits, and you can leave it where it is for now.",
      link: { to: "/governance", label: "The rules" },
    },
    {
      title: "Your first mission",
      done: false,
      detail:
        "Give the company a real objective - something you would otherwise have done yourself this week.",
      link: readiness.firstRun.canStartMission ? { to: "/missions/new", label: "Start it" } : undefined,
    },
  ];

  return (
    <section className="firstrun" aria-label="Getting started">
      <div className="t-eyebrow">Welcome to UNIOFFICE</div>

      <h2 className="firstrun-statement">
        <span className="statement-line">You have a company</span>
        <span className="statement-line">that works for you.</span>
      </h2>

      <p className="firstrun-detail">
        You will not be setting up an AI system here. You say what needs doing, and the company works out who
        does it. Four things are worth knowing before the first one.
      </p>

      <ol className="firstrun-steps">
        {steps.map((step, index) => (
          <li key={step.title} className={`firstrun-step${step.done ? " firstrun-step-done" : ""}`}>
            <span className="firstrun-step-mark" aria-hidden="true">
              {step.done ? <Check size={12} strokeWidth={2.4} /> : index + 1}
            </span>

            <div className="min-w-0">
              <div className="firstrun-step-title">{step.title}</div>
              <p className="firstrun-step-detail">{step.detail}</p>

              {step.link && (
                <Link to={step.link.to} className="button-quiet mt-3 inline-flex">
                  {step.link.label}
                  <ArrowRight size={11} />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Ability({ ability }: { ability: ReadinessAbility }) {
  return (
    <li className={`readiness-ability${ability.ready ? "" : " readiness-ability-blocked"}`}>
      <span className="readiness-mark" aria-hidden="true" />

      <div className="min-w-0">
        <div className="readiness-ability-name">
          {ability.name}
          {ability.workspace && <span className="readiness-scope">{ability.workspace.name}</span>}
        </div>

        <p className="readiness-ability-reason">{ability.reason}</p>

        {ability.fix && (
          <Link to={ability.fix.path} className="button-quiet mt-3 inline-flex">
            {ability.fix.label}
            <ArrowRight size={11} />
          </Link>
        )}

        {!ability.ready && !ability.fix && (
          <p className="readiness-ability-note">An owner needs to set this up.</p>
        )}
      </div>
    </li>
  );
}
