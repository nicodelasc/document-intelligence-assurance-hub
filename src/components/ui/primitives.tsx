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
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`rule-panel ${className}`} {...props}>
      {title || action ? (
        <header className="rule-panel__header">
          {title ? <h2>{title}</h2> : <span />}
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

export function KeylessNotice() {
  return (
    <div className="keyless-notice" role="note">
      <StatusMark status="active" />
      <span>Recorded replay is active. Live provider calls remain off until server credentials are explicitly configured.</span>
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
