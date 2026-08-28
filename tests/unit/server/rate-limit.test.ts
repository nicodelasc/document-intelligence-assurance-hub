import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_MODEL_RESERVATION_USD as MAX_SUPPORTED_LIVE_RUN_COST_USD,
} from "@/domain/pricing";
import {
  InMemoryQuotaRepository,
  createNeonQuotaRepository,
} from "@/server/security/rate-limit";
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
  it("admits a default-model reservation below the daily budget instead of charging the catalogue maximum", async () => {
    const quotas = quotaRepository();

    await expect(
      quotas.reserve({
        bucket: "browser-default-model",
        sourceType: "synthetic",
        executionMode: "live",
        estimatedCostUsd: 0.424,
        liveEnabled: true,
        now,
      }),
    ).resolves.toMatchObject({
      allowed: true,
      reservedCostUsd: 0.424,
    });
  });

  it("reserves a complete default-model two-attempt run before provider dispatch", async () => {
    const quotas = new InMemoryQuotaRepository(
      MAX_SUPPORTED_LIVE_RUN_COST_USD + 0.01,
      () => "worst-case-reservation",
      0.01,
    );

    await expect(
      quotas.reserve({
        bucket: "browser-a",
        sourceType: "synthetic",
        executionMode: "live",
        estimatedCostUsd: 0,
        liveEnabled: true,
        now,
      }),
    ).resolves.toEqual({
      allowed: true,
      reservationId: "worst-case-reservation",
      reservedCostUsd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
    });
    await expect(
      quotas.reserve({
        bucket: "browser-b",
        sourceType: "synthetic",
        executionMode: "live",
        estimatedCostUsd: 0,
        liveEnabled: true,
        now,
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "daily_budget",
      replayAvailable: true,
    });
  });

  it("charges a stale pending reservation conservatively before later admission", async () => {
    const quotas = new InMemoryQuotaRepository(
      MAX_SUPPORTED_LIVE_RUN_COST_USD,
      () => crypto.randomUUID(),
      MAX_SUPPORTED_LIVE_RUN_COST_USD,
      {},
      60_000,
    );
    const request = {
      bucket: "browser-a",
      sourceType: "synthetic" as const,
      executionMode: "live" as const,
      estimatedCostUsd: 0,
      liveEnabled: true,
    };

    const reservation = await quotas.reserve({ ...request, now });
    expect(reservation).toMatchObject({ allowed: true });
    if (!reservation.allowed || !reservation.reservationId)
      throw new Error("expected_live_reservation");
    await expect(
      quotas.markLiveReservationDispatched(reservation.reservationId),
    ).resolves.toBe(true);
    await expect(
      quotas.reserve({
        ...request,
        bucket: "browser-b",
        now: new Date(now.getTime() + 59_999),
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "daily_budget",
      replayAvailable: true,
    });
    await expect(
      quotas.reserve({
        ...request,
        bucket: "browser-b",
        now: new Date(now.getTime() + 60_000),
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "daily_budget",
      replayAvailable: true,
    });
    await expect(
      quotas.snapshot(new Date(now.getTime() + 60_000)),
    ).resolves.toMatchObject({
      globalSpendUsd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
      reservedSpendUsd: 0,
    });
  });

  it("releases a stale reservation that was never dispatched", async () => {
    const quotas = new InMemoryQuotaRepository(
      MAX_SUPPORTED_LIVE_RUN_COST_USD,
      () => "undispatched-reservation",
      MAX_SUPPORTED_LIVE_RUN_COST_USD,
      {},
      60_000,
    );
    await quotas.reserve({
      bucket: "browser-a",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: 0,
      liveEnabled: true,
      now,
    });

    await expect(
      quotas.snapshot(new Date(now.getTime() + 60_000)),
    ).resolves.toMatchObject({
      globalSpendUsd: 0,
      reservedSpendUsd: 0,
    });
  });

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
    expect(
      decisions
        .filter((decision) => !decision.allowed)
        .map((decision) => decision.reason),
    ).toEqual(Array(7).fill("custom_upload_limit"));
  });

  it("blocks concurrent zero-estimate bypasses with a conservative global reservation", async () => {
    const quotas = quotaRepository();
    const decisions = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        quotas.reserve({
          bucket: `browser-${index}`,
          sourceType: "synthetic",
          executionMode: "live",
          estimatedCostUsd: 0,
          liveEnabled: true,
          now,
        }),
      ),
    );
    const allowed = decisions.filter((decision) => decision.allowed);
    expect(allowed).toHaveLength(7);
    expect(
      allowed.every(
        (decision) =>
          decision.allowed &&
          decision.reservedCostUsd === MAX_SUPPORTED_LIVE_RUN_COST_USD,
      ),
    ).toBe(true);
    expect(decisions.filter((decision) => !decision.allowed)).toEqual([
      { allowed: false, reason: "daily_budget", replayAvailable: true },
    ]);
    expect(await quotas.snapshot(now)).toMatchObject({
      globalSpendUsd: 0,
      reservedSpendUsd: 7 * MAX_SUPPORTED_LIVE_RUN_COST_USD,
    });
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
    if (!reservation.allowed || !reservation.reservationId)
      throw new Error("expected_live_reservation");
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
    ).resolves.toEqual({
      allowed: false,
      reason: "daily_budget",
      replayAvailable: true,
    });
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
    if (!reservation.allowed || !reservation.reservationId)
      throw new Error("expected_live_reservation");

    await expect(
      quotas.settleLiveReservation(reservation.reservationId, 1.01),
    ).resolves.toEqual({
      status: "reservation_exceeded",
      actualCostUsd: reservation.reservedCostUsd,
    });
    expect(await quotas.snapshot(now)).toMatchObject({
      globalSpendUsd: reservation.reservedCostUsd,
      reservedSpendUsd: 0,
    });
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
    if (!reservation.allowed || !reservation.reservationId)
      throw new Error("expected_live_reservation");

    await expect(
      quotas.settleLiveReservation(reservation.reservationId, 0.25),
    ).resolves.toEqual({
      status: "settled",
      actualCostUsd: 0.25,
    });
    await expect(
      quotas.settleLiveReservation(reservation.reservationId, 0.25),
    ).resolves.toEqual({
      status: "already_settled",
      actualCostUsd: 0.25,
    });
    expect(await quotas.snapshot(now)).toMatchObject({
      globalSpendUsd: 0.25,
      reservedSpendUsd: 0,
    });
  });

  it("settles a pending reservation from its repository-stored amount", async () => {
    const quotas = quotaRepository();
    const reservation = await quotas.reserve({
      bucket: "browser-conservative",
      sourceType: "synthetic",
      executionMode: "live",
      estimatedCostUsd: 0,
      liveEnabled: true,
      now,
    });
    if (!reservation.allowed || !reservation.reservationId)
      throw new Error("expected_live_reservation");
    const conservativeSettlement = (
      quotas as InMemoryQuotaRepository & {
        settleLiveReservationConservatively?: (
          reservationId: string,
        ) => Promise<{ status: string; actualCostUsd: number }>;
      }
    ).settleLiveReservationConservatively;

    expect(typeof conservativeSettlement).toBe("function");
    if (!conservativeSettlement) return;
    await expect(
      conservativeSettlement.call(quotas, reservation.reservationId),
    ).resolves.toEqual({
      status: "settled",
      actualCostUsd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
    });
    await expect(
      conservativeSettlement.call(quotas, reservation.reservationId),
    ).resolves.toEqual({
      status: "already_settled",
      actualCostUsd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
    });
    await expect(quotas.snapshot(now)).resolves.toMatchObject({
      globalSpendUsd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
      reservedSpendUsd: 0,
    });
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
      if (!reservation.allowed || !reservation.reservationId)
        throw new Error("expected_live_reservation");
      await expect(
        quotas.releaseLiveReservation(reservation.reservationId),
      ).resolves.toBe(true);
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
    ).resolves.toEqual({
      allowed: false,
      reason: "live_run_limit",
      replayAvailable: true,
    });
    expect(await quotas.snapshot(now)).toMatchObject({
      globalSpendUsd: 0,
      reservedSpendUsd: 0,
    });
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
    expect(
      replayDecisions.every(
        (decision) => decision.allowed && decision.reservationId === null,
      ),
    ).toBe(true);
    expect(await quotas.snapshot(now)).toMatchObject({
      globalSpendUsd: 0,
      reservedSpendUsd: 0,
    });
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

    expect(decisions.slice(0, 2).every((decision) => decision.allowed)).toBe(
      true,
    );
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

    await expect(reserveRecorded("browser-a")).resolves.toMatchObject({
      allowed: true,
    });
    await expect(reserveRecorded("browser-a")).resolves.toMatchObject({
      allowed: true,
    });
    await expect(reserveRecorded("browser-a")).resolves.toEqual({
      allowed: false,
      reason: "recorded_run_limit",
      replayAvailable: true,
    });
    await expect(reserveRecorded("browser-b")).resolves.toMatchObject({
      allowed: true,
    });
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
    ).resolves.toEqual({
      allowed: false,
      reason: "live_disabled",
      replayAvailable: true,
    });
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
          const budget = Number(parameters[12]);
          const reservationId = String(parameters[13]);
          const reservationCostUsd = Number(parameters[14]);
          const pendingSpendUsd = [...pending.values()].reduce(
            (total, cost) => total + cost,
            0,
          );
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
                  actualCostUsd > reservedCostUsd
                    ? "reservation_exceeded"
                    : "settled",
                actualCostUsd,
              },
            },
          ];
        }
        if (
          normalizedSql.startsWith("SELECT\n        usage.anonymous_buckets")
        ) {
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
      Array.from({ length: 8 }, () => quotas.reserve(reservationInput)),
    );
    const allowed = decisions.filter((decision) => decision.allowed);
    expect(allowed).toHaveLength(7);
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
      reservedSpendUsd: 6 * MAX_SUPPORTED_LIVE_RUN_COST_USD,
    });
  });

  it("maps conservative settlement and stale reconciliation through Neon functions", async () => {
    const statements: Array<{ sql: string; parameters: unknown[] }> = [];
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        statements.push({ sql: sql.trim(), parameters });
        if (sql.includes("settle_reserved_daily_quota")) {
          return [
            {
              result: {
                status: "settled",
                actualCostUsd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
              },
            },
          ];
        }
        if (sql.includes("reconcile_stale_daily_quota")) return [{}];
        if (sql.includes("usage.anonymous_buckets")) {
          return [
            {
              anonymous_buckets: {},
              global_spend_usd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
              global_custom_uploads: 0,
              global_recorded_runs: 0,
              reserved_spend_usd: 0,
            },
          ];
        }
        return [];
      },
    };
    const quotas = createNeonQuotaRepository({
      databaseUrl: undefined,
      driver,
    });

    await expect(
      quotas.settleLiveReservationConservatively("reservation-neon"),
    ).resolves.toEqual({
      status: "settled",
      actualCostUsd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
    });
    await expect(quotas.snapshot(now)).resolves.toMatchObject({
      globalSpendUsd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
      reservedSpendUsd: 0,
    });
    expect(statements[0]).toEqual({
      sql: "SELECT settle_reserved_daily_quota($1) AS result",
      parameters: ["reservation-neon"],
    });
    expect(statements[1]).toEqual({
      sql: "SELECT reconcile_stale_daily_quota($1::date, $2::timestamptz)",
      parameters: ["2026-08-27", now.toISOString()],
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
      reservedCostUsd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
    });
    expect(await quotas.snapshot(now)).toMatchObject({
      globalSpendUsd: 0,
      reservedSpendUsd: MAX_SUPPORTED_LIVE_RUN_COST_USD,
    });
  });

  it("does not run schema DDL during ordinary Neon quota requests", async () => {
    const statements: string[] = [];
    const driver: NeonDriver = {
      async query(sql) {
        statements.push(sql.trim());
        return [{ decision: { decision: "daily_budget" } }];
      },
    };
    const quotas = createNeonQuotaRepository({
      databaseUrl: undefined,
      driver,
    });

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
