import { describe, expect, it } from "vitest";
import { syntheticFixtures } from "@/domain/fixtures";

describe("synthetic document fixtures", () => {
  it("contains the three required deterministic document scenarios", () => {
    expect(syntheticFixtures.map((fixture) => fixture.id)).toEqual([
      "invoice-exception-packet",
      "warehouse-receiving-sheet",
      "visitor-access-request",
    ]);
    expect(syntheticFixtures.map((fixture) => fixture.expectedOutcome)).toEqual([
      "needs_review",
      "clear",
      "incomplete",
    ]);
  });

  it("keeps every scenario invented and action metadata aligned to its outcome", () => {
    const serializedFixtures = JSON.stringify(syntheticFixtures);
    expect(serializedFixtures).not.toMatch(/Samsung|Kyndryl/i);
    expect(syntheticFixtures.map((fixture) => fixture.action.status)).toEqual([
      "needs_review",
      "ready",
      "blocked",
    ]);
  });
});
