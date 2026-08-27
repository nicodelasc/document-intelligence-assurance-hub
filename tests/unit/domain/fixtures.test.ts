import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { purchaseOrderReferences, recordedRunResults, syntheticInvoices } from "@/domain/fixtures";

describe("synthetic invoice fixtures", () => {
  it("contains the three required deterministic invoice cases", () => {
    expect(syntheticInvoices.map((invoice) => invoice.id)).toEqual([
      "clean-match",
      "invoice-total-mismatch",
      "missing-purchase-order",
    ]);
    expect(Object.keys(purchaseOrderReferences)).toEqual(syntheticInvoices.map((invoice) => invoice.id));
    expect(recordedRunResults.map((result) => result.outcome)).toEqual(["clear", "needs_review", "incomplete"]);
  });

  it("keeps fixture content invented and provides a PDF for every sample", () => {
    const serializedFixtures = JSON.stringify({ purchaseOrderReferences, recordedRunResults, syntheticInvoices });
    expect(serializedFixtures).not.toMatch(/Samsung|Kyndryl/i);

    for (const invoice of syntheticInvoices) {
      const bytes = readFileSync(resolve(process.cwd(), "public", "samples", invoice.filename));
      expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    }
  });
});
