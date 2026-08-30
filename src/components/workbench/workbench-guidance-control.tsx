"use client";

import { CircleHelp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { HowItWorksDialog } from "./how-it-works-dialog";

export function WorkbenchGuidanceControl() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        intent="primary"
        className="workbench-guidance-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <CircleHelp size={18} strokeWidth={1.75} aria-hidden="true" />
        How it works
      </Button>
      {open ? <HowItWorksDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
