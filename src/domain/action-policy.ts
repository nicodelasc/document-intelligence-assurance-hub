import type {
  ActionProposal,
  ActionStatus,
  DocumentClassification,
  Outcome,
  SyntheticFixture,
} from "./types";

const guardedDocumentAction: ActionProposal = {
  type: "create_document_review_task",
  title: "Replace document",
  summary:
    "This does not appear to be a supported supplier invoice or warehouse goods receipt. No workflow action was prepared.",
  payload: [
    {
      label: "Next step",
      value:
        "Replace document with a supported supplier invoice or warehouse goods receipt.",
    },
  ],
  instructionEvidence: null,
  page: null,
  risk: "low",
  status: "blocked",
  reason:
    "This does not appear to be a supported supplier invoice or warehouse goods receipt. No workflow action was prepared.",
  stagedAt: null,
};

function statusForVerifiedOutcome(
  outcome: Outcome,
  fixture: SyntheticFixture | null,
): ActionStatus {
  if (outcome === "incomplete" || outcome === "not_found") return "blocked";
  if (outcome === "conflict" || outcome === "needs_review")
    return "needs_review";
  if (outcome === "evidence_consistent" && fixture === null) return "ready";
  if (!fixture || fixture.expectedOutcome !== outcome) return "needs_review";
  return fixture.action.status;
}

export function applyActionPolicy(
  outcome: Outcome,
  proposed: ActionProposal,
  fixture: SyntheticFixture | null,
  documentClassification?: DocumentClassification,
): ActionProposal {
  if (
    documentClassification === "irrelevant" ||
    documentClassification === "uncertain"
  ) {
    return structuredClone(guardedDocumentAction);
  }
  const status = statusForVerifiedOutcome(outcome, fixture);
  if (!fixture) {
    return {
      ...proposed,
      status,
      reason:
        outcome === "evidence_consistent"
          ? "Evidence is consistent. The action is ready for internal dry-run staging."
          : outcome === "not_found"
            ? "Incomplete evidence - one or more requested fields were not found"
            : status === "blocked"
              ? "Required evidence is incomplete."
              : "Custom documents require review before staging.",
    };
  }

  return {
    ...fixture.action,
    status,
    reason:
      fixture.expectedOutcome === outcome
        ? fixture.action.reason
        : "Verified outcome conflicts with the fixture expectation.",
  };
}
