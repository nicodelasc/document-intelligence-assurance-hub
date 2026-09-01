import { describe, expect, it } from "vitest";
import {
  allowedRecipientRoles,
  allowedWorkflowActionsForRun,
  createEmailPreview,
  recipientRoleAllowed,
  workflowActionRequiresRecipient,
  workflowStatusForAction,
} from "@/domain/workflow-actions";
import type { FieldResult, WorkflowActionType } from "@/domain/types";

function field(overrides: Partial<FieldResult> = {}): FieldResult {
  return {
    key: "invoice_total",
    label: "Invoice total",
    extractedValue: "SGD 1,250.00",
    normalizedValue: "1250.00",
    evidence: "Total SGD 1,250.00",
    page: 1,
    evaluatorStatus: "conflict",
    referenceMatch: false,
    ...overrides,
  };
}

describe("workflow action policy", () => {
  it.each(["clear", "evidence_consistent"] as const)(
    "requires review actions for an unverified %s result",
    (outcome) => {
      expect(
        allowedWorkflowActionsForRun({
          status: "completed",
          outcome,
          documentClassification: "supplier_invoice",
          sourceOriginStatus: "unverified",
        }),
      ).toEqual(["assign_review", "prepare_email"]);
    },
  );

  it.each([
    {
      status: "completed" as const,
      outcome: "clear" as const,
      expected: ["approve_and_stage"],
    },
    {
      status: "completed" as const,
      outcome: "evidence_consistent" as const,
      expected: ["approve_and_stage"],
    },
    {
      status: "completed" as const,
      outcome: "needs_review" as const,
      expected: [
        "assign_review",
        "prepare_email",
      ],
    },
    {
      status: "completed" as const,
      outcome: "conflict" as const,
      expected: [
        "assign_review",
        "prepare_email",
      ],
    },
    {
      status: "completed" as const,
      outcome: "incomplete" as const,
      expected: [
        "request_clearer_document",
        "assign_review",
        "replace_document",
      ],
    },
    {
      status: "completed" as const,
      outcome: "not_found" as const,
      expected: [
        "request_clearer_document",
        "assign_review",
        "replace_document",
      ],
    },
  ])(
    "returns the exact actions for $outcome",
    ({ status, outcome, expected }) => {
      expect(allowedWorkflowActionsForRun({ status, outcome })).toEqual(
        expected,
      );
    },
  );

  it("restricts failed runs to recovery actions", () => {
    expect(
      allowedWorkflowActionsForRun({ status: "failed", outcome: null }),
    ).toEqual(["retry_processing"]);
  });

  it.each(["expired", "deleted", "extracting"] as const)(
    "blocks workflow actions for %s runs",
    (status) => {
      expect(allowedWorkflowActionsForRun({ status, outcome: null })).toEqual(
        [],
      );
    },
  );

  it("blocks completed runs without a verified outcome", () => {
    expect(
      allowedWorkflowActionsForRun({ status: "completed", outcome: null }),
    ).toEqual([]);
  });

  it.each(["irrelevant", "uncertain"] as const)(
    "limits a guarded %s document to replacement",
    (documentClassification) => {
      const guardedRun = {
        status: "completed" as const,
        outcome: "not_found" as const,
        documentClassification,
      } as Parameters<typeof allowedWorkflowActionsForRun>[0];

      expect(allowedWorkflowActionsForRun(guardedRun)).toEqual([
        "replace_document",
      ]);
    },
  );

  it.each(["irrelevant", "uncertain"] as const)(
    "limits a failed guarded %s document to replacement",
    (documentClassification) => {
      expect(
        allowedWorkflowActionsForRun({
          status: "failed",
          outcome: null,
          documentClassification,
        }),
      ).toEqual(["replace_document"]);
    },
  );

  it("keeps returned action allowlists immutable at runtime", () => {
    const actions = allowedWorkflowActionsForRun({
      status: "completed",
      outcome: "clear",
    });

    expect(Object.isFrozen(actions)).toBe(true);
    expect(() =>
      (actions as WorkflowActionType[]).push("retry_processing"),
    ).toThrow();
    expect(
      allowedWorkflowActionsForRun({ status: "completed", outcome: "clear" }),
    ).toEqual(["approve_and_stage"]);
  });
});

describe("workflow recipient policy", () => {
  it("returns the exact server-owned role catalogues", () => {
    expect(allowedRecipientRoles("supplier_invoice")).toEqual([
      "Accounts Payable Analyst",
      "Buyer",
      "Supplier Contact",
    ]);
    expect(allowedRecipientRoles("warehouse_goods_receipt")).toEqual([
      "Warehouse Lead",
      "Buyer",
      "Supplier Contact",
    ]);
    expect(allowedRecipientRoles(null)).toEqual(["Document Owner", "Reviewer"]);
  });

  it("keeps returned role catalogues immutable at runtime", () => {
    const roles = allowedRecipientRoles("supplier_invoice");

    expect(Object.isFrozen(roles)).toBe(true);
    expect(() => (roles as string[]).push("Executive Sponsor")).toThrow();
    expect(allowedRecipientRoles("supplier_invoice")).not.toContain(
      "Executive Sponsor",
    );
  });

  it("requires one allowed role only for recipient-bearing actions", () => {
    expect(
      recipientRoleAllowed("prepare_email", "supplier_invoice", null),
    ).toBe(false);
    expect(
      recipientRoleAllowed("prepare_email", "supplier_invoice", "Buyer"),
    ).toBe(true);
    expect(
      recipientRoleAllowed(
        "prepare_email",
        "supplier_invoice",
        "Warehouse Lead",
      ),
    ).toBe(false);
    expect(recipientRoleAllowed("assign_review", null, "Document Owner")).toBe(
      true,
    );
  });

  it("requires a null role for actions that do not use recipients", () => {
    expect(
      recipientRoleAllowed("retry_processing", "supplier_invoice", "Buyer"),
    ).toBe(false);
    expect(
      recipientRoleAllowed("retry_processing", "supplier_invoice", null),
    ).toBe(true);
  });

  it("classifies which actions require a recipient role", () => {
    expect(workflowActionRequiresRecipient("assign_review")).toBe(true);
    expect(workflowActionRequiresRecipient("request_clarification")).toBe(true);
    expect(workflowActionRequiresRecipient("request_clearer_document")).toBe(
      true,
    );
    expect(workflowActionRequiresRecipient("prepare_email")).toBe(true);
    expect(workflowActionRequiresRecipient("download_summary")).toBe(false);
  });
});

describe("workflow event status", () => {
  it("maps posting handoff and prepared email actions to prepared status", () => {
    expect(workflowStatusForAction("approve_and_stage")).toBe("prepared");
    expect(workflowStatusForAction("prepare_email")).toBe("prepared");
  });

  it.each([
    "mark_for_later_review",
    "assign_review",
    "request_clarification",
    "request_clearer_document",
    "replace_document",
    "retry_processing",
    "download_summary",
  ] as const)("maps %s to a simulated status", (action) => {
    expect(workflowStatusForAction(action)).toBe("simulated");
  });
});

describe("prepared email preview", () => {
  it("creates bounded prepared-only copy with address-like evidence redacted", () => {
    const preview = createEmailPreview({
      runId: "run-workflow-123",
      outcome: "needs_review",
      recipientRole: "Buyer",
      fields: [
        field({
          label: "Contact alex@example.com",
          extractedValue: "alex@intranet",
        }),
        field({
          key: "comment",
          label: "Reviewer @ note",
          extractedValue: "Follow up via mailto:case.owner@example.org",
        }),
        ...Array.from({ length: 6 }, (_, index) =>
          field({
            key: `difference_${index}`,
            label: `Difference ${index}`,
            extractedValue: `Value ${index}`,
          }),
        ),
      ],
    });

    expect(preview.deliveryStatus).toBe("prepared_only_not_sent");
    expect(preview.subject).toContain("Prepared only - not sent");
    expect(preview.subject).toContain("run-workflow-123");
    expect(preview.body).toContain("Outcome: needs review");
    expect(preview.body).toContain("[address redacted]");
    expect(preview.body).toContain("alex[at redacted]intranet");
    expect(preview.body).toContain("Reviewer [at redacted] note");
    expect(preview.body).not.toContain("Difference 4");
    expect(`${preview.subject}\n${preview.body}`).not.toContain("@");
  });

  it("removes control characters from run-derived email fragments", () => {
    const preview = createEmailPreview({
      runId: "run-safe-123",
      outcome: "conflict",
      recipientRole: "Reviewer",
      fields: [
        field({
          label: "Invoice\u0000 total",
          extractedValue: "SGD\u0007 999.00",
        }),
      ],
    });

    expect(preview.body).toContain("Invoice total: SGD 999.00");
    expect(preview.body).not.toContain("\u0000");
    expect(preview.body).not.toContain("\u0007");
  });

  it("states when a passing run has no recorded discrepancies", () => {
    const preview = createEmailPreview({
      runId: "run-clear-123",
      outcome: "clear",
      recipientRole: "Buyer",
      fields: [field({ evaluatorStatus: "pass", referenceMatch: true })],
    });

    expect(preview.body).toContain("No discrepancies were recorded.");
  });
});
