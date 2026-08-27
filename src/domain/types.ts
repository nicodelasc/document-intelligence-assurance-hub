export type Provider = "openai" | "anthropic";

export type RunStatus =
  | "validating"
  | "storing"
  | "extracting"
  | "verifying"
  | "deciding"
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
  | { type: "completed"; outcome: Outcome; timestamp: string }
  | { type: "failed"; message: string; timestamp: string };
