import { describe, expect, it } from "vitest";
import { runEventSchema } from "@/domain/run-schema";

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
});
