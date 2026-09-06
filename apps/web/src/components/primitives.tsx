import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Clock3,
  LoaderCircle,
  RefreshCw,
  ShieldQuestion,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { toneClass, type Tone } from "../lib/tone";

export function StatusPill({
  tone,
  children,
  pulse = false,
}: {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <span className={`status-pill ${toneClass[tone]}`}>
      <span className={`pill-dot${pulse ? " pill-dot-pulse" : ""}`} />
      {children}
    </span>
  );
}

export function StatusIcon({
  tone,
  size = 15,
}: {
  tone: Tone;
  size?: number;
}) {
  const Icon: LucideIcon =
    tone === "live"
      ? CheckCircle2
      : tone === "active"
        ? LoaderCircle
        : tone === "warning"
          ? ShieldQuestion
          : tone === "error"
            ? AlertTriangle
            : CircleDashed;

  return (
    <Icon
      size={size}
      className={`tone-icon ${toneClass[tone]}${tone === "active" ? " spin-slow" : ""}`}
    />
  );
}

export function Panel({
  title,
  eyebrow,
  action,
  children,
  padded = true,
  className = "",
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <header className="panel-header">
          <div className="min-w-0">
            {eyebrow && <div className="panel-eyebrow">{eyebrow}</div>}
            {title && <div className="panel-title">{title}</div>}
          </div>

          {action && <div className="panel-action">{action}</div>}
        </header>
      )}

      <div className={padded ? "panel-body" : ""}>{children}</div>
    </section>
  );
}

/**
 * The opening of a route.
 *
 * Every page begins the same way the Command Center does - an oversized
 * statement, a single line of plain detail, and an optional reading strip -
 * so moving between surfaces feels like turning a page in one document rather
 * than loading a different app.
 */
export function PageOpening({
  eyebrow,
  title,
  lead,
  detail,
  action,
  meta,
  tone = "quiet",
}: {
  eyebrow: string;
  /** First line, set in the page's ink colour. */
  title: string;
  /** Second line, set in the tone colour. Carries the idea of the page. */
  lead?: string;
  detail?: string;
  action?: ReactNode;
  meta?: ReactNode;
  tone?: "quiet" | "moving" | "waiting" | "broken";
}) {
  return (
    <header className={`dispatch dispatch-${tone} dispatch-page`}>
      <div className="dispatch-inner">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="t-eyebrow mb-4">{eyebrow}</div>

            <h2 className="statement statement-page">
              <span className="statement-line">{title}</span>
              {lead && <span className="statement-line">{lead}</span>}
            </h2>

            {detail && <p className="statement-detail">{detail}</p>}
          </div>

          {action && <div className="shrink-0 pt-1">{action}</div>}
        </div>

        {meta && <div className="dispatch-meta">{meta}</div>}
      </div>
    </header>
  );
}

/** One reading in a page opening's strip. */
export function Reading({
  label,
  value,
  tone = "idle",
  live = false,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  live?: boolean;
}) {
  return (
    <div className={`dispatch-stat ${toneClass[tone]}`}>
      <div
        className={`dispatch-stat-value${live ? " dispatch-stat-value-live" : ""}`}
      >
        {value}
      </div>
      <div className="dispatch-stat-label">{label}</div>
    </div>
  );
}

/** A chapter rule that opens a block within a page. */
export function Chapter({
  index,
  title,
  action,
}: {
  index: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="chapter">
      <span className="chapter-index">{index}</span>
      <span className="chapter-title">{title}</span>
      <span className="chapter-rule" />
      {action && <span className="chapter-action">{action}</span>}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div className="min-w-0">
        <h2 className="section-heading-title">{title}</h2>
        {description && (
          <p className="section-heading-description">{description}</p>
        )}
      </div>

      {action}
    </div>
  );
}

/** The instrument strip the readout numbers sit in. */
export function Readout({ children }: { children: ReactNode }) {
  return <div className="readout">{children}</div>;
}

export function Metric({
  label,
  value,
  detail,
  tone = "idle",
  live = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  /** Colours the number. Reserved for a count that is currently non-zero. */
  live?: boolean;
}) {
  return (
    <div className={`metric ${toneClass[tone]}${live ? " metric-live" : ""}`}>
      <div className="metric-label">{label}</div>

      <div className="metric-value">{value}</div>

      {detail && <div className="metric-detail">{detail}</div>}
    </div>
  );
}

/**
 * A heading with a rule under it. The lighter alternative to a Panel, for the
 * common case where a group of rows needs a name rather than a border box.
 */
export function Section({
  title,
  count,
  action,
  children,
}: {
  title: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <header className="section-head">
        <div className="section-head-title">
          {title}
          {count !== undefined && (
            <span className="section-head-count">{count}</span>
          )}
        </div>

        {action}
      </header>

      {children}
    </section>
  );
}

export function EmptyState({
  icon: Icon = CircleSlash,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon size={19} strokeWidth={1.6} />
      </span>

      <div className="empty-state-title">{title}</div>

      {description && (
        <p className="empty-state-description">{description}</p>
      )}

      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  offline = false,
}: {
  message: string;
  onRetry?: () => void;
  offline?: boolean;
}) {
  return (
    <div className="error-state">
      <span className="error-state-icon">
        <AlertTriangle size={19} strokeWidth={1.6} />
      </span>

      <div className="error-state-title">
        {offline ? "The API is unreachable" : "That request failed"}
      </div>

      <p className="error-state-description">{message}</p>

      {offline && (
        <p className="error-state-hint">
          Start the API with{" "}
          <code>pnpm --filter @unioffice/api dev</code> and make sure Supabase
          and Ollama are both running.
        </p>
      )}

      {onRetry && (
        <button type="button" onClick={onRetry} className="button-ghost mt-4">
          <RefreshCw size={13} />
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({
  rows = 3,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2.5 ${className}`}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="skeleton-row"
          style={{ width: `${100 - index * 9}%` }}
        />
      ))}
    </div>
  );
}

export function TimeStamp({
  iso,
  relative,
}: {
  iso?: string;
  relative: string;
}) {
  return (
    <span
      className="timestamp"
      title={iso ? new Date(iso).toLocaleString() : undefined}
    >
      <Clock3 size={11} />
      {relative}
    </span>
  );
}

export function Chip({
  children,
  tone = "idle",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span className={`chip ${toneClass[tone]}`} title={title}>
      {children}
    </span>
  );
}
