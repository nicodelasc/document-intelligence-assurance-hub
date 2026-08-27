import { z } from "zod";
import type { RunEvent } from "./types";

const runStatusSchema = z.enum([
  "validating",
  "storing",
  "extracting",
  "verifying",
  "deciding",
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

export const runEventSchema: z.ZodType<RunEvent> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage"), stage: runStatusSchema, timestamp: z.string().datetime() }).strict(),
  z.object({ type: z.literal("field"), field: fieldResultSchema, timestamp: z.string().datetime() }).strict(),
  z.object({ type: z.literal("completed"), outcome: outcomeSchema, timestamp: z.string().datetime() }).strict(),
  z.object({ type: z.literal("failed"), message: z.string(), timestamp: z.string().datetime() }).strict(),
]);
