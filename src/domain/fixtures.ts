import type {
  FieldResult,
  Outcome,
  SyntheticFixture,
} from "./types";

export const syntheticFixtures: readonly SyntheticFixture[] = [
  {
    id: "invoice-exception-packet",
    filename: "invoice-exception-packet.pdf",
    title: "Invoice exception packet",
    description: "Supplier invoice with a handwritten payment hold instruction.",
    requestedFields: [
      { key: "vendor_name", label: "Vendor name" },
      { key: "purchase_order_number", label: "Purchase-order number" },
      { key: "invoice_total", label: "Invoice total" },
    ],
    documentData: {
      vendor_name: "Northstar Paperworks",
      purchase_order_number: "PO-NP-1001",
      invoice_total: "1250.00 SGD",
    },
    referenceData: {
      vendor_name: "Northstar Paperworks",
      purchase_order_number: "PO-NP-1001",
      invoice_total: "1200.00 SGD",
    },
    expectedOutcome: "needs_review",
    action: {
      type: "create_ap_exception_case",
      title: "Create accounts-payable exception review",
      summary: "Review the invoice total before payment processing continues.",
      payload: [
        { label: "Vendor", value: "Northstar Paperworks" },
        { label: "Purchase-order number", value: "PO-NP-1001" },
        { label: "Invoice total", value: "1250.00 SGD" },
      ],
      instructionEvidence: "Hold payment and contact the buyer.",
      page: 1,
      risk: "medium",
      status: "needs_review",
      reason: "The invoice total conflicts with the purchase-order register.",
      stagedAt: null,
    },
  },
  {
    id: "warehouse-receiving-sheet",
    filename: "warehouse-receiving-sheet.pdf",
    title: "Warehouse receiving sheet",
    description: "Receiving tally with a handwritten quantity correction.",
    requestedFields: [
      { key: "shipment_id", label: "Shipment ID" },
      { key: "purchase_order_number", label: "Purchase-order number" },
      { key: "received_quantity", label: "Received quantity" },
    ],
    documentData: {
      shipment_id: "SHIP-4018",
      purchase_order_number: "PO-WR-4018",
      received_quantity: "48",
    },
    referenceData: {
      shipment_id: "SHIP-4018",
      purchase_order_number: "PO-WR-4018",
      received_quantity: "48",
    },
    expectedOutcome: "clear",
    action: {
      type: "stage_inventory_receipt",
      title: "Stage inventory receipt",
      summary: "Stage the verified receipt for internal inventory posting.",
      payload: [
        { label: "Shipment ID", value: "SHIP-4018" },
        { label: "Purchase-order number", value: "PO-WR-4018" },
        { label: "Received quantity", value: "48" },
      ],
      instructionEvidence: "Corrected received quantity: 48.",
      page: 1,
      risk: "low",
      status: "ready",
      reason: "The corrected quantity matches the expected delivery.",
      stagedAt: null,
    },
  },
  {
    id: "visitor-access-request",
    filename: "visitor-access-request.pdf",
    title: "Visitor access request",
    description: "Access request without a valid sponsor approval code.",
    requestedFields: [
      { key: "visitor_name", label: "Visitor name" },
      { key: "host", label: "Host" },
      { key: "approval_code", label: "Approval code" },
    ],
    documentData: {
      visitor_name: "Jordan Lee",
      host: "Avery Tan",
      approval_code: null,
    },
    referenceData: {
      visitor_name: "Jordan Lee",
      host: "Avery Tan",
      approval_code: null,
    },
    expectedOutcome: "incomplete",
    action: {
      type: "create_security_review",
      title: "Create security review",
      summary: "Create a review item while badge preparation remains blocked.",
      payload: [
        { label: "Visitor name", value: "Jordan Lee" },
        { label: "Host", value: "Avery Tan" },
        { label: "Approval code", value: "Not provided" },
      ],
      instructionEvidence: "Prepare a visitor badge for arrival.",
      page: 1,
      risk: "high",
      status: "blocked",
      reason: "Required sponsor approval evidence is absent.",
      stagedAt: null,
    },
  },
];

export const syntheticInvoices = [
  { id: "clean-match", filename: "clean-match-invoice.pdf", vendor: "Northstar Paperworks" },
  { id: "invoice-total-mismatch", filename: "invoice-total-mismatch.pdf", vendor: "Harborline Supplies" },
  { id: "missing-purchase-order", filename: "missing-purchase-order.pdf", vendor: "Vireo Office Goods" },
] as const;

export const purchaseOrderReferences = {
  "clean-match": {
    vendorName: "Northstar Paperworks",
    purchaseOrderNumber: "PO-NP-1001",
    invoiceNumber: "INV-NP-1001",
    invoiceTotal: "1250.00 SGD",
  },
  "invoice-total-mismatch": {
    vendorName: "Harborline Supplies",
    purchaseOrderNumber: "PO-HS-2001",
    invoiceNumber: "INV-HS-2001",
    invoiceTotal: "840.00 SGD",
  },
  "missing-purchase-order": {
    vendorName: "Vireo Office Goods",
    purchaseOrderNumber: "PO-VO-3001",
    invoiceNumber: "INV-VO-3001",
    invoiceTotal: "460.00 SGD",
  },
} as const;

type RecordedRunResult = {
  invoiceId: (typeof syntheticInvoices)[number]["id"];
  outcome: Outcome;
  fields: FieldResult[];
};

export const recordedRunResults: RecordedRunResult[] = [
  {
    invoiceId: "clean-match",
    outcome: "clear",
    fields: [
      {
        key: "vendor_name",
        label: "Vendor name",
        extractedValue: "Northstar Paperworks",
        normalizedValue: "Northstar Paperworks",
        evidence: "Supplier: Northstar Paperworks",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "purchase_order_number",
        label: "Purchase-order number",
        extractedValue: "PO-NP-1001",
        normalizedValue: "PO-NP-1001",
        evidence: "PO: PO-NP-1001",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "invoice_total",
        label: "Invoice total",
        extractedValue: "1250.00 SGD",
        normalizedValue: "1250.00 SGD",
        evidence: "Total due: 1250.00 SGD",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
    ],
  },
  {
    invoiceId: "invoice-total-mismatch",
    outcome: "needs_review",
    fields: [
      {
        key: "vendor_name",
        label: "Vendor name",
        extractedValue: "Harborline Supplies",
        normalizedValue: "Harborline Supplies",
        evidence: "Supplier: Harborline Supplies",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "purchase_order_number",
        label: "Purchase-order number",
        extractedValue: "PO-HS-2001",
        normalizedValue: "PO-HS-2001",
        evidence: "PO: PO-HS-2001",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "invoice_total",
        label: "Invoice total",
        extractedValue: "890.00 SGD",
        normalizedValue: "890.00 SGD",
        evidence: "Total due: 890.00 SGD",
        page: 1,
        evaluatorStatus: "conflict",
        referenceMatch: false,
      },
    ],
  },
  {
    invoiceId: "missing-purchase-order",
    outcome: "incomplete",
    fields: [
      {
        key: "vendor_name",
        label: "Vendor name",
        extractedValue: "Vireo Office Goods",
        normalizedValue: "Vireo Office Goods",
        evidence: "Supplier: Vireo Office Goods",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "purchase_order_number",
        label: "Purchase-order number",
        extractedValue: null,
        normalizedValue: null,
        evidence: null,
        page: null,
        evaluatorStatus: "not_found",
        referenceMatch: null,
      },
      {
        key: "invoice_total",
        label: "Invoice total",
        extractedValue: "460.00 SGD",
        normalizedValue: "460.00 SGD",
        evidence: "Total due: 460.00 SGD",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
    ],
  },
];

export type RecordedDocumentRunResult = {
  fixtureId: (typeof syntheticFixtures)[number]["id"];
  outcome: Outcome;
  fields: FieldResult[];
};

export const recordedDocumentRunResults: RecordedDocumentRunResult[] = [
  {
    fixtureId: "invoice-exception-packet",
    outcome: "needs_review",
    fields: [
      {
        key: "vendor_name",
        label: "Vendor name",
        extractedValue: "Northstar Paperworks",
        normalizedValue: "Northstar Paperworks",
        evidence: "Vendor name: Northstar Paperworks",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "purchase_order_number",
        label: "Purchase-order number",
        extractedValue: "PO-NP-1001",
        normalizedValue: "PO-NP-1001",
        evidence: "Purchase-order number: PO-NP-1001",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "invoice_total",
        label: "Invoice total",
        extractedValue: "1250.00 SGD",
        normalizedValue: "1250.00 SGD",
        evidence: "Invoice total: 1250.00 SGD",
        page: 1,
        evaluatorStatus: "conflict",
        referenceMatch: false,
      },
    ],
  },
  {
    fixtureId: "warehouse-receiving-sheet",
    outcome: "clear",
    fields: [
      {
        key: "shipment_id",
        label: "Shipment ID",
        extractedValue: "SHIP-4018",
        normalizedValue: "SHIP-4018",
        evidence: "Shipment ID: SHIP-4018",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "purchase_order_number",
        label: "Purchase-order number",
        extractedValue: "PO-WR-4018",
        normalizedValue: "PO-WR-4018",
        evidence: "Purchase-order number: PO-WR-4018",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "received_quantity",
        label: "Received quantity",
        extractedValue: "48",
        normalizedValue: "48",
        evidence: "Received quantity: 48",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
    ],
  },
  {
    fixtureId: "visitor-access-request",
    outcome: "incomplete",
    fields: [
      {
        key: "visitor_name",
        label: "Visitor name",
        extractedValue: "Jordan Lee",
        normalizedValue: "Jordan Lee",
        evidence: "Visitor name: Jordan Lee",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "host",
        label: "Host",
        extractedValue: "Avery Tan",
        normalizedValue: "Avery Tan",
        evidence: "Host: Avery Tan",
        page: 1,
        evaluatorStatus: "pass",
        referenceMatch: true,
      },
      {
        key: "approval_code",
        label: "Approval code",
        extractedValue: null,
        normalizedValue: null,
        evidence: null,
        page: null,
        evaluatorStatus: "not_found",
        referenceMatch: null,
      },
    ],
  },
];
