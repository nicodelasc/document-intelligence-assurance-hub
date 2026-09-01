import { describe, expect, it } from "vitest";
import { applyActionPolicy } from "@/domain/action-policy";
import { syntheticFixtures } from "@/domain/fixtures";
import type { ActionProposal } from "@/domain/types";

const guardedActionPolicy = applyActionPolicy as (
  outcome: Parameters<typeof applyActionPolicy>[0],
  proposed: Parameters<typeof applyActionPolicy>[1],
  fixture: Parameters<typeof applyActionPolicy>[2],
  documentClassification: "irrelevant" | "uncertain",
) => ActionProposal;

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

  it("describes a custom evidence-consistent result as ready for posting handoff preparation", () => {
    expect(
      applyActionPolicy("evidence_consistent", proposal, null),
    ).toMatchObject({
      status: "ready",
      reason:
        "Evidence is consistent. The action is ready for posting handoff preparation.",
    });
  });

  it("requires review when evidence-consistent custom content has an unverified source", () => {
    expect(
      applyActionPolicy(
        "evidence_consistent",
        proposal,
        null,
        "supplier_invoice",
        "unverified",
      ),
    ).toMatchObject({
      status: "needs_review",
      reason:
        "Evidence was extracted consistently but the source is unverified. Assign a reviewer before any posting handoff.",
    });
  });

  it("describes a custom conflict as requiring review before handoff preparation", () => {
    expect(applyActionPolicy("conflict", proposal, null)).toMatchObject({
      status: "needs_review",
      reason: "Custom documents require review before a handoff is prepared.",
    });
  });

  it("blocks a custom result when requested evidence was not found", () => {
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

  it.each(["irrelevant", "uncertain"] as const)(
    "replaces the complete provider action for a guarded %s document",
    (documentClassification) => {
      expect(
        guardedActionPolicy(
          "evidence_consistent",
          proposal,
          null,
          documentClassification,
        ),
      ).toEqual({
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
      });
    },
  );
});
