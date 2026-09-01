import { describe, expect, it } from "vitest";
import { idempotentRunId } from "@/server/http/run-id";

describe("idempotent run IDs", () => {
  it("derives the stable public run ID from the validated request key", () => {
    expect(idempotentRunId("00000000-0000-4000-8000-000000000001")).toBe(
      "run_11e594f481958c10e3015d0bf0447a22f068a8a647f475df",
    );
  });
});
