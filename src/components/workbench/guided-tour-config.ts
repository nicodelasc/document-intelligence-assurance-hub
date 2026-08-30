export const workbenchTourSteps = [
  {
    targetId: "workbench-tour-document-library",
    title: "Document library",
    description:
      "Built-in documents are synthetic fixtures designed for OCR-style reading, including handwritten comments. Custom uploads should use non-sensitive test content.",
  },
  {
    targetId: "workbench-tour-processing-model",
    title: "Processing model",
    description:
      "Choose an available model. Live processing records explicit provider dispatch; a configured provider alone never counts as a provider call.",
  },
  {
    targetId: "workbench-tour-process-document",
    title: "Process document",
    description:
      "Start the agentic workflow. Untrusted document text is treated as input and no tool execution is allowed. Evaluator checks use approved references.",
  },
  {
    targetId: "workbench-tour-assurance-trace",
    title: "Assurance trace",
    description:
      "Follow observable orchestration across document understanding, evidence-grounded evaluator checks and guardrails. The trace reports what ran without claiming an autonomous platform.",
  },
  {
    targetId: "workbench-tour-decision",
    title: "Decision and next steps",
    description:
      "A human-in-the-loop reviewer sees differences and staged actions. Actions only prepare or simulate next steps and do not update external systems.",
  },
] as const;

export const workbenchTourTargetIds = {
  documentLibrary: workbenchTourSteps[0].targetId,
  processingModel: workbenchTourSteps[1].targetId,
  processDocument: workbenchTourSteps[2].targetId,
  assuranceTrace: workbenchTourSteps[3].targetId,
  decision: workbenchTourSteps[4].targetId,
} as const;
