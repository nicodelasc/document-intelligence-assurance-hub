import { describe, expect, it } from "vitest";
import { InMemoryQuotaRepository, createNeonQuotaRepository } from "@/server/security/rate-limit";
import { PersistenceConfigurationError } from "@/server/repositories/run-repository";

const now = new Date("2026-08-27T10:00:00.000Z");

describe("InMemoryQuotaRepository", () => {
  it("atomically admits only three custom uploads per anonymous bucket and UTC day", async () => {
    const quotas = new InMemoryQuotaRepository();
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () =>
        quotas.reserve({
          bucket: "browser-a",
          sourceType: "custom",
          executionMode: "recorded",
          estimatedCostUsd: 0,
          liveEnabled: false,
          now,
        }),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
    expect(decisions.filter((decision) => !decision.allowed).map((decision) => decision.reason)).toEqual(
      Array(7).fill("custom_upload_limit"),
    );
  });

  it("atomically enforces six live runs and the US$3 daily budget without charging replays", async () => {
    const runLimited = new InMemoryQuotaRepository();
    const liveRuns = await Promise.all(
      Array.from({ length: 12 }, () =>
        runLimited.reserve({
          bucket: "browser-a",
          sourceType: "synthetic",
          executionMode: "live",
          estimatedCostUsd: 0,
          liveEnabled: true,
          now,
        }),
      ),
    );
    expect(liveRuns.filter((decision) => decision.allowed)).toHaveLength(6);

    const budgetLimited = new InMemoryQuotaRepository();
    const costlyRuns = await Promise.all(
      Array.from({ length: 8 }, () =>
        budgetLimited.reserve({
          bucket: "browser-b",
          sourceType: "synthetic",
          executionMode: "live",
          estimatedCostUsd: 0.75,
          liveEnabled: true,
          now,
        }),
      ),
    );
    expect(costlyRuns.filter((decision) => decision.allowed)).toHaveLength(4);
    expect((await budgetLimited.snapshot(now)).globalSpendUsd).toBe(3);

    const replayDecisions = await Promise.all(
      Array.from({ length: 20 }, () =>
        budgetLimited.reserve({
          bucket: "browser-b",
          sourceType: "synthetic",
          executionMode: "recorded",
          estimatedCostUsd: 10,
          liveEnabled: false,
          now,
        }),
      ),
    );
    expect(replayDecisions.every((decision) => decision.allowed)).toBe(true);
    expect((await budgetLimited.snapshot(now)).globalSpendUsd).toBe(3);
  });

  it("fails live work closed when the server kill switch is off and advertises replay availability", async () => {
    const quotas = new InMemoryQuotaRepository();
    await expect(
      quotas.reserve({
        bucket: "browser-a",
        sourceType: "synthetic",
        executionMode: "live",
        estimatedCostUsd: 0.1,
        liveEnabled: false,
        now,
      }),
    ).resolves.toEqual({ allowed: false, reason: "live_disabled", replayAvailable: true });
  });

  it("keeps the Neon-backed quota port inert until a database URL is supplied", async () => {
    const quotas = createNeonQuotaRepository({ databaseUrl: undefined });
    await expect(
      quotas.reserve({
        bucket: "browser-a",
        sourceType: "synthetic",
        executionMode: "live",
        estimatedCostUsd: 0.1,
        liveEnabled: true,
        now,
      }),
    ).rejects.toBeInstanceOf(PersistenceConfigurationError);
  });

  it("never lets a negative reservation lower the global spend ledger", async () => {
    const quotas = new InMemoryQuotaRepository();
    await quotas.reserve({
      bucket: "browser-a",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: -1,
      liveEnabled: true,
      now,
    });
    expect((await quotas.snapshot(now)).globalSpendUsd).toBe(0);
  });
});
