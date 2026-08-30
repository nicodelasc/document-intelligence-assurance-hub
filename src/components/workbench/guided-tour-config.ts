export const workbenchTourSteps = [
  {
    targetId: "workbench-tour-document-library",
    title: "Document library",
    description:
      "Choose a built-in supplier invoice or goods receipt. You can also add your own non-sensitive test document.",
  },
  {
    targetId: "workbench-tour-processing-model",
    title: "Processing model",
    description:
      "Choose which available AI model reads the document. Recommended labels balance capability and estimated cost.",
  },
  {
    targetId: "workbench-tour-process-document",
    title: "Process document",
    description:
      "Start the review. The workbench extracts requested details then checks them against reference evidence.",
  },
  {
    targetId: "workbench-tour-assurance-trace",
    title: "Assurance trace",
    description:
      "Follow the three assurance stages to see the document being understood, verified and prepared for a safe decision.",
  },
  {
    targetId: "workbench-tour-decision",
    title: "Decision and next steps",
    description:
      "Review the result, evidence differences and prepared actions. Nothing is sent or posted automatically.",
  },
] as const;

export const workbenchTourTargetIds = {
  documentLibrary: workbenchTourSteps[0].targetId,
  processingModel: workbenchTourSteps[1].targetId,
  processDocument: workbenchTourSteps[2].targetId,
  assuranceTrace: workbenchTourSteps[3].targetId,
  decision: workbenchTourSteps[4].targetId,
} as const;
