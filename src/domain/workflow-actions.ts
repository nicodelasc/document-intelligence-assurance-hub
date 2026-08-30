import type {
  DocumentClassification,
  DocumentFamily,
  EmailPreview,
  FieldResult,
  Outcome,
  RunStatus,
  WorkflowActionType,
  WorkflowEventStatus,
} from "./types";

type OutcomeGroup = "clear" | "needs_review" | "incomplete";

const actionsByOutcomeGroup: Readonly<
  Record<OutcomeGroup, readonly WorkflowActionType[]>
> = Object.freeze({
  clear: Object.freeze<WorkflowActionType[]>([
    "approve_and_stage",
    "prepare_email",
    "download_summary",
    "mark_for_later_review",
  ]),
  needs_review: Object.freeze<WorkflowActionType[]>([
    "assign_review",
    "request_clarification",
    "prepare_email",
    "replace_document",
    "download_summary",
  ]),
  incomplete: Object.freeze<WorkflowActionType[]>([
    "request_clearer_document",
    "prepare_email",
    "assign_review",
    "replace_document",
    "retry_processing",
  ]),
});

const failedRunActions: readonly WorkflowActionType[] = Object.freeze([
  "retry_processing",
  "download_summary",
]);

const noWorkflowActions: readonly WorkflowActionType[] = Object.freeze([]);

const guardedDocumentActions: readonly WorkflowActionType[] = Object.freeze([
  "replace_document",
  "download_summary",
]);

const outcomeGroup: Readonly<Record<Outcome, OutcomeGroup>> = Object.freeze({
  clear: "clear",
  evidence_consistent: "clear",
  needs_review: "needs_review",
  conflict: "needs_review",
  incomplete: "incomplete",
  not_found: "incomplete",
});

const rolesByFamily: Readonly<Record<DocumentFamily, readonly string[]>> =
  Object.freeze({
    supplier_invoice: Object.freeze([
      "Accounts Payable Analyst",
      "Buyer",
      "Supplier Contact",
    ]),
    warehouse_goods_receipt: Object.freeze([
      "Warehouse Lead",
      "Buyer",
      "Supplier Contact",
    ]),
  });

const genericRecipientRoles: readonly string[] = Object.freeze([
  "Document Owner",
  "Reviewer",
]);

const actionsRequiringRecipientRole = new Set<WorkflowActionType>([
  "assign_review",
  "request_clarification",
  "request_clearer_document",
  "prepare_email",
]);

function sanitizePublicText(value: string, maximumLength: number): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maximumLength);
}

function redactAddressLikeText(value: string, maximumLength: number): string {
  return sanitizePublicText(value, maximumLength)
    .replace(
      /(?:mailto:\S+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/gi,
      "[address redacted]",
    )
    .replaceAll("@", "[at redacted]");
}

export function allowedWorkflowActionsForRun(input: {
  status: RunStatus;
  outcome: Outcome | null;
  documentClassification?: DocumentClassification | null;
}): readonly WorkflowActionType[] {
  if (
    input.documentClassification === "irrelevant" ||
    input.documentClassification === "uncertain"
  ) {
    return guardedDocumentActions;
  }
  if (input.status === "failed") {
    return failedRunActions;
  }
  if (input.status !== "completed" || input.outcome === null) {
    return noWorkflowActions;
  }
  return actionsByOutcomeGroup[outcomeGroup[input.outcome]];
}

export function allowedRecipientRoles(
  family: DocumentFamily | null,
): readonly string[] {
  return family === null ? genericRecipientRoles : rolesByFamily[family];
}

export function workflowActionRequiresRecipient(
  action: WorkflowActionType,
): boolean {
  return actionsRequiringRecipientRole.has(action);
}

export function recipientRoleAllowed(
  action: WorkflowActionType,
  family: DocumentFamily | null,
  recipientRole: string | null,
): boolean {
  if (!workflowActionRequiresRecipient(action)) {
    return recipientRole === null;
  }
  return (
    recipientRole !== null &&
    allowedRecipientRoles(family).includes(recipientRole)
  );
}

export function workflowStatusForAction(
  action: WorkflowActionType,
): WorkflowEventStatus {
  if (action === "approve_and_stage") {
    return "staged";
  }
  if (action === "prepare_email") {
    return "prepared";
  }
  return "simulated";
}

export function createEmailPreview(input: {
  runId: string;
  outcome: Outcome;
  recipientRole: string;
  fields: readonly FieldResult[];
}): EmailPreview {
  const safeRunId = redactAddressLikeText(input.runId, 160);
  const safeRecipientRole = redactAddressLikeText(input.recipientRole, 80);
  const safeOutcome = redactAddressLikeText(
    input.outcome.replaceAll("_", " "),
    40,
  );
  const differences = input.fields
    .filter((field) => field.evaluatorStatus !== "pass")
    .map((field) => {
      const label = redactAddressLikeText(field.label, 120);
      const extractedValue = redactAddressLikeText(
        field.extractedValue ?? "Not found",
        500,
      );
      return `${label}: ${extractedValue}`;
    })
    .slice(0, 6);

  return {
    recipientRole: safeRecipientRole,
    subject: `Prepared only - not sent | Document review ${safeRunId}`,
    body: [
      "Prepared only - not sent",
      `To role: ${safeRecipientRole}`,
      `Run: ${safeRunId}`,
      `Outcome: ${safeOutcome}`,
      differences.length > 0
        ? `Items requiring attention:\n${differences.join("\n")}`
        : "No discrepancies were recorded.",
    ].join("\n\n"),
    deliveryStatus: "prepared_only_not_sent",
  };
}
