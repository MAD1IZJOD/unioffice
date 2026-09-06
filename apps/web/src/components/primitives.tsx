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

export function Metric({
  label,
  value,
  detail,
  tone = "idle",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`metric ${toneClass[tone]}`}>
      <div className="metric-label">{label}</div>

      <div className="metric-value">{value}</div>

      {detail && <div className="metric-detail">{detail}</div>}
    </div>
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
