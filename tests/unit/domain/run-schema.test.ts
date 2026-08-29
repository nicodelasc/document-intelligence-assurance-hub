import { describe, expect, it } from "vitest";
import {
  runEventSchema,
  workflowActionRequestSchema,
  workflowEventSchema,
} from "@/domain/run-schema";

describe("runEventSchema", () => {
  it("accepts a public stage event", () => {
    expect(
      runEventSchema.parse({
        type: "stage",
        stage: "extracting",
        timestamp: "2026-08-27T00:00:00.000Z",
      }),
    ).toMatchObject({ type: "stage", stage: "extracting" });
  });

  it("rejects secret-bearing properties from public events", () => {
    expect(
      runEventSchema.safeParse({
        type: "stage",
        stage: "extracting",
        timestamp: "2026-08-27T00:00:00.000Z",
        apiKey: "not-for-output",
      }).success,
    ).toBe(false);
  });

  it("validates comparison, telemetry and one-time uploader completion events", () => {
    expect(
      runEventSchema.parse({
        type: "stage",
        stage: "comparing",
        timestamp: "2026-08-27T00:00:00.000Z",
      }),
    ).toMatchObject({ type: "stage", stage: "comparing" });
    expect(
      runEventSchema.parse({
        type: "completed",
        outcome: "clear",
        runId: "run-123",
        executionMode: "recorded",
        deletionToken: "shown-to-uploader-once",
        timestamp: "2026-08-27T00:00:01.000Z",
      }),
    ).toMatchObject({ type: "completed", runId: "run-123", executionMode: "recorded" });
  });

  it("requires a stable safe code on failure events", () => {
    expect(
      runEventSchema.parse({
        type: "failed",
        code: "provider_unavailable",
        message: "The selected provider is temporarily unavailable.",
        timestamp: "2026-08-27T00:00:00.000Z",
      }),
    ).toMatchObject({ type: "failed", code: "provider_unavailable" });
  });

  it("allows a one-time deletion token only when a failed run was created", () => {
    expect(
      runEventSchema.parse({
        type: "failed",
        code: "provider_unavailable",
        message: "The selected provider is temporarily unavailable.",
        runId: "run-123",
        deletionToken: "shown-to-uploader-once",
        timestamp: "2026-08-27T00:00:00.000Z",
      }),
    ).toMatchObject({ type: "failed", runId: "run-123", deletionToken: "shown-to-uploader-once" });
    expect(
      runEventSchema.safeParse({
        type: "failed",
        code: "validation_failed",
        message: "The upload is invalid.",
        deletionToken: "must-not-exist-before-run-creation",
        timestamp: "2026-08-27T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("workflowActionRequestSchema", () => {
  it("accepts a strict action request without validating the role catalogue", () => {
    expect(
      workflowActionRequestSchema.parse({
        action: "prepare_email",
        recipientRole: "Executive Sponsor",
      }),
    ).toEqual({
      action: "prepare_email",
      recipientRole: "Executive Sponsor",
    });
  });

  it("trims a supplied role and accepts null for actions without recipients", () => {
    expect(
      workflowActionRequestSchema.parse({
        action: "assign_review",
        recipientRole: "  Buyer  ",
      }),
    ).toEqual({ action: "assign_review", recipientRole: "Buyer" });
    expect(
      workflowActionRequestSchema.parse({
        action: "retry_processing",
        recipientRole: null,
      }),
    ).toEqual({ action: "retry_processing", recipientRole: null });
  });

  it.each([
    {
      action: "prepare_email",
      recipientRole: "Buyer",
      email: "buyer@example.com",
    },
    {
      action: "prepare_email",
      recipientRole: "Buyer",
      recipientAddress: "buyer@example.com",
    },
  ])("rejects extra address fields", (request) => {
    expect(workflowActionRequestSchema.safeParse(request).success).toBe(false);
  });

  it("rejects invalid actions and empty or overlong roles", () => {
    expect(
      workflowActionRequestSchema.safeParse({
        action: "send_email",
        recipientRole: "Buyer",
      }).success,
    ).toBe(false);
    expect(
      workflowActionRequestSchema.safeParse({
        action: "prepare_email",
        recipientRole: "   ",
      }).success,
    ).toBe(false);
    expect(
      workflowActionRequestSchema.safeParse({
        action: "prepare_email",
        recipientRole: "x".repeat(81),
      }).success,
    ).toBe(false);
  });
});

describe("workflowEventSchema", () => {
  it("accepts one public-safe workflow event", () => {
    expect(
      workflowEventSchema.parse({
        id: "workflow-event-123",
        runId: "run-123",
        action: "prepare_email",
        recipientRole: "Buyer",
        status: "prepared",
        createdAt: "2026-08-29T00:00:00.000Z",
      }),
    ).toEqual({
      id: "workflow-event-123",
      runId: "run-123",
      action: "prepare_email",
      recipientRole: "Buyer",
      status: "prepared",
      createdAt: "2026-08-29T00:00:00.000Z",
    });
  });

  it("rejects secret-bearing properties and invalid statuses", () => {
    expect(
      workflowEventSchema.safeParse({
        id: "workflow-event-123",
        runId: "run-123",
        action: "prepare_email",
        recipientRole: "Buyer",
        status: "prepared",
        createdAt: "2026-08-29T00:00:00.000Z",
        apiKey: "must-not-be-public",
      }).success,
    ).toBe(false);
    expect(
      workflowEventSchema.safeParse({
        id: "workflow-event-123",
        runId: "run-123",
        action: "prepare_email",
        recipientRole: "Buyer",
        status: "sent",
        createdAt: "2026-08-29T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
