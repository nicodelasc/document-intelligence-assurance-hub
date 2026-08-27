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
});
