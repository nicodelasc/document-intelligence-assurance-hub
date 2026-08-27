import { describe, expect, it } from "vitest";
import { InMemoryQuotaRepository, createNeonQuotaRepository } from "@/server/security/rate-limit";
import {
  PersistenceConfigurationError,
  type NeonDriver,
} from "@/server/repositories/run-repository";

const now = new Date("2026-08-27T10:00:00.000Z");

function quotaRepository() {
  let nextId = 0;
  return new InMemoryQuotaRepository(3, () => `reservation-${++nextId}`);
}

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

  it("blocks concurrent zero-estimate bypasses with a conservative global reservation", async () => {
    const quotas = quotaRepository();
    const decisions = await Promise.all(
      Array.from({ length: 8 }, () =>
        quotas.reserve({
          bucket: "browser-b",
          sourceType: "synthetic",
          executionMode: "live",
          estimatedCostUsd: 0,
          liveEnabled: true,
          now,
        }),
      ),
    );
    const allowed = decisions.filter((decision) => decision.allowed);
    expect(allowed).toHaveLength(3);
    expect(allowed.map((decision) => decision.allowed && decision.reservedCostUsd)).toEqual([
      1,
      1,
      1,
    ]);
    expect(await quotas.snapshot(now)).toMatchObject({ globalSpendUsd: 0, reservedSpendUsd: 3 });
  });

  it("denies a new live run when the remaining budget cannot cover a full reservation", async () => {
    const quotas = quotaRepository();
    const reservation = await quotas.reserve({
      bucket: "browser-a",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: 2.99,
      liveEnabled: true,
      now,
    });
    if (!reservation.allowed || !reservation.reservationId) throw new Error("expected_live_reservation");
    await quotas.settleLiveReservation(reservation.reservationId, 2.99);

    await expect(
      quotas.reserve({
        bucket: "browser-b",
        sourceType: "synthetic",
        executionMode: "live",
        estimatedCostUsd: 0,
        liveEnabled: true,
        now,
      }),
    ).resolves.toEqual({ allowed: false, reason: "daily_budget", replayAvailable: true });
  });

  it("fails closed when actual cost exceeds its conservative reservation", async () => {
    const quotas = quotaRepository();
    const reservation = await quotas.reserve({
      bucket: "browser-a",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: 0,
      liveEnabled: true,
      now,
    });
    if (!reservation.allowed || !reservation.reservationId) throw new Error("expected_live_reservation");

    await expect(quotas.settleLiveReservation(reservation.reservationId, 1.01)).resolves.toEqual({
      status: "reservation_exceeded",
      actualCostUsd: 1.01,
    });
    expect(await quotas.snapshot(now)).toMatchObject({ globalSpendUsd: 1.01, reservedSpendUsd: 0 });
  });

  it("settles actual live cost once then releases the unused reservation without double charging", async () => {
    const quotas = quotaRepository();
    const reservation = await quotas.reserve({
      bucket: "browser-b",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: 0,
      liveEnabled: true,
      now,
    });
    if (!reservation.allowed || !reservation.reservationId) throw new Error("expected_live_reservation");

    await expect(quotas.settleLiveReservation(reservation.reservationId, 0.75)).resolves.toEqual({
      status: "settled",
      actualCostUsd: 0.75,
    });
    await expect(quotas.settleLiveReservation(reservation.reservationId, 0.75)).resolves.toEqual({
      status: "already_settled",
      actualCostUsd: 0.75,
    });
    expect(await quotas.snapshot(now)).toMatchObject({ globalSpendUsd: 0.75, reservedSpendUsd: 0 });
  });

  it("releases a failed live reservation while retaining the live-run attempt count", async () => {
    const quotas = quotaRepository();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const reservation = await quotas.reserve({
        bucket: "browser-a",
        sourceType: "synthetic",
        executionMode: "live",
        estimatedCostUsd: 0,
        liveEnabled: true,
        now,
      });
      if (!reservation.allowed || !reservation.reservationId) throw new Error("expected_live_reservation");
      await expect(quotas.releaseLiveReservation(reservation.reservationId)).resolves.toBe(true);
    }
    await expect(
      quotas.reserve({
        bucket: "browser-a",
        sourceType: "synthetic",
        executionMode: "live",
        estimatedCostUsd: 0,
        liveEnabled: true,
        now,
      }),
    ).resolves.toEqual({ allowed: false, reason: "live_run_limit", replayAvailable: true });
    expect(await quotas.snapshot(now)).toMatchObject({ globalSpendUsd: 0, reservedSpendUsd: 0 });
  });

  it("keeps recorded replays at zero without creating model-budget reservations", async () => {
    const quotas = quotaRepository();

    const replayDecisions = await Promise.all(
      Array.from({ length: 20 }, () =>
        quotas.reserve({
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
    expect(replayDecisions.every((decision) => decision.allowed && decision.reservationId === null)).toBe(true);
    expect(await quotas.snapshot(now)).toMatchObject({ globalSpendUsd: 0, reservedSpendUsd: 0 });
  });

  it("blocks rotating browser buckets at the global custom-upload ceiling", async () => {
    const quotas = new InMemoryQuotaRepository(
      3,
      () => crypto.randomUUID(),
      1,
      { globalCustomUploads: 2 },
    );
    const decisions = [];
    for (const bucket of ["rotated-a", "rotated-b", "rotated-c"]) {
      decisions.push(
        await quotas.reserve({
          bucket,
          sourceType: "custom",
          executionMode: "live",
          estimatedCostUsd: 0,
          liveEnabled: true,
          now,
        }),
      );
    }

    expect(decisions.slice(0, 2).every((decision) => decision.allowed)).toBe(true);
    expect(decisions[2]).toEqual({
      allowed: false,
      reason: "global_custom_upload_limit",
      replayAvailable: true,
    });
  });

  it("bounds recorded synthetic runs per browser and across all browsers", async () => {
    const quotas = new InMemoryQuotaRepository(
      3,
      () => crypto.randomUUID(),
      1,
      { recordedRunsPerBucket: 2, globalRecordedRuns: 3 },
    );
    const reserveRecorded = (bucket: string) =>
      quotas.reserve({
        bucket,
        sourceType: "synthetic",
        executionMode: "recorded",
        estimatedCostUsd: 0,
        liveEnabled: false,
        now,
      });

    await expect(reserveRecorded("browser-a")).resolves.toMatchObject({ allowed: true });
    await expect(reserveRecorded("browser-a")).resolves.toMatchObject({ allowed: true });
    await expect(reserveRecorded("browser-a")).resolves.toEqual({
      allowed: false,
      reason: "recorded_run_limit",
      replayAvailable: true,
    });
    await expect(reserveRecorded("browser-b")).resolves.toMatchObject({ allowed: true });
    await expect(reserveRecorded("browser-c")).resolves.toEqual({
      allowed: false,
      reason: "global_recorded_run_limit",
      replayAvailable: true,
    });
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

  it("maps concurrent conservative reservations and actual settlement through the Neon port", async () => {
    let globalSpendUsd = 0;
    const pending = new Map<string, number>();
    const settled = new Map<string, number>();
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        const normalizedSql = sql.trim();
        if (normalizedSql.startsWith("SELECT reserve_daily_quota")) {
          const budget = Number(parameters[11]);
          const reservationId = String(parameters[12]);
          const reservationCostUsd = Number(parameters[13]);
          const pendingSpendUsd = [...pending.values()].reduce((total, cost) => total + cost, 0);
          if (globalSpendUsd + pendingSpendUsd + reservationCostUsd > budget) {
            return [{ decision: { decision: "daily_budget" } }];
          }
          pending.set(reservationId, reservationCostUsd);
          return [
            {
              decision: {
                decision: "allowed",
                reservationId,
                reservedCostUsd: reservationCostUsd,
              },
            },
          ];
        }
        if (normalizedSql.startsWith("SELECT settle_daily_quota")) {
          const reservationId = String(parameters[0]);
          if (settled.has(reservationId)) {
            return [
              {
                result: {
                  status: "already_settled",
                  actualCostUsd: settled.get(reservationId),
                },
              },
            ];
          }
          const actualCostUsd = Number(parameters[1]);
          const reservedCostUsd = pending.get(reservationId);
          if (reservedCostUsd === undefined) {
            return [{ result: { status: "not_found", actualCostUsd: 0 } }];
          }
          pending.delete(reservationId);
          settled.set(reservationId, actualCostUsd);
          globalSpendUsd += actualCostUsd;
          return [
            {
              result: {
                status:
                  actualCostUsd > reservedCostUsd ? "reservation_exceeded" : "settled",
                actualCostUsd,
              },
            },
          ];
        }
        if (normalizedSql.startsWith("SELECT\n        usage.anonymous_buckets")) {
          return [
            {
              anonymous_buckets: {},
              global_spend_usd: globalSpendUsd,
              global_custom_uploads: 0,
              global_recorded_runs: 0,
              reserved_spend_usd: [...pending.values()].reduce(
                (total, cost) => total + cost,
                0,
              ),
            },
          ];
        }
        return [];
      },
    };
    let nextId = 0;
    const quotas = createNeonQuotaRepository({
      databaseUrl: undefined,
      driver,
      idSource: () => `neon-reservation-${++nextId}`,
    });
    const reservationInput = {
      bucket: "browser-neon",
      sourceType: "synthetic" as const,
      executionMode: "live" as const,
      estimatedCostUsd: 0,
      liveEnabled: true,
      now,
    };

    const decisions = await Promise.all(
      Array.from({ length: 4 }, () => quotas.reserve(reservationInput)),
    );
    const allowed = decisions.filter((decision) => decision.allowed);
    expect(allowed).toHaveLength(3);
    expect(decisions.filter((decision) => !decision.allowed)).toEqual([
      { allowed: false, reason: "daily_budget", replayAvailable: true },
    ]);
    if (!allowed[0].allowed || !allowed[0].reservationId) {
      throw new Error("expected_neon_reservation");
    }
    await expect(
      quotas.settleLiveReservation(allowed[0].reservationId, 0.25),
    ).resolves.toEqual({ status: "settled", actualCostUsd: 0.25 });
    await expect(quotas.snapshot(now)).resolves.toMatchObject({
      globalSpendUsd: 0.25,
      reservedSpendUsd: 2,
    });
  });

  it("never lets a negative reservation lower the global spend ledger", async () => {
    const quotas = quotaRepository();
    const reservation = await quotas.reserve({
      bucket: "browser-a",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: -1,
      liveEnabled: true,
      now,
    });
    expect(reservation).toEqual({
      allowed: true,
      reservationId: "reservation-1",
      reservedCostUsd: 1,
    });
    expect(await quotas.snapshot(now)).toMatchObject({ globalSpendUsd: 0, reservedSpendUsd: 1 });
  });

  it("does not run schema DDL during ordinary Neon quota requests", async () => {
    const statements: string[] = [];
    const driver: NeonDriver = {
      async query(sql) {
        statements.push(sql.trim());
        return [{ decision: { decision: "daily_budget" } }];
      },
    };
    const quotas = createNeonQuotaRepository({ databaseUrl: undefined, driver });

    await quotas.reserve({
      bucket: "browser-a",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: 0,
      liveEnabled: true,
      now,
    });

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT reserve_daily_quota/);
    expect(statements[0]).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s/i);
  });
});
