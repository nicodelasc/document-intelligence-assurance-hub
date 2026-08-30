"use client";

import { GuidedTourDialog } from "@/components/guidance/guided-tour-dialog";
import { workbenchTourSteps } from "./guided-tour-config";

export function HowItWorksDialog({ onClose }: { onClose: () => void }) {
  return (
    <GuidedTourDialog
      overviewTitle="What this workbench does"
      overviewDescription="See how document evidence becomes a reviewable business decision."
      purpose="This workbench demonstrates an agentic document-assurance workflow: multimodal document understanding, evidence-grounded evaluator checks and guardrailed action preparation."
      boundary="The orchestration, validation and telemetry are implemented. Built-in documents and reference records are synthetic. Workflow controls prepare or simulate next steps but do not update external systems."
      steps={workbenchTourSteps}
      onClose={onClose}
    />
  );
}
