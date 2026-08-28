import { describe, expect, it } from "vitest";
import {
  defaultModelForProvider,
  liveModelCatalog,
  requireEnabledModel,
} from "@/domain/live-model-catalog";

describe("live model catalogue", () => {
  it("exposes the approved server-owned models with a recommended default for each provider", () => {
    expect(liveModelCatalog.map((model) => model.id)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "claude-haiku-4-5",
      "claude-sonnet-5",
    ]);
    expect(requireEnabledModel("openai", "gpt-5.6-luna").recommended).toBe(true);
    expect(defaultModelForProvider("anthropic")).toBe("claude-haiku-4-5");
  });

  it("rejects a model when it is not approved for the selected provider", () => {
    expect(() => requireEnabledModel("anthropic", "gpt-5.6-luna")).toThrow(
      "unsupported_live_model",
    );
  });

  it("publishes dated capacity and pricing for every approved model", () => {
    expect(liveModelCatalog).toMatchObject([
      {
        id: "gpt-5.6-luna",
        contextWindowTokens: 1_050_000,
        pricingAsOf: "2026-08-28",
        inputPerMillionUsd: 0.2,
        outputPerMillionUsd: 1.2,
      },
      {
        id: "gpt-5.6-terra",
        contextWindowTokens: 1_050_000,
        pricingAsOf: "2026-08-28",
        inputPerMillionUsd: 2,
        outputPerMillionUsd: 12,
      },
      {
        id: "claude-haiku-4-5",
        contextWindowTokens: 200_000,
        pricingAsOf: "2026-08-28",
        inputPerMillionUsd: 1,
        outputPerMillionUsd: 5,
      },
      {
        id: "claude-sonnet-5",
        contextWindowTokens: 1_000_000,
        pricingAsOf: "2026-08-28",
        inputPerMillionUsd: 2,
        outputPerMillionUsd: 10,
      },
    ]);
  });
});
