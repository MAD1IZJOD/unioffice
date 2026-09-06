import { Construction } from "lucide-react";

import { Link } from "react-router-dom";

import { Panel, SectionHeading } from "../components/primitives";

/**
 * Some navigation entries have no backend behind them yet. Showing a
 * plausible-looking mock here would be worse than showing nothing: it makes
 * the product look finished in exactly the places it is not, and the person
 * relying on it finds out at the worst possible moment.
 */
export default function NotBuilt({
  title,
  description,
  planned,
}: {
  title: string;
  description: string;
  planned: string[];
}) {
  return (
    <div className="mx-auto max-w-[860px] fade-up">
      <SectionHeading title={title} description={description} />

      <Panel eyebrow="Status" title="Not built yet">
        <div className="flex items-start gap-4">
          <span className="empty-state-icon !mb-0">
            <Construction size={19} strokeWidth={1.6} />
          </span>

          <div className="min-w-0">
            <p className="text-[11.5px] leading-[1.7] text-slate-400">
              There is no backend behind this surface yet, so it deliberately
              shows nothing rather than a convincing mock. Everything else in
              UNI-OFFICE is reading live data.
            </p>

            <div className="mt-5">
              <div className="detail-label">What belongs here</div>

              <ul className="planned-list mt-2">
                {planned.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/command" className="button-ghost">
                Back to Command Center
              </Link>

              <Link to="/activity" className="button-quiet">
                See what the company is doing
              </Link>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
