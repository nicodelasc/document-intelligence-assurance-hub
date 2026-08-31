"use client";

import { GuidedTourDialog } from "@/components/guidance/guided-tour-dialog";
import { workbenchTourSteps } from "./guided-tour-config";

export function HowItWorksDialog({ onClose }: { onClose: () => void }) {
  return (
    <GuidedTourDialog
      overviewTitle="How procurement exception triage works"
      overviewDescription="See how manual invoice and goods-receipt review becomes a controlled exception decision."
      purpose="Finance and warehouse teams can use this agentic workflow to understand documents, verify evidence and prepare a guardrailed handoff before a posting decision."
      boundary="Document understanding, comparison, evaluator safeguards and workflow preparation are implemented. Documents and reference records are synthetic. ERP, payment, inventory and email systems are not changed."
      steps={workbenchTourSteps}
      onClose={onClose}
    />
  );
}
