"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function DangerDialog({
  open,
  title,
  description,
  objectName,
  busy = false,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  objectName: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement;
    const shell = document.getElementById("app-shell");
    if (shell) shell.inert = true;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.getElementById("danger-dialog");
      const nodes = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (shell) shell.inert = false;
      triggerRef.current?.focus();
    };
  }, [busy, onCancel, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="dialog-layer">
      <div className="dialog-backdrop" aria-hidden="true" />
      <div
        id="danger-dialog"
        className="dialog-surface"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="danger-dialog-title"
        aria-describedby="danger-dialog-description"
      >
        <h2 id="danger-dialog-title">{title}</h2>
        <p id="danger-dialog-description">{description}</p>
        <p className="mono truncate-wrap">Run: {objectName}</p>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <Button ref={cancelRef} intent="neutral" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button intent="danger" onClick={onConfirm} busy={busy}>Delete now</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
