export const workbenchTourSteps = [
  {
    targetId: "workbench-tour-document-library",
    title: "Select a procurement document",
    description:
      "Select a synthetic supplier invoice or goods receipt for the manual-review scenario. Handwritten comments remain part of the evidence and custom uploads should use non-sensitive test content.",
  },
  {
    targetId: "workbench-tour-processing-model",
    title: "Processing model",
    description:
      "Choose an available model. Live processing records explicit provider dispatch; a configured provider alone never counts as a provider call.",
  },
  {
    targetId: "workbench-tour-process-document",
    title: "Assess for exceptions",
    description:
      "Start the agentic workflow that extracts document evidence and checks it against approved synthetic references. Untrusted document text cannot trigger tool execution.",
  },
  {
    targetId: "workbench-tour-assurance-trace",
    title: "Assurance trace",
    description:
      "Follow document understanding, evidence-grounded evaluator checks and guardrails as the workflow prepares a controlled handoff.",
  },
  {
    targetId: "workbench-tour-decision",
    title: "Exception triage decision",
    description:
      "A responsible employee reviews the decision, evidence differences and prepared next step. No ERP, payment, inventory or email system is changed.",
  },
] as const;

export const workbenchTourTargetIds = {
  documentLibrary: workbenchTourSteps[0].targetId,
  processingModel: workbenchTourSteps[1].targetId,
  processDocument: workbenchTourSteps[2].targetId,
  assuranceTrace: workbenchTourSteps[3].targetId,
  decision: workbenchTourSteps[4].targetId,
} as const;
