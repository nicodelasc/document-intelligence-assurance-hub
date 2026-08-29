"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { EmailPreview } from "@/domain/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/primitives";

export function EmailPreviewDialog({
  open,
  title,
  description,
  roles,
  recipientRole,
  confirmLabel,
  busy,
  error,
  preview,
  onRecipientRoleChange,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  roles: readonly string[];
  recipientRole: string;
  confirmLabel: string;
  busy: boolean;
  error: string;
  preview: EmailPreview | null;
  onRecipientRoleChange: (role: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const roleId = useId();
  const subjectId = useId();
  const bodyId = useId();
  const roleRef = useRef<HTMLSelectElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    if (open && preview) {
      bodyRef.current?.focus();
    }
  }, [open, preview]);

  function closeDialog() {
    setCopyStatus("");
    onClose();
  }

  async function copyPreparedMessage() {
    if (!preview) return;
    const preparedMessage = `${preview.subject}\n\n${preview.body}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(preparedMessage);
      setCopyStatus("Prepared message copied.");
    } catch {
      bodyRef.current?.focus();
      bodyRef.current?.select();
      setCopyStatus(
        "Copy was not available. The message is selected so you can copy it manually.",
      );
    }
  }

  return (
    <Dialog
      open={open}
      title={preview ? "Prepared email copy" : title}
      description={preview ? "Review and copy this public-safe message." : description}
      busy={busy}
      initialFocusRef={preview ? bodyRef : roleRef}
      onClose={closeDialog}
    >
      {preview ? (
        <div className="email-preview">
          <p className="prepared-only-status" role="status">
            Prepared only - not sent
          </p>
          <label htmlFor={subjectId}>Subject</label>
          <input
            id={subjectId}
            value={preview.subject}
            readOnly
          />
          <label htmlFor={bodyId}>Prepared message</label>
          <textarea
            ref={bodyRef}
            id={bodyId}
            className="resize-none"
            value={preview.body}
            readOnly
            rows={10}
          />
          {copyStatus ? (
            <p className="inline-guidance" role="status">
              {copyStatus}
            </p>
          ) : null}
          <div className="dialog-actions">
            <Button type="button" intent="neutral" onClick={closeDialog}>
              Close preview
            </Button>
            <Button type="button" onClick={() => void copyPreparedMessage()}>
              Copy prepared message
            </Button>
          </div>
        </div>
      ) : (
        <div className="workflow-role-dialog">
          <label htmlFor={roleId}>Recipient role</label>
          <select
            ref={roleRef}
            id={roleId}
            value={recipientRole}
            disabled={busy}
            onChange={(event) => onRecipientRoleChange(event.target.value)}
          >
            <option value="">Select a role</option>
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <Button
              type="button"
              intent="neutral"
              disabled={busy}
              onClick={closeDialog}
            >
              Cancel
            </Button>
            <Button
              type="button"
              busy={busy}
              disabled={!recipientRole}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
