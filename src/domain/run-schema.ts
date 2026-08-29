import { z } from "zod";
import type {
  ActionProposal,
  RunEvent,
  WorkflowActionRequest,
  WorkflowEvent,
} from "./types";

function requiredPublicText(max: number) {
  return z
    .string()
    .max(max)
    .transform((value) =>
      value
        .normalize("NFKC")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim(),
    )
    .pipe(z.string().min(1).max(max));
}

export const actionProposalSchema: z.ZodType<ActionProposal> = z
  .object({
    type: z.enum([
      "create_ap_exception_case",
      "stage_inventory_receipt",
      "create_security_review",
      "create_document_review_task",
    ]),
    title: requiredPublicText(160),
    summary: requiredPublicText(600),
    payload: z
      .array(
        z
          .object({
            label: requiredPublicText(120),
            value: requiredPublicText(500),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    instructionEvidence: z.string().max(600).nullable(),
    page: z.number().int().positive().nullable(),
    risk: z.enum(["low", "medium", "high"]),
    status: z.enum(["ready", "needs_review", "blocked"]),
    reason: requiredPublicText(600),
    stagedAt: z.string().datetime().nullable(),
  })
  .strict();

const runStatusSchema = z.enum([
  "validating",
  "storing",
  "extracting",
  "verifying",
  "comparing",
  "deciding",
  "publishing",
  "completed",
  "failed",
  "expired",
  "deleted",
]);

const outcomeSchema = z.enum([
  "clear",
  "needs_review",
  "incomplete",
  "evidence_consistent",
  "conflict",
  "not_found",
]);

const fieldResultSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    extractedValue: z.string().nullable(),
    normalizedValue: z.string().nullable(),
    evidence: z.string().nullable(),
    page: z.number().int().positive().nullable(),
    evaluatorStatus: z.enum(["pass", "conflict", "not_found"]),
    referenceMatch: z.boolean().nullable(),
  })
  .strict();

const runEventUnion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage"), stage: runStatusSchema, timestamp: z.string().datetime() }).strict(),
  z.object({ type: z.literal("field"), field: fieldResultSchema, timestamp: z.string().datetime() }).strict(),
  z
    .object({
      type: z.literal("completed"),
      outcome: outcomeSchema,
      runId: z.string().min(1),
      executionMode: z.enum(["recorded", "live"]),
      deletionToken: z.string().min(1),
      timestamp: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      code: z.string().min(1).max(80),
      message: z.string().min(1).max(240),
      runId: z.string().min(1).optional(),
      deletionToken: z.string().min(1).optional(),
      timestamp: z.string().datetime(),
    })
    .strict(),
]);

export const runEventSchema: z.ZodType<RunEvent> = runEventUnion.superRefine((event, context) => {
  if (
    event.type === "failed" &&
    ((event.runId === undefined) !== (event.deletionToken === undefined))
  ) {
    context.addIssue({
      code: "custom",
      message: "Failed uploader receipts require both runId and deletionToken.",
    });
  }
});

export const workflowActionTypeSchema = z.enum([
  "approve_and_stage",
  "mark_for_later_review",
  "assign_review",
  "request_clarification",
  "request_clearer_document",
  "prepare_email",
  "replace_document",
  "retry_processing",
  "download_summary",
]);

export const workflowEventStatusSchema = z.enum([
  "prepared",
  "staged",
  "simulated",
]);

export const workflowEventSchema: z.ZodType<WorkflowEvent> = z
  .object({
    id: requiredPublicText(160),
    runId: requiredPublicText(160),
    action: workflowActionTypeSchema,
    recipientRole: z.string().trim().min(1).max(80).nullable(),
    status: workflowEventStatusSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export const workflowActionRequestSchema: z.ZodType<WorkflowActionRequest> = z
  .object({
    action: workflowActionTypeSchema,
    recipientRole: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();
