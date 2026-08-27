import { describe, expect, it } from "vitest";
import { estimateRunCost, pricingAsOf } from "@/domain/pricing";

describe("estimateRunCost", () => {
  it("uses the 2026-08-27 OpenAI GPT-5 mini rates", () => {
    expect(pricingAsOf).toBe("2026-08-27");
    expect(estimateRunCost({ provider: "openai", inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(
      2.25,
    );
  });

  it("uses the 2026-08-27 Anthropic Claude Haiku 4.5 rates", () => {
    expect(estimateRunCost({ provider: "anthropic", inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(6);
  });

  it("scales costs proportionally by token count", () => {
    expect(estimateRunCost({ provider: "openai", inputTokens: 8_000, outputTokens: 500 })).toBe(0.003);
  });
});
