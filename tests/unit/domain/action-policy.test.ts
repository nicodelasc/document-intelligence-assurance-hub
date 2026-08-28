import { describe, expect, it } from "vitest";
import { applyActionPolicy } from "@/domain/action-policy";
import { syntheticFixtures } from "@/domain/fixtures";
import type { ActionProposal } from "@/domain/types";

const proposal: ActionProposal = {
  type: "stage_inventory_receipt",
  title: "Stage inventory receipt",
  summary: "Post the verified received quantity to the internal inventory queue.",
  payload: [{ label: "Shipment ID", value: "SHIP-4018" }],
  instructionEvidence: null,
  page: 1,
  risk: "low",
  status: "ready",
  reason: "Model recommendation.",
  stagedAt: null,
};

describe("applyActionPolicy", () => {
  it("keeps an expected clear warehouse result ready for staging", () => {
    expect(
      applyActionPolicy("clear", proposal, syntheticFixtures[1]),
    ).toMatchObject({ status: "ready", type: "stage_inventory_receipt" });
  });

  it("requires review for the expected invoice exception", () => {
    expect(
      applyActionPolicy("needs_review", proposal, syntheticFixtures[0]),
    ).toMatchObject({ status: "needs_review", type: "create_ap_exception_case" });
  });

  it("blocks a visitor action when required approval evidence is incomplete", () => {
    expect(
      applyActionPolicy("incomplete", proposal, syntheticFixtures[2]),
    ).toMatchObject({ status: "blocked", type: "create_security_review" });
  });

  it("does not stage a clear action when the verified outcome conflicts with fixture truth", () => {
    expect(
      applyActionPolicy("clear", proposal, syntheticFixtures[2]).status,
    ).toBe("needs_review");
  });
});
