import type { FieldResult, Outcome } from "./types";

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
