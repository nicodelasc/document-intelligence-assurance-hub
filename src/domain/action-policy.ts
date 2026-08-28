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
  if (outcome === "incomplete") return "blocked";
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
        status === "blocked"
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
