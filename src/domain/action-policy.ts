import type {
  ActionProposal,
  ActionStatus,
  Outcome,
  SyntheticFixture,
} from "./types";

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
): ActionProposal {
  const status = statusForVerifiedOutcome(outcome, fixture);
  if (!fixture) {
    return {
      ...proposed,
      status,
      reason:
        outcome === "not_found"
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
