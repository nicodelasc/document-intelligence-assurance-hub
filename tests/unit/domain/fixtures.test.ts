import { describe, expect, it } from "vitest";
import {
  recordedDocumentRunResults,
  syntheticFixtures,
} from "@/domain/fixtures";

describe("synthetic document fixtures", () => {
  it("contains the ordered ten-fixture invoice and warehouse matrix", () => {
    expect(syntheticFixtures.map((fixture) => fixture.id)).toEqual([
      "invoice-clean-match",
      "invoice-buyer-hold",
      "invoice-unreadable-approval",
      "invoice-total-mismatch",
      "invoice-po-currency-mismatch",
      "warehouse-clean-receipt",
      "warehouse-quantity-correction",
      "warehouse-unreadable-damage-note",
      "warehouse-quantity-mismatch",
      "warehouse-item-lot-mismatch",
    ]);
    expect(
      Object.groupBy(syntheticFixtures, (fixture) => fixture.family),
    ).toMatchObject({
      supplier_invoice: expect.arrayContaining([expect.any(Object)]),
      warehouse_goods_receipt: expect.arrayContaining([expect.any(Object)]),
    });
    expect(
      syntheticFixtures.filter(
        (fixture) => fixture.family === "supplier_invoice",
      ),
    ).toHaveLength(5);
    expect(
      syntheticFixtures.filter(
        (fixture) => fixture.family === "warehouse_goods_receipt",
      ),
    ).toHaveLength(5);
    expect(syntheticFixtures.map((fixture) => fixture.classification)).toEqual([
      "correct",
      "attention",
      "attention",
      "incorrect",
      "incorrect",
      "correct",
      "attention",
      "attention",
      "incorrect",
      "incorrect",
    ]);
    expect(
      syntheticFixtures.map((fixture) => fixture.expectedOutcome).sort(),
    ).toEqual([
      "clear",
      "clear",
      "incomplete",
      "incomplete",
      "needs_review",
      "needs_review",
      "needs_review",
      "needs_review",
      "needs_review",
      "needs_review",
    ]);
    expect(recordedDocumentRunResults).toHaveLength(10);
  });

  it("keeps the complete business classification contract bound to each fixture ID", () => {
    expect(
      syntheticFixtures.map((fixture) => [
        fixture.id,
        fixture.family,
        fixture.classification,
        fixture.attentionReason,
        fixture.expectedOutcome,
      ]),
    ).toEqual([
      ["invoice-clean-match", "supplier_invoice", "correct", "none", "clear"],
      [
        "invoice-buyer-hold",
        "supplier_invoice",
        "attention",
        "manual_instruction",
        "needs_review",
      ],
      [
        "invoice-unreadable-approval",
        "supplier_invoice",
        "attention",
        "unreadable_critical_evidence",
        "incomplete",
      ],
      [
        "invoice-total-mismatch",
        "supplier_invoice",
        "incorrect",
        "reference_conflict",
        "needs_review",
      ],
      [
        "invoice-po-currency-mismatch",
        "supplier_invoice",
        "incorrect",
        "reference_conflict",
        "needs_review",
      ],
      [
        "warehouse-clean-receipt",
        "warehouse_goods_receipt",
        "correct",
        "none",
        "clear",
      ],
      [
        "warehouse-quantity-correction",
        "warehouse_goods_receipt",
        "attention",
        "manual_correction",
        "needs_review",
      ],
      [
        "warehouse-unreadable-damage-note",
        "warehouse_goods_receipt",
        "attention",
        "unreadable_critical_evidence",
        "incomplete",
      ],
      [
        "warehouse-quantity-mismatch",
        "warehouse_goods_receipt",
        "incorrect",
        "reference_conflict",
        "needs_review",
      ],
      [
        "warehouse-item-lot-mismatch",
        "warehouse_goods_receipt",
        "incorrect",
        "reference_conflict",
        "needs_review",
      ],
    ]);
  });

  it("keeps every scenario invented and action metadata aligned to its outcome", () => {
    const serializedFixtures = JSON.stringify(syntheticFixtures);
    expect(serializedFixtures).not.toMatch(/Samsung|Kyndryl/i);
    expect(syntheticFixtures.map((fixture) => fixture.attentionReason)).toEqual(
      [
        "none",
        "manual_instruction",
        "unreadable_critical_evidence",
        "reference_conflict",
        "reference_conflict",
        "none",
        "manual_correction",
        "unreadable_critical_evidence",
        "reference_conflict",
        "reference_conflict",
      ],
    );
  });

  it("keeps document evidence independent from trusted reference data", () => {
    const invoice = syntheticFixtures.find(
      (fixture) => fixture.id === "invoice-total-mismatch",
    );

    expect(invoice?.documentData.invoice_total).not.toBe(
      invoice?.referenceData.invoice_total,
    );
  });

  it("uses document-family field contracts", () => {
    const invoiceFields = [
      "supplier",
      "invoice_number",
      "purchase_order_number",
      "invoice_date",
      "currency",
      "invoice_total",
      "payment_terms",
      "reviewer_comments",
    ];
    const warehouseFields = [
      "goods_receipt_number",
      "delivery_note_number",
      "purchase_order_number",
      "item_code",
      "lot_number",
      "expected_quantity",
      "received_quantity",
      "damaged_quantity",
      "receiver_comments",
    ];
    for (const fixture of syntheticFixtures) {
      expect(fixture.requestedFields.map((field) => field.key)).toEqual(
        fixture.family === "supplier_invoice" ? invoiceFields : warehouseFields,
      );
    }
  });
});
