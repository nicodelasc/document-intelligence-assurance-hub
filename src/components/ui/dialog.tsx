"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function Dialog({
  open,
  title,
  description,
  busy = false,
  role = "dialog",
  initialFocusRef,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  busy?: boolean;
  role?: "dialog" | "alertdialog";
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  const initialFocusTargetRef = useRef(initialFocusRef);

  useEffect(() => {
    busyRef.current = busy;
    closeRef.current = onClose;
    initialFocusTargetRef.current = initialFocusRef;
  }, [busy, initialFocusRef, onClose]);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    const shell = document.getElementById("app-shell");
    if (shell) shell.inert = true;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const focusTarget =
      initialFocusTargetRef.current?.current ??
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialogRef.current;
    focusTarget?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!busyRef.current) {
          event.preventDefault();
          closeRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = dialogRef.current
        ? Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
          )
        : [];
      if (!nodes.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
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
      document.documentElement.style.overflow = previousOverflow;
      if (shell) shell.inert = false;
      triggerRef.current?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="dialog-layer">
      <div
        className="dialog-backdrop"
        aria-hidden="true"
        onMouseDown={() => {
          if (!busyRef.current) closeRef.current();
        }}
      />
      <div
        ref={dialogRef}
        className="dialog-surface"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

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
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      busy={busy}
      role="alertdialog"
      initialFocusRef={cancelRef}
      onClose={onCancel}
    >
        <p className="mono truncate-wrap">Run: {objectName}</p>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <Button ref={cancelRef} intent="neutral" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button intent="danger" onClick={onConfirm} busy={busy}>Delete now</Button>
        </div>
    </Dialog>
  );
}
