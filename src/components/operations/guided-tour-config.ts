export const operationsTourSteps = [
  {
    targetId: "operations-tour-run-overview",
    title: "Triage overview",
    description:
      "These metrics summarise procurement documents triaged before downstream handoff. They are anonymous demo telemetry and not production SLAs.",
  },
  {
    targetId: "operations-tour-evidence-explorer",
    title: "Procurement review queue",
    description:
      "Follow each document reference, document type, review decision, exception and prepared next step. Select a record to inspect its technical trace.",
  },
  {
    targetId: "operations-tour-workflow-health",
    title: "Workflow health",
    description:
      "Workflow health shows human-in-the-loop queues plus prepared, staged and simulated events. These events record simulated preparation only; none represents an external action.",
  },
  {
    targetId: "operations-tour-assurance-safeguards",
    title: "Assurance safeguards",
    description:
      "The provider-neutral synthetic contract baseline tests deterministic evaluator checks and guardrails. It is not model accuracy or provider-call coverage.",
  },
  {
    targetId: "operations-tour-cost-governance",
    title: "Cost governance",
    description:
      "Cost governance uses dated cost estimates and an illustrative savings scenario. Estimates are not invoices or measured savings.",
  },
] as const;

export const operationsTourTargetIds = {
  runOverview: operationsTourSteps[0].targetId,
  evidenceExplorer: operationsTourSteps[1].targetId,
  workflowHealth: operationsTourSteps[2].targetId,
  assuranceSafeguards: operationsTourSteps[3].targetId,
  costGovernance: operationsTourSteps[4].targetId,
} as const;
