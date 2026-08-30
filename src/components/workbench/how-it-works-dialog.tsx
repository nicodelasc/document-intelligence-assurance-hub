"use client";

import { Button } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";

const steps = [
  "Choose a document",
  "Choose a model",
  "Process the document",
  "Review the evidence",
  "Choose a prepared action",
] as const;

export function HowItWorksDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      title="How it works"
      description="Follow the evidence desk from document selection to a safe prepared action."
      onClose={onClose}
    >
      <ol className="how-it-works__steps">
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <p className="how-it-works__note">
        Built-in samples use deterministic evidence when live processing is unavailable and workflow controls are simulations.
      </p>
      <div className="dialog-actions">
        <Button type="button" intent="neutral" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
