import type {
  ActionProposal,
  FieldResult,
  Outcome,
  SyntheticFixture,
} from "./types";

const invoiceFields: SyntheticFixture["requestedFields"] = [
  ["supplier", "Supplier"],
  ["invoice_number", "Invoice number"],
  ["purchase_order_number", "Purchase-order number"],
  ["invoice_date", "Invoice date"],
  ["currency", "Currency"],
  ["invoice_total", "Invoice total"],
  ["payment_terms", "Payment terms"],
  ["reviewer_comments", "Reviewer comments"],
].map(([key, label]) => ({ key, label }));
const warehouseFields: SyntheticFixture["requestedFields"] = [
  ["goods_receipt_number", "Goods receipt number"],
  ["delivery_note_number", "Delivery note number"],
  ["purchase_order_number", "Purchase-order number"],
  ["item_code", "Item code"],
  ["lot_number", "Lot number"],
  ["expected_quantity", "Expected quantity"],
  ["received_quantity", "Received quantity"],
  ["damaged_quantity", "Damaged quantity"],
  ["receiver_comments", "Receiver comments"],
].map(([key, label]) => ({ key, label }));

function record(
  keys: SyntheticFixture["requestedFields"],
  values: Array<string | null>,
) {
  return Object.fromEntries(
    keys.map((field, index) => [field.key, values[index] ?? null]),
  );
}
function action(
  type: ActionProposal["type"],
  status: ActionProposal["status"],
  title: string,
  instructionEvidence: string,
  payload: ActionProposal["payload"],
): ActionProposal {
  return {
    type,
    title,
    summary:
      status === "ready"
        ? "Prepare the verified document for a responsible posting decision."
        : "Keep the document pending exception review or clearer evidence.",
    payload,
    instructionEvidence,
    page: 1,
    risk:
      status === "blocked"
        ? "high"
        : status === "needs_review"
          ? "medium"
          : "low",
    status,
    reason:
      status === "ready"
        ? "Document evidence matches the trusted reference."
        : status === "blocked"
          ? "Required evidence cannot be read reliably."
          : "Document evidence requires reviewer confirmation.",
    stagedAt: null,
  };
}

type InvoiceValues = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string | null,
];
type WarehouseValues = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string | null,
];
function invoice(
  id: string,
  org: string,
  classification: SyntheticFixture["classification"],
  label: string,
  attentionReason: SyntheticFixture["attentionReason"],
  values: InvoiceValues,
  reference: InvoiceValues,
  outcome: Outcome,
  note: string,
  legibility: "legible" | "unclear",
  differences: string[],
): SyntheticFixture {
  const status =
    outcome === "clear"
      ? "ready"
      : outcome === "incomplete"
        ? "blocked"
        : "needs_review";
  return {
    id,
    filename: id + ".pdf",
    title: org + " invoice",
    description: label,
    family: "supplier_invoice",
    classification,
    variantLabel: label,
    differenceSummary: differences,
    attentionReason,
    handwrittenEvidence: {
      fieldKey: "reviewer_comments",
      text: note,
      legibility,
    },
    requestedFields: invoiceFields,
    documentData: record(invoiceFields, values),
    referenceData: record(invoiceFields, reference),
    expectedOutcome: outcome,
    action: action(
      "create_ap_exception_case",
      status,
      outcome === "clear"
        ? "Prepare supplier invoice posting handoff"
        : outcome === "incomplete"
          ? "Request readable invoice evidence"
          : "Review supplier invoice exception",
      note,
      [
        { label: "Supplier", value: org },
        { label: "Invoice number", value: values[1] },
        { label: "Invoice total", value: values[5] },
      ],
    ),
  };
}
function warehouse(
  id: string,
  org: string,
  classification: SyntheticFixture["classification"],
  label: string,
  attentionReason: SyntheticFixture["attentionReason"],
  values: WarehouseValues,
  reference: WarehouseValues,
  outcome: Outcome,
  note: string,
  legibility: "legible" | "unclear",
  differences: string[],
): SyntheticFixture {
  const status =
    outcome === "clear"
      ? "ready"
      : outcome === "incomplete"
        ? "blocked"
        : "needs_review";
  return {
    id,
    filename: id + ".pdf",
    title: org + " goods receipt",
    description: label,
    family: "warehouse_goods_receipt",
    classification,
    variantLabel: label,
    differenceSummary: differences,
    attentionReason,
    handwrittenEvidence: {
      fieldKey: "receiver_comments",
      text: note,
      legibility,
    },
    requestedFields: warehouseFields,
    documentData: record(warehouseFields, values),
    referenceData: record(warehouseFields, reference),
    expectedOutcome: outcome,
    action: action(
      "stage_inventory_receipt",
      status,
      outcome === "clear"
        ? "Prepare goods receipt posting handoff"
        : outcome === "incomplete"
          ? "Request readable receipt evidence"
          : "Review goods receipt exception",
      note,
      [
        { label: "Goods receipt number", value: values[0] },
        { label: "Item code", value: values[3] },
        { label: "Received quantity", value: values[6] },
      ],
    ),
  };
}

export const syntheticFixtures: readonly SyntheticFixture[] = [
  invoice(
    "invoice-clean-match",
    "Northstar Office Supply",
    "correct",
    "Clean match",
    "none",
    [
      "Northstar Office Supply",
      "INV-NOS-1001",
      "PO-NOS-1001",
      "2026-08-12",
      "SGD",
      "1250.00 SGD",
      "Net 30",
      "Approved for standard payment.",
    ],
    [
      "Northstar Office Supply",
      "INV-NOS-1001",
      "PO-NOS-1001",
      "2026-08-12",
      "SGD",
      "1250.00 SGD",
      "Net 30",
      "Approved for standard payment.",
    ],
    "clear",
    "Approved for standard payment.",
    "legible",
    ["All invoice values match the trusted reference."],
  ),
  invoice(
    "invoice-buyer-hold",
    "Harborline Components",
    "attention",
    "Buyer hold",
    "manual_instruction",
    [
      "Harborline Components",
      "INV-HC-2101",
      "PO-HC-2101",
      "2026-08-13",
      "SGD",
      "840.00 SGD",
      "Net 45",
      "Hold payment until buyer confirmation.",
    ],
    [
      "Harborline Components",
      "INV-HC-2101",
      "PO-HC-2101",
      "2026-08-13",
      "SGD",
      "840.00 SGD",
      "Net 45",
      "Approved for payment.",
    ],
    "needs_review",
    "Hold payment until buyer confirmation.",
    "legible",
    ["Handwritten payment hold differs from the reference note."],
  ),
  invoice(
    "invoice-unreadable-approval",
    "Vireo Industrial Goods",
    "attention",
    "Unreadable approval",
    "unreadable_critical_evidence",
    [
      "Vireo Industrial Goods",
      "INV-VIG-3101",
      "PO-VIG-3101",
      "2026-08-14",
      "SGD",
      "460.00 SGD",
      "Net 30",
      null,
    ],
    [
      "Vireo Industrial Goods",
      "INV-VIG-3101",
      "PO-VIG-3101",
      "2026-08-14",
      "SGD",
      "460.00 SGD",
      "Net 30",
      "Approved by procurement.",
    ],
    "incomplete",
    "Unreadable handwritten approval note.",
    "unclear",
    ["Critical handwritten approval note is unreadable."],
  ),
  invoice(
    "invoice-total-mismatch",
    "Meridian Packaging",
    "incorrect",
    "Total mismatch",
    "reference_conflict",
    [
      "Meridian Packaging",
      "INV-MP-4101",
      "PO-MP-4101",
      "2026-08-15",
      "SGD",
      "1890.00 SGD",
      "Net 30",
      "Verify total against PO before release.",
    ],
    [
      "Meridian Packaging",
      "INV-MP-4101",
      "PO-MP-4101",
      "2026-08-15",
      "SGD",
      "1750.00 SGD",
      "Net 30",
      "Verify total against PO before release.",
    ],
    "needs_review",
    "Verify total against PO before release.",
    "legible",
    ["Invoice total differs from the purchase-order reference."],
  ),
  invoice(
    "invoice-po-currency-mismatch",
    "Bluepeak Logistics",
    "incorrect",
    "PO and currency mismatch",
    "reference_conflict",
    [
      "Bluepeak Logistics",
      "INV-BL-5101",
      "PO-BL-5104",
      "2026-08-16",
      "USD",
      "720.00 USD",
      "Net 15",
      "Confirm PO and currency with sourcing.",
    ],
    [
      "Bluepeak Logistics",
      "INV-BL-5101",
      "PO-BL-5103",
      "2026-08-16",
      "SGD",
      "720.00 USD",
      "Net 15",
      "Confirm PO and currency with sourcing.",
    ],
    "needs_review",
    "Confirm PO and currency with sourcing.",
    "legible",
    [
      "Purchase order differs from reference.",
      "Currency differs from reference.",
    ],
  ),
  warehouse(
    "warehouse-clean-receipt",
    "Northstar Office Supply",
    "correct",
    "Clean receipt",
    "none",
    [
      "GRN-NOS-6001",
      "DN-NOS-6001",
      "PO-NOS-1001",
      "PAPER-A4-80",
      "LOT-NOS-0812",
      "50",
      "50",
      "0",
      "Received in good condition.",
    ],
    [
      "GRN-NOS-6001",
      "DN-NOS-6001",
      "PO-NOS-1001",
      "PAPER-A4-80",
      "LOT-NOS-0812",
      "50",
      "50",
      "0",
      "Received in good condition.",
    ],
    "clear",
    "Received in good condition.",
    "legible",
    ["All receiving values match the trusted reference."],
  ),
  warehouse(
    "warehouse-quantity-correction",
    "Harborline Components",
    "attention",
    "Quantity correction",
    "manual_correction",
    [
      "GRN-HC-6101",
      "DN-HC-6101",
      "PO-HC-6101",
      "BOLT-M8-100",
      "LOT-HC-0813",
      "50",
      "48",
      "0",
      "Correct received quantity to 48.",
    ],
    [
      "GRN-HC-6101",
      "DN-HC-6101",
      "PO-HC-6101",
      "BOLT-M8-100",
      "LOT-HC-0813",
      "50",
      "50",
      "0",
      "Correct received quantity to 48.",
    ],
    "needs_review",
    "Correct received quantity to 48.",
    "legible",
    ["Handwritten received quantity differs from the reference."],
  ),
  warehouse(
    "warehouse-unreadable-damage-note",
    "Vireo Industrial Goods",
    "attention",
    "Unreadable damage note",
    "unreadable_critical_evidence",
    [
      "GRN-VIG-6201",
      "DN-VIG-6201",
      "PO-VIG-6201",
      "GLOVE-NITRILE-M",
      "LOT-VIG-0814",
      "80",
      "80",
      "2",
      null,
    ],
    [
      "GRN-VIG-6201",
      "DN-VIG-6201",
      "PO-VIG-6201",
      "GLOVE-NITRILE-M",
      "LOT-VIG-0814",
      "80",
      "80",
      "2",
      "Two cartons damaged.",
    ],
    "incomplete",
    "Unreadable handwritten damage note.",
    "unclear",
    ["Critical handwritten damage note is unreadable."],
  ),
  warehouse(
    "warehouse-quantity-mismatch",
    "Meridian Packaging",
    "incorrect",
    "Quantity mismatch",
    "reference_conflict",
    [
      "GRN-MP-6301",
      "DN-MP-6301",
      "PO-MP-6301",
      "CARTON-40X30",
      "LOT-MP-0815",
      "40",
      "36",
      "0",
      "Count pallets before staging.",
    ],
    [
      "GRN-MP-6301",
      "DN-MP-6301",
      "PO-MP-6301",
      "CARTON-40X30",
      "LOT-MP-0815",
      "40",
      "40",
      "0",
      "Count pallets before staging.",
    ],
    "needs_review",
    "Count pallets before staging.",
    "legible",
    ["Received quantity differs from the delivery reference."],
  ),
  warehouse(
    "warehouse-item-lot-mismatch",
    "Bluepeak Logistics",
    "incorrect",
    "Item and lot mismatch",
    "reference_conflict",
    [
      "GRN-BL-6401",
      "DN-BL-6401",
      "PO-BL-6401",
      "FILTER-HEPA-H14",
      "LOT-BL-0816-B",
      "24",
      "24",
      "0",
      "Quarantine until item and lot are confirmed.",
    ],
    [
      "GRN-BL-6401",
      "DN-BL-6401",
      "PO-BL-6401",
      "FILTER-HEPA-H13",
      "LOT-BL-0816-A",
      "24",
      "24",
      "0",
      "Quarantine until item and lot are confirmed.",
    ],
    "needs_review",
    "Quarantine until item and lot are confirmed.",
    "legible",
    ["Item code differs from reference.", "Lot number differs from reference."],
  ),
];

export type RecordedDocumentRunResult = {
  fixtureId: (typeof syntheticFixtures)[number]["id"];
  outcome: Outcome;
  fields: FieldResult[];
};
export const recordedDocumentRunResults: RecordedDocumentRunResult[] =
  syntheticFixtures.map((fixture) => ({
    fixtureId: fixture.id,
    outcome: fixture.expectedOutcome,
    fields: fixture.requestedFields.map((requestedField) => {
      const extractedValue = fixture.documentData[requestedField.key] ?? null;
      const referenceValue = fixture.referenceData[requestedField.key] ?? null;
      return {
        key: requestedField.key,
        label: requestedField.label,
        extractedValue,
        normalizedValue: extractedValue,
        evidence:
          extractedValue === null
            ? null
            : requestedField.label + ": " + extractedValue,
        page: extractedValue === null ? null : 1,
        evaluatorStatus:
          extractedValue === null
            ? "not_found"
            : extractedValue === referenceValue
              ? "pass"
              : "conflict",
        referenceMatch:
          extractedValue === null ? null : extractedValue === referenceValue,
      };
    }),
  }));
