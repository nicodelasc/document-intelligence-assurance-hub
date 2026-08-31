"use client";

import { GuidedTourDialog } from "@/components/guidance/guided-tour-dialog";
import { operationsTourSteps } from "./guided-tour-config";

function unavailableMessage() {
  if (document.querySelector(".route-error")) {
    return "Operational metrics are unavailable so the guided tour cannot start.";
  }
  if (document.querySelector('main[aria-busy="true"]')) {
    return "Operational metrics are loading. The guided tour will be ready when all five targets are stable.";
  }
  return null;
}

export function OperationsHowItWorksDialog({ onClose }: { onClose: () => void }) {
  return (
    <GuidedTourDialog
      overviewTitle="What Operations shows"
      overviewDescription="See how procurement document exceptions become reviewable before downstream handoff."
      purpose="Operations makes procurement document exceptions reviewable through the triage overview, review queue, workflow health, assurance safeguards and cost governance."
      boundary="The telemetry and guardrails are implemented. Built-in benchmark documents and reference records are synthetic. Workflow actions are simulated and no ERP, email or payment connector is called."
      steps={operationsTourSteps}
      getUnavailableMessage={unavailableMessage}
      onClose={onClose}
    />
  );
}
