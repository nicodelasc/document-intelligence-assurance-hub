export const operationsTourSteps = [
  {
    targetId: "operations-tour-run-overview",
    title: "Run overview",
    description:
      "These metrics are anonymous demo telemetry for run outcomes and processing health. They are not production SLAs.",
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
    targetId: "operations-tour-evidence-explorer",
    title: "Evidence explorer",
    description:
      "Use retained evidence, safe diagnostics and confirmed dispatch attribution to inspect a run without exposing secrets. Configured provider values remain separate from confirmed provider calls.",
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
  workflowHealth: operationsTourSteps[1].targetId,
  assuranceSafeguards: operationsTourSteps[2].targetId,
  evidenceExplorer: operationsTourSteps[3].targetId,
  costGovernance: operationsTourSteps[4].targetId,
} as const;
