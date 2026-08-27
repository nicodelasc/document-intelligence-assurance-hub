import { describe, expect, it } from "vitest";
import { decideOutcome } from "@/domain/outcomes";
import type { FieldResult } from "@/domain/types";

function field(overrides: Partial<FieldResult> = {}): FieldResult {
  return {
    key: "invoice_number",
    label: "Invoice number",
    extractedValue: "INV-1001",
    normalizedValue: "INV-1001",
    evidence: "Invoice no. INV-1001",
    page: 1,
    evaluatorStatus: "pass",
    referenceMatch: true,
    ...overrides,
  };
}

describe("decideOutcome", () => {
  it("marks a synthetic run incomplete when any field is missing", () => {
    expect(
      decideOutcome({ sourceType: "synthetic", fields: [field({ extractedValue: null })] }),
    ).toBe("incomplete");
  });

  it("marks a synthetic conflict or reference mismatch for review", () => {
    expect(
      decideOutcome({ sourceType: "synthetic", fields: [field({ evaluatorStatus: "conflict" })] }),
    ).toBe("needs_review");
    expect(decideOutcome({ sourceType: "synthetic", fields: [field({ referenceMatch: false })] })).toBe(
      "needs_review",
    );
  });

  it("marks a fully supported synthetic run clear", () => {
    expect(decideOutcome({ sourceType: "synthetic", fields: [field()] })).toBe("clear");
  });

  it("marks a custom conflict as conflict", () => {
    expect(decideOutcome({ sourceType: "custom", fields: [field({ evaluatorStatus: "conflict" })] })).toBe(
      "conflict",
    );
  });

  it("marks custom runs with every field not found as not found", () => {
    expect(
      decideOutcome({ sourceType: "custom", fields: [field({ evaluatorStatus: "not_found" })] }),
    ).toBe("not_found");
  });

  it("marks other custom evidence as consistent", () => {
    expect(decideOutcome({ sourceType: "custom", fields: [field()] })).toBe("evidence_consistent");
  });
});
