"use client";

import { CircleHelp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/primitives";

export function GuidanceControl({
  renderDialog,
}: {
  renderDialog: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <Button
        type="button"
        intent="primary"
        className="guidance-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <CircleHelp size={18} strokeWidth={1.75} aria-hidden="true" />
        How it works
      </Button>
      {open ? renderDialog(close) : null}
    </>
  );
}
