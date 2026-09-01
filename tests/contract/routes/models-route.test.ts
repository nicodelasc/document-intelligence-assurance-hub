import { describe, expect, it, vi } from "vitest";
import { createDefaultHttpContainer } from "@/server/http/container";
import { GET } from "@/app/api/models/route";

const { getHttpContainerMock } = vi.hoisted(() => ({
  getHttpContainerMock: vi.fn(),
}));

vi.mock("@/server/http/container", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/http/container")>();
  return { ...actual, getHttpContainer: getHttpContainerMock };
});

describe("GET /api/models", () => {
  it("returns only enabled server-owned catalogue metadata and defaults", async () => {
    getHttpContainerMock.mockReturnValue(createDefaultHttpContainer({
      NODE_ENV: "test",
      AI_LIVE_ENABLED: "true",
      OPENAI_API_KEY: "fake-openai-test-key",
    }));
    const response = await GET();
    const body = (await response.json()) as {
      models: Array<Record<string, unknown>>;
      defaults: Record<string, string>;
      providerAvailability: Record<string, boolean>;
    };

    expect(response.status).toBe(200);
    expect(body.defaults).toEqual({
      openai: "gpt-5.6-luna",
      anthropic: "claude-haiku-4-5",
    });
    expect(body.providerAvailability).toEqual({
      openai: true,
      anthropic: false,
    });
    expect(body.models).toHaveLength(4);
    expect(body.models[0]).toEqual({
      id: "gpt-5.6-luna",
      provider: "openai",
      displayName: "GPT-5.6 Luna",
      recommended: true,
      contextWindowTokens: 1_050_000,
      pricingAsOf: "2026-09-01",
      inputPerMillionUsd: 0.2,
      outputPerMillionUsd: 1.2,
    });
    expect(JSON.stringify(body)).not.toMatch(
      /api.?key|secret|environment|fake-openai-test-key/i,
    );
  });
});
