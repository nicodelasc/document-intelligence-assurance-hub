export type Provider = "openai" | "anthropic";

export type RunStatus =
  | "validating"
  | "storing"
  | "extracting"
  | "verifying"
  | "comparing"
  | "deciding"
  | "publishing"
  | "completed"
  | "failed"
  | "expired"
  | "deleted";

export type Outcome =
  | "clear"
  | "needs_review"
  | "incomplete"
  | "evidence_consistent"
  | "conflict"
  | "not_found";

export type ActionType =
  | "create_ap_exception_case"
  | "stage_inventory_receipt"
  | "create_security_review"
  | "create_document_review_task";

export type ActionStatus = "ready" | "needs_review" | "blocked";

export type DocumentFamily = "supplier_invoice" | "warehouse_goods_receipt";

export type VariantClassification = "correct" | "attention" | "incorrect";

export type AttentionReason =
  | "manual_instruction"
  | "manual_correction"
  | "unreadable_critical_evidence"
  | "reference_conflict"
  | "none";

export type HandwrittenEvidence = {
  fieldKey: "reviewer_comments" | "receiver_comments";
  text: string;
  legibility: "legible" | "unclear";
};

export interface ActionProposal {
  type: ActionType;
  title: string;
  summary: string;
  payload: Array<{ label: string; value: string }>;
  instructionEvidence: string | null;
  page: number | null;
  risk: "low" | "medium" | "high";
  status: ActionStatus;
  reason: string;
  stagedAt: string | null;
}

export interface SyntheticFixture {
  id: string;
  filename: string;
  title: string;
  description: string;
  family: DocumentFamily;
  classification: VariantClassification;
  variantLabel: string;
  differenceSummary: string[];
  attentionReason: AttentionReason;
  handwrittenEvidence: HandwrittenEvidence | null;
  requestedFields: Array<{ key: string; label: string }>;
  documentData: Record<string, string | null>;
  referenceData: Record<string, string | null>;
  expectedOutcome: Outcome;
  action: ActionProposal;
}

export interface FieldResult {
  key: string;
  label: string;
  extractedValue: string | null;
  normalizedValue: string | null;
  evidence: string | null;
  page: number | null;
  evaluatorStatus: "pass" | "conflict" | "not_found";
  referenceMatch: boolean | null;
}

export type WorkflowActionType =
  | "approve_and_stage"
  | "mark_for_later_review"
  | "assign_review"
  | "request_clarification"
  | "request_clearer_document"
  | "prepare_email"
  | "replace_document"
  | "retry_processing"
  | "download_summary";

export type WorkflowEventStatus = "prepared" | "staged" | "simulated";

export interface WorkflowEvent {
  id: string;
  runId: string;
  action: WorkflowActionType;
  recipientRole: string | null;
  status: WorkflowEventStatus;
  createdAt: string;
}

export interface WorkflowActionRequest {
  action: WorkflowActionType;
  recipientRole: string | null;
}

export interface EmailPreview {
  recipientRole: string;
  subject: string;
  body: string;
  deliveryStatus: "prepared_only_not_sent";
}

export type UploadValidationError =
  | "empty_file"
  | "unsupported_format"
  | "mime_mismatch"
  | "file_too_large"
  | "pdf_page_limit"
  | "field_count"
  | "blank_field"
  | "duplicate_field"
  | "consent_required";

export interface UploadValidation {
  valid: boolean;
  errors: UploadValidationError[];
}

export interface ResourceScenarioResult {
  manualHours: number;
  assistedHours: number;
  hoursSaved: number;
  manualLaborCost: number;
  assistedLaborCost: number;
  modelCost: number;
  totalAssistedCost: number;
  illustrative: true;
}

export type RunEvent =
  | { type: "stage"; stage: RunStatus; timestamp: string }
  | { type: "field"; field: FieldResult; timestamp: string }
  | {
      type: "completed";
      outcome: Outcome;
      runId: string;
      executionMode: "recorded" | "live";
      deletionToken: string;
      timestamp: string;
    }
  | {
      type: "failed";
      code: string;
      message: string;
      runId?: string;
      deletionToken?: string;
      timestamp: string;
    };
