"use client";

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  intent?: "primary" | "neutral" | "danger" | "ghost";
}>(function Button({
  busy = false,
  intent = "primary",
  className = "",
  children,
  disabled,
  ...props
}, ref) {
  return (
    <button
      {...props}
      ref={ref}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`button button--${intent} ${className}`}
    >
      <span className="button__label">{children}</span>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
    </button>
  );
});

export function RulePanel({
  title,
  action,
  headingLevel = 2,
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  title?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
}) {
  const heading = title
    ? headingLevel === 4
      ? <h4>{title}</h4>
      : headingLevel === 3
        ? <h3>{title}</h3>
        : <h2>{title}</h2>
    : <span />;
  return (
    <section className={`rule-panel ${className}`} {...props}>
      {title || action ? (
        <header className="rule-panel__header">
          {heading}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function StatusMark({ status }: { status: "idle" | "active" | "pass" | "warning" | "error" }) {
  return <span className={`status-mark status-mark--${status}`} aria-hidden="true" />;
}

export function ProcessingStatus({
  available,
  availabilityStatus,
  source,
}: {
  available: boolean;
  availabilityStatus: "loading" | "resolved" | "failed";
  source: "synthetic" | "custom";
}) {
  if (availabilityStatus === "resolved" && available) return null;
  return (
    <div className="processing-status" role="note">
      <StatusMark status="active" />
      <span>
        {availabilityStatus === "loading"
          ? "Checking processing availability"
          : availabilityStatus === "failed"
            ? "Processing availability unavailable"
            : source === "synthetic"
              ? "Sample results - no AI processing"
              : "Processing unavailable for this model"}
      </span>
    </div>
  );
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
