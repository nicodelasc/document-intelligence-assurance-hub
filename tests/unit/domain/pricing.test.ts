import { describe, expect, it } from "vitest";
import {
  MAX_LIVE_PROVIDER_ATTEMPTS,
  MAX_PROVIDER_OUTPUT_TOKENS,
  estimateMaximumLiveRunCost,
  estimateRunCost,
  pricingAsOf,
} from "@/domain/pricing";

describe("estimateRunCost", () => {
  it("uses the 2026-08-28 OpenAI GPT-5.6 Luna rates", () => {
    expect(pricingAsOf).toBe("2026-08-28");
    expect(
      estimateRunCost({
        provider: "openai",
        model: "gpt-5.6-luna",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(1.4);
  });

  it("uses the 2026-08-28 Anthropic Claude Haiku 4.5 rates", () => {
    expect(
      estimateRunCost({
        provider: "anthropic",
        model: "claude-haiku-4-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(6);
  });

  it("scales costs proportionally by token count", () => {
    expect(
      estimateRunCost({
        provider: "openai",
        model: "gpt-5.6-luna",
        inputTokens: 8_000,
        outputTokens: 500,
      }),
    ).toBe(0.0022);
  });

  it("rejects a provider and model mismatch before any cost is published", () => {
    expect(() =>
      estimateRunCost({
        provider: "openai",
        model: "claude-haiku-4-5",
        inputTokens: 100,
        outputTokens: 10,
      }),
    ).toThrow("unsupported_live_model");
  });

  it("reserves the maximum two-call cost permitted by the selected model context and output cap", () => {
    expect(MAX_LIVE_PROVIDER_ATTEMPTS).toBe(2);
    expect(MAX_PROVIDER_OUTPUT_TOKENS).toBe(2_000);
    expect(estimateMaximumLiveRunCost("openai", "gpt-5.6-luna")).toBeCloseTo(
      0.424,
      9,
    );
    expect(
      estimateMaximumLiveRunCost("anthropic", "claude-sonnet-5"),
    ).toBeCloseTo(4.032, 9);
  });
});
