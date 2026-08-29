import { describe, expect, it } from "vitest";
import { applyActionPolicy } from "@/domain/action-policy";
import { syntheticFixtures } from "@/domain/fixtures";
import type { ActionProposal } from "@/domain/types";

function findFixture(id: string) {
  const fixture = syntheticFixtures.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Missing fixture: ${id}`);
  return fixture;
}

const proposal: ActionProposal = {
  type: "stage_inventory_receipt",
  title: "Stage inventory receipt",
  summary:
    "Post the verified received quantity to the internal inventory queue.",
  payload: [{ label: "Shipment ID", value: "SHIP-4018" }],
  instructionEvidence: null,
  page: 1,
  risk: "low",
  status: "ready",
  reason: "Model recommendation.",
  stagedAt: null,
};

describe("applyActionPolicy", () => {
  it("applies each fixture action to its verified outcome", () => {
    for (const fixture of syntheticFixtures) {
      expect(
        applyActionPolicy(fixture.expectedOutcome, proposal, fixture),
      ).toMatchObject({
        type: fixture.action.type,
        status: fixture.action.status,
      });
    }
  });

  it("sets custom evidence statuses without a fixture", () => {
    expect(
      applyActionPolicy("evidence_consistent", proposal, null).status,
    ).toBe("ready");
    expect(applyActionPolicy("conflict", proposal, null).status).toBe(
      "needs_review",
    );
    expect(applyActionPolicy("not_found", proposal, null)).toMatchObject({
      status: "blocked",
      reason:
        "Incomplete evidence - one or more requested fields were not found",
    });
  });

  it("does not stage a clear action when the verified outcome conflicts with fixture truth", () => {
    expect(
      applyActionPolicy(
        "clear",
        proposal,
        findFixture("invoice-unreadable-approval"),
      ).status,
    ).toBe("needs_review");
  });
});
