import { describe, expect, it } from "vitest";
import {
  HttpContainerConfigurationError,
  createDefaultHttpContainer,
} from "@/server/http/container";

describe("HTTP persistence container", () => {
  it("uses both in-memory ports for local and test execution", () => {
    const container = createDefaultHttpContainer({ NODE_ENV: "test" });

    expect(container.repository.constructor.name).toBe("InMemoryRunRepository");
    expect(container.documentStore.constructor.name).toBe("InMemoryDocumentStore");
  });

  it("constructs both lazy connected ports when database and Blob are configured", () => {
    const container = createDefaultHttpContainer({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://unit-test-placeholder",
      BLOB_READ_WRITE_TOKEN: "blob-unit-test-placeholder",
      CRON_SECRET: "cron-secret-with-at-least-32-characters",
    });

    expect(container.repository.constructor.name).not.toBe("InMemoryRunRepository");
    expect(container.documentStore.constructor.name).not.toBe("InMemoryDocumentStore");
  });

  it.each([
    undefined,
    "",
    "too-short",
    "x".repeat(31),
    `cron secret ${"x".repeat(32)}`,
  ])("rejects weak connected-production CRON_SECRET value %j", (cronSecret) => {
    expect(() =>
      createDefaultHttpContainer({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://unit-test-placeholder",
        BLOB_READ_WRITE_TOKEN: "blob-unit-test-placeholder",
        CRON_SECRET: cronSecret,
      }),
    ).toThrowError("production_cron_secret_required");
  });

  it.each([
    { DATABASE_URL: "postgresql://unit-test-placeholder" },
    { BLOB_READ_WRITE_TOKEN: "blob-unit-test-placeholder" },
  ])("rejects mixed connected persistence configuration", (environment) => {
    expect(() =>
      createDefaultHttpContainer({ NODE_ENV: "test", ...environment }),
    ).toThrowError(HttpContainerConfigurationError);
  });

  it("requires connected persistence in production without a server-only override", () => {
    expect(() => createDefaultHttpContainer({ NODE_ENV: "production" })).toThrowError(
      HttpContainerConfigurationError,
    );

    expect(() =>
      createDefaultHttpContainer({
        NODE_ENV: "production",
        ALLOW_IN_MEMORY_PERSISTENCE: "true",
      }),
    ).not.toThrow();
  });

  it("requires durable Neon quotas whenever production live mode is enabled", () => {
    expect(() =>
      createDefaultHttpContainer({
        NODE_ENV: "production",
        AI_LIVE_ENABLED: "true",
        ALLOW_IN_MEMORY_PERSISTENCE: "true",
      }),
    ).toThrowError("production_live_mode_requires_database");

    expect(() =>
      createDefaultHttpContainer({
        NODE_ENV: "production",
        AI_LIVE_ENABLED: "false",
        ALLOW_IN_MEMORY_PERSISTENCE: "true",
      }),
    ).not.toThrow();
  });

  it.each(["", "0", "-1", "NaN", "Infinity", "3 dollars"])(
    "rejects an invalid GLOBAL_DAILY_MODEL_BUDGET_USD value of %j",
    (budget) => {
      expect(() =>
        createDefaultHttpContainer({
          NODE_ENV: "test",
          GLOBAL_DAILY_MODEL_BUDGET_USD: budget,
        }),
      ).toThrowError("invalid_global_daily_model_budget_usd");
    },
  );

  it("applies the parsed global budget to the keyless quota adapter", async () => {
    const container = createDefaultHttpContainer({
      NODE_ENV: "test",
      AI_LIVE_ENABLED: "true",
      GLOBAL_DAILY_MODEL_BUDGET_USD: "1.5",
    });

    await expect(
      container.quotaRepository.reserve({
        bucket: "budget-test",
        sourceType: "synthetic",
        executionMode: "live",
        estimatedCostUsd: 1.51,
        liveEnabled: true,
        now: new Date("2026-08-27T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "daily_budget",
      replayAvailable: true,
    });
  });

  it("prepares only the selected direct live provider without making a request", async () => {
    const container = createDefaultHttpContainer({
      NODE_ENV: "test",
      AI_LIVE_ENABLED: "true",
      OPENAI_API_KEY: "server-test-placeholder",
    });

    const provider = await container.createProvider({
      provider: "openai",
      executionMode: "live",
      sampleId: null,
    });

    expect(container.liveModeEnabled).toBe(true);
    expect(provider).toMatchObject({
      provider: "openai",
      model: "gpt-5-mini",
      executionMode: "live",
    });
  });
});
