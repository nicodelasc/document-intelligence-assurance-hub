import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/models/route";

describe("GET /api/models", () => {
  it("returns only enabled server-owned catalogue metadata and defaults", async () => {
    const response = await GET();
    const body = (await response.json()) as {
      models: Array<Record<string, unknown>>;
      defaults: Record<string, string>;
    };

    expect(response.status).toBe(200);
    expect(body.defaults).toEqual({
      openai: "gpt-5.6-luna",
      anthropic: "claude-haiku-4-5",
    });
    expect(body.models).toHaveLength(4);
    expect(body.models[0]).toEqual({
      id: "gpt-5.6-luna",
      provider: "openai",
      displayName: "GPT-5.6 Luna",
      recommended: true,
      contextWindowTokens: 1_050_000,
      pricingAsOf: "2026-08-28",
      inputPerMillionUsd: 0.2,
      outputPerMillionUsd: 1.2,
    });
    expect(JSON.stringify(body)).not.toMatch(/api.?key|secret|environment/i);
  });
});
