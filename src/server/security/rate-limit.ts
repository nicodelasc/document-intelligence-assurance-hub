import type {
  ExecutionMode,
  SourceType,
} from "@/server/repositories/run-repository";
import { DEFAULT_LIVE_MODEL_RESERVATION_USD } from "@/domain/pricing";
import {
  PersistenceConfigurationError,
  type NeonDriver,
} from "@/server/repositories/run-repository";
import { randomUUID } from "node:crypto";

export const DEFAULT_DAILY_MODEL_BUDGET_USD = 3;
export const DEFAULT_LIVE_RUN_RESERVATION_USD =
  DEFAULT_LIVE_MODEL_RESERVATION_USD;
export const DEFAULT_LIVE_RESERVATION_LEASE_MS = 15 * 60 * 1000;
export const MAX_CUSTOM_UPLOADS_PER_DAY = 3;
export const MAX_LIVE_RUNS_PER_DAY = 6;
export const MAX_RECORDED_RUNS_PER_BROWSER_PER_DAY = 24;
export const MAX_GLOBAL_CUSTOM_UPLOADS_PER_DAY = 30;
export const MAX_GLOBAL_RECORDED_RUNS_PER_DAY = 240;

export type QuotaDenialReason =
  | "custom_upload_limit"
  | "global_custom_upload_limit"
  | "live_run_limit"
  | "recorded_run_limit"
  | "global_recorded_run_limit"
  | "daily_budget"
  | "live_disabled";

export type QuotaDecision =
  | { allowed: true; reservationId: string | null; reservedCostUsd: number }
  | { allowed: false; reason: QuotaDenialReason; replayAvailable: true };

export type QuotaReservation = {
  bucket: string;
  sourceType: SourceType;
  executionMode: ExecutionMode;
  estimatedCostUsd: number;
  liveEnabled: boolean;
  now: Date;
};

type DailyUsage = {
  customUploadsByBucket: Map<string, number>;
  liveRunsByBucket: Map<string, number>;
  recordedRunsByBucket: Map<string, number>;
  globalCustomUploads: number;
  globalRecordedRuns: number;
  globalSpendUsd: number;
};

export type QuotaLimits = {
  customUploadsPerBucket: number;
  liveRunsPerBucket: number;
  recordedRunsPerBucket: number;
  globalCustomUploads: number;
  globalRecordedRuns: number;
};

const defaultQuotaLimits: QuotaLimits = {
  customUploadsPerBucket: MAX_CUSTOM_UPLOADS_PER_DAY,
  liveRunsPerBucket: MAX_LIVE_RUNS_PER_DAY,
  recordedRunsPerBucket: MAX_RECORDED_RUNS_PER_BROWSER_PER_DAY,
  globalCustomUploads: MAX_GLOBAL_CUSTOM_UPLOADS_PER_DAY,
  globalRecordedRuns: MAX_GLOBAL_RECORDED_RUNS_PER_DAY,
};

export type QuotaSnapshot = {
  globalSpendUsd: number;
  reservedSpendUsd: number;
  globalCustomUploads: number;
  globalRecordedRuns: number;
  customUploadsByBucket: Record<string, number>;
  liveRunsByBucket: Record<string, number>;
  recordedRunsByBucket: Record<string, number>;
};

type LiveReservation = {
  id: string;
  day: string;
  reservedCostUsd: number;
  actualCostUsd: number;
  status: "pending" | "settled" | "released";
  dispatched: boolean;
  expiresAtMs: number;
};

export type QuotaSettlement = {
  status:
    | "settled"
    | "already_settled"
    | "reservation_exceeded"
    | "released"
    | "not_found";
  actualCostUsd: number;
};

export interface QuotaRepository {
  reserve(input: QuotaReservation): Promise<QuotaDecision>;
  markLiveReservationDispatched(reservationId: string): Promise<boolean>;
  clearLiveReservationDispatched(reservationId: string): Promise<boolean>;
  settleLiveReservation(
    reservationId: string,
    actualCostUsd: number,
  ): Promise<QuotaSettlement>;
  settleLiveReservationConservatively(
    reservationId: string,
  ): Promise<QuotaSettlement>;
  releaseLiveReservation(reservationId: string): Promise<boolean>;
  snapshot(now: Date): Promise<QuotaSnapshot>;
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export class InMemoryQuotaRepository implements QuotaRepository {
  private readonly days = new Map<string, DailyUsage>();
  private readonly reservations = new Map<string, LiveReservation>();
  private readonly limits: QuotaLimits;
  private readonly liveRunReservationUsd: number;
  private readonly reservationLeaseMs: number;
  private lockTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly dailyBudgetUsd = DEFAULT_DAILY_MODEL_BUDGET_USD,
    private readonly idSource: () => string = randomUUID,
    liveRunReservationUsd = DEFAULT_LIVE_RUN_RESERVATION_USD,
    limits: Partial<QuotaLimits> = {},
    reservationLeaseMs = DEFAULT_LIVE_RESERVATION_LEASE_MS,
  ) {
    this.limits = { ...defaultQuotaLimits, ...limits };
    this.liveRunReservationUsd = Math.max(
      DEFAULT_LIVE_RUN_RESERVATION_USD,
      Number.isFinite(liveRunReservationUsd) ? liveRunReservationUsd : 0,
    );
    this.reservationLeaseMs =
      Number.isFinite(reservationLeaseMs) && reservationLeaseMs > 0
        ? reservationLeaseMs
        : DEFAULT_LIVE_RESERVATION_LEASE_MS;
  }

  async reserve(input: QuotaReservation): Promise<QuotaDecision> {
    return this.withLock(() => {
      this.reclaimStaleReservations(input.now.getTime());
      const usage = this.day(input.now);
      const customUploads = usage.customUploadsByBucket.get(input.bucket) ?? 0;
      const liveRuns = usage.liveRunsByBucket.get(input.bucket) ?? 0;
      const recordedRuns = usage.recordedRunsByBucket.get(input.bucket) ?? 0;
      const isRecordedSynthetic =
        input.sourceType === "synthetic" && input.executionMode === "recorded";

      if (
        input.sourceType === "custom" &&
        customUploads >= this.limits.customUploadsPerBucket
      ) {
        return {
          allowed: false,
          reason: "custom_upload_limit",
          replayAvailable: true,
        };
      }

      if (
        input.sourceType === "custom" &&
        usage.globalCustomUploads >= this.limits.globalCustomUploads
      ) {
        return {
          allowed: false,
          reason: "global_custom_upload_limit",
          replayAvailable: true,
        };
      }

      if (
        isRecordedSynthetic &&
        recordedRuns >= this.limits.recordedRunsPerBucket
      ) {
        return {
          allowed: false,
          reason: "recorded_run_limit",
          replayAvailable: true,
        };
      }

      if (
        isRecordedSynthetic &&
        usage.globalRecordedRuns >= this.limits.globalRecordedRuns
      ) {
        return {
          allowed: false,
          reason: "global_recorded_run_limit",
          replayAvailable: true,
        };
      }

      if (input.executionMode === "live" && !input.liveEnabled) {
        return {
          allowed: false,
          reason: "live_disabled",
          replayAvailable: true,
        };
      }

      if (
        input.executionMode === "live" &&
        liveRuns >= this.limits.liveRunsPerBucket
      ) {
        return {
          allowed: false,
          reason: "live_run_limit",
          replayAvailable: true,
        };
      }

      if (input.executionMode === "live") {
        const day = utcDay(input.now);
        const remainingBudget =
          this.dailyBudgetUsd -
          usage.globalSpendUsd -
          this.pendingSpendUsd(day);
        const callerEstimate = Number.isFinite(input.estimatedCostUsd)
          ? Math.max(0, input.estimatedCostUsd)
          : this.dailyBudgetUsd + this.liveRunReservationUsd;
        const reservationCostUsd = Math.max(
          this.liveRunReservationUsd,
          callerEstimate,
        );
        if (remainingBudget < reservationCostUsd) {
          return {
            allowed: false,
            reason: "daily_budget",
            replayAvailable: true,
          };
        }
        const reservationId = this.idSource();
        this.reservations.set(reservationId, {
          id: reservationId,
          day,
          reservedCostUsd: reservationCostUsd,
          actualCostUsd: 0,
          status: "pending",
          dispatched: false,
          expiresAtMs: input.now.getTime() + this.reservationLeaseMs,
        });
        if (input.sourceType === "custom") {
          usage.customUploadsByBucket.set(input.bucket, customUploads + 1);
          usage.globalCustomUploads += 1;
        }
        usage.liveRunsByBucket.set(input.bucket, liveRuns + 1);
        return {
          allowed: true,
          reservationId,
          reservedCostUsd: reservationCostUsd,
        };
      }
      if (input.sourceType === "custom") {
        usage.customUploadsByBucket.set(input.bucket, customUploads + 1);
        usage.globalCustomUploads += 1;
      }
      if (isRecordedSynthetic) {
        usage.recordedRunsByBucket.set(input.bucket, recordedRuns + 1);
        usage.globalRecordedRuns += 1;
      }
      return { allowed: true, reservationId: null, reservedCostUsd: 0 };
    });
  }

  async markLiveReservationDispatched(reservationId: string): Promise<boolean> {
    return this.withLock(() => {
      const reservation = this.reservations.get(reservationId);
      if (!reservation || reservation.status !== "pending") return false;
      reservation.dispatched = true;
      return true;
    });
  }

  async clearLiveReservationDispatched(
    reservationId: string,
  ): Promise<boolean> {
    return this.withLock(() => {
      const reservation = this.reservations.get(reservationId);
      if (!reservation || reservation.status !== "pending") return false;
      reservation.dispatched = false;
      return true;
    });
  }

  async settleLiveReservation(
    reservationId: string,
    actualCostUsd: number,
  ): Promise<QuotaSettlement> {
    return this.withLock(() => {
      if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) {
        throw new Error("quota_settlement_invalid");
      }
      const reservation = this.reservations.get(reservationId);
      if (!reservation) return { status: "not_found", actualCostUsd: 0 };
      if (reservation.status === "released")
        return { status: "released", actualCostUsd: 0 };
      if (reservation.status === "settled") {
        return {
          status: "already_settled",
          actualCostUsd: reservation.actualCostUsd,
        };
      }
      const reservationExceeded = actualCostUsd > reservation.reservedCostUsd;
      const actual = reservationExceeded
        ? reservation.reservedCostUsd
        : actualCostUsd;
      reservation.status = "settled";
      reservation.actualCostUsd = actual;
      this.days.get(reservation.day)!.globalSpendUsd += actual;
      return {
        status: reservationExceeded ? "reservation_exceeded" : "settled",
        actualCostUsd: actual,
      };
    });
  }

  async settleLiveReservationConservatively(
    reservationId: string,
  ): Promise<QuotaSettlement> {
    return this.withLock(() => {
      const reservation = this.reservations.get(reservationId);
      if (!reservation) return { status: "not_found", actualCostUsd: 0 };
      if (reservation.status === "released")
        return { status: "released", actualCostUsd: 0 };
      if (reservation.status === "settled") {
        return {
          status: "already_settled",
          actualCostUsd: reservation.actualCostUsd,
        };
      }
      reservation.status = "settled";
      reservation.actualCostUsd = reservation.reservedCostUsd;
      this.days.get(reservation.day)!.globalSpendUsd +=
        reservation.reservedCostUsd;
      return {
        status: "settled",
        actualCostUsd: reservation.reservedCostUsd,
      };
    });
  }

  async releaseLiveReservation(reservationId: string): Promise<boolean> {
    return this.withLock(() => {
      const reservation = this.reservations.get(reservationId);
      if (!reservation || reservation.status !== "pending") return false;
      reservation.status = "released";
      return true;
    });
  }

  async snapshot(now: Date): Promise<QuotaSnapshot> {
    return this.withLock(() => {
      this.reclaimStaleReservations(now.getTime());
      const usage = this.day(now);
      return {
        globalSpendUsd: usage.globalSpendUsd,
        reservedSpendUsd: this.pendingSpendUsd(utcDay(now)),
        globalCustomUploads: usage.globalCustomUploads,
        globalRecordedRuns: usage.globalRecordedRuns,
        customUploadsByBucket: Object.fromEntries(usage.customUploadsByBucket),
        liveRunsByBucket: Object.fromEntries(usage.liveRunsByBucket),
        recordedRunsByBucket: Object.fromEntries(usage.recordedRunsByBucket),
      };
    });
  }

  private day(now: Date): DailyUsage {
    const key = utcDay(now);
    let usage = this.days.get(key);
    if (!usage) {
      usage = {
        customUploadsByBucket: new Map(),
        liveRunsByBucket: new Map(),
        recordedRunsByBucket: new Map(),
        globalCustomUploads: 0,
        globalRecordedRuns: 0,
        globalSpendUsd: 0,
      };
      this.days.set(key, usage);
    }
    return usage;
  }

  private pendingSpendUsd(day: string): number {
    let total = 0;
    for (const reservation of this.reservations.values()) {
      if (reservation.day === day && reservation.status === "pending") {
        total += reservation.reservedCostUsd;
      }
    }
    return total;
  }

  private reclaimStaleReservations(nowMs: number): void {
    for (const reservation of this.reservations.values()) {
      if (
        reservation.status === "pending" &&
        reservation.expiresAtMs <= nowMs
      ) {
        if (reservation.dispatched) {
          reservation.status = "settled";
          reservation.actualCostUsd = reservation.reservedCostUsd;
          this.days.get(reservation.day)!.globalSpendUsd +=
            reservation.reservedCostUsd;
        } else {
          reservation.status = "released";
        }
      }
    }
  }

  private async withLock<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.lockTail;
    let release: () => void = () => undefined;
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

type NeonQuotaOptions = {
  databaseUrl: string | undefined;
  driver?: NeonDriver;
  dailyBudgetUsd?: number;
  liveRunReservationUsd?: number;
  reservationLeaseMs?: number;
  idSource?: () => string;
  limits?: Partial<QuotaLimits>;
};

class NeonQuotaRepository implements QuotaRepository {
  private driverPromise: Promise<NeonDriver> | null = null;

  constructor(private readonly options: NeonQuotaOptions) {}

  async reserve(input: QuotaReservation): Promise<QuotaDecision> {
    const driver = await this.readyDriver();
    const reservationId = this.options.idSource?.() ?? randomUUID();
    const limits = { ...defaultQuotaLimits, ...this.options.limits };
    const rows = await driver.query<{ decision: unknown }>(
      `SELECT reserve_daily_quota(
        $1::date, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16
      ) AS decision`,
      [
        utcDay(input.now),
        input.now.toISOString(),
        input.bucket,
        input.sourceType === "custom",
        input.executionMode === "live",
        input.sourceType === "synthetic" && input.executionMode === "recorded",
        input.liveEnabled,
        limits.customUploadsPerBucket,
        limits.liveRunsPerBucket,
        limits.recordedRunsPerBucket,
        limits.globalCustomUploads,
        limits.globalRecordedRuns,
        this.options.dailyBudgetUsd ?? DEFAULT_DAILY_MODEL_BUDGET_USD,
        reservationId,
        Math.max(
          DEFAULT_LIVE_RUN_RESERVATION_USD,
          this.options.liveRunReservationUsd ??
            DEFAULT_LIVE_RUN_RESERVATION_USD,
          Number.isFinite(input.estimatedCostUsd)
            ? Math.max(0, input.estimatedCostUsd)
            : (this.options.dailyBudgetUsd ?? DEFAULT_DAILY_MODEL_BUDGET_USD) +
                (this.options.liveRunReservationUsd ??
                  DEFAULT_LIVE_RUN_RESERVATION_USD),
        ),
        Math.max(
          1,
          Math.ceil(
            (this.options.reservationLeaseMs ??
              DEFAULT_LIVE_RESERVATION_LEASE_MS) / 1000,
          ),
        ),
      ],
    );
    const response = parseJsonRecord(rows[0]?.decision);
    const decision = response?.decision;
    if (decision === "allowed") {
      return {
        allowed: true,
        reservationId:
          typeof response?.reservationId === "string"
            ? response.reservationId
            : null,
        reservedCostUsd: Number(response?.reservedCostUsd ?? 0),
      };
    }
    if (
      decision === "custom_upload_limit" ||
      decision === "global_custom_upload_limit" ||
      decision === "live_run_limit" ||
      decision === "recorded_run_limit" ||
      decision === "global_recorded_run_limit" ||
      decision === "daily_budget" ||
      decision === "live_disabled"
    ) {
      return { allowed: false, reason: decision, replayAvailable: true };
    }
    throw new Error("quota_reservation_failed");
  }

  async settleLiveReservation(
    reservationId: string,
    actualCostUsd: number,
  ): Promise<QuotaSettlement> {
    if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) {
      throw new Error("quota_settlement_invalid");
    }
    const driver = await this.readyDriver();
    const rows = await driver.query<{ result: unknown }>(
      "SELECT settle_daily_quota($1, $2, false) AS result",
      [reservationId, actualCostUsd],
    );
    const response = parseJsonRecord(rows[0]?.result);
    const status = response?.status;
    if (
      status !== "settled" &&
      status !== "already_settled" &&
      status !== "reservation_exceeded" &&
      status !== "released" &&
      status !== "not_found"
    ) {
      throw new Error("quota_settlement_failed");
    }
    return { status, actualCostUsd: Number(response?.actualCostUsd ?? 0) };
  }

  async markLiveReservationDispatched(reservationId: string): Promise<boolean> {
    const driver = await this.readyDriver();
    const rows = await driver.query<{ result: unknown }>(
      "SELECT mark_daily_quota_dispatched($1) AS result",
      [reservationId],
    );
    return parseJsonRecord(rows[0]?.result)?.status === "dispatched";
  }

  async clearLiveReservationDispatched(
    reservationId: string,
  ): Promise<boolean> {
    const driver = await this.readyDriver();
    const rows = await driver.query<{ id: unknown }>(
      `UPDATE model_budget_reservations
        SET dispatched_at = NULL
        WHERE id = $1 AND status = 'pending'
        RETURNING id`,
      [reservationId],
    );
    return rows.length === 1;
  }

  async settleLiveReservationConservatively(
    reservationId: string,
  ): Promise<QuotaSettlement> {
    const driver = await this.readyDriver();
    const rows = await driver.query<{ result: unknown }>(
      "SELECT settle_reserved_daily_quota($1) AS result",
      [reservationId],
    );
    const response = parseJsonRecord(rows[0]?.result);
    const status = response?.status;
    if (
      status !== "settled" &&
      status !== "already_settled" &&
      status !== "released" &&
      status !== "not_found"
    ) {
      throw new Error("quota_settlement_failed");
    }
    return { status, actualCostUsd: Number(response?.actualCostUsd ?? 0) };
  }

  async releaseLiveReservation(reservationId: string): Promise<boolean> {
    const driver = await this.readyDriver();
    const rows = await driver.query<{ result: unknown }>(
      "SELECT settle_daily_quota($1, 0, true) AS result",
      [reservationId],
    );
    return parseJsonRecord(rows[0]?.result)?.status === "released";
  }

  async snapshot(now: Date): Promise<QuotaSnapshot> {
    const driver = await this.readyDriver();
    await driver.query(
      "SELECT reconcile_stale_daily_quota($1::date, $2::timestamptz)",
      [utcDay(now), now.toISOString()],
    );
    const rows = await driver.query<{
      anonymous_buckets: unknown;
      global_spend_usd: unknown;
      reserved_spend_usd: unknown;
      global_custom_uploads: unknown;
      global_recorded_runs: unknown;
    }>(
      `SELECT
        usage.anonymous_buckets,
        usage.global_spend_usd,
        usage.global_custom_uploads,
        usage.global_recorded_runs,
        COALESCE(SUM(reservation.reserved_cost_usd), 0) AS reserved_spend_usd
      FROM daily_usage AS usage
      LEFT JOIN model_budget_reservations AS reservation
        ON reservation.usage_day = usage.usage_day
          AND reservation.status = 'pending'
          AND reservation.expires_at > $2::timestamptz
      WHERE usage.usage_day = $1::date
      GROUP BY usage.usage_day, usage.anonymous_buckets, usage.global_spend_usd,
        usage.global_custom_uploads, usage.global_recorded_runs`,
      [utcDay(now), now.toISOString()],
    );
    const row = rows[0];
    if (!row) {
      return {
        globalSpendUsd: 0,
        reservedSpendUsd: 0,
        globalCustomUploads: 0,
        globalRecordedRuns: 0,
        customUploadsByBucket: {},
        liveRunsByBucket: {},
        recordedRunsByBucket: {},
      };
    }
    const buckets = (
      typeof row.anonymous_buckets === "string"
        ? JSON.parse(row.anonymous_buckets)
        : row.anonymous_buckets
    ) as Record<
      string,
      { customUploads?: number; liveRuns?: number; recordedRuns?: number }
    >;
    return {
      globalSpendUsd: Number(row.global_spend_usd),
      reservedSpendUsd: Number(row.reserved_spend_usd),
      globalCustomUploads: Number(row.global_custom_uploads),
      globalRecordedRuns: Number(row.global_recorded_runs),
      customUploadsByBucket: Object.fromEntries(
        Object.entries(buckets).map(([bucket, usage]) => [
          bucket,
          usage.customUploads ?? 0,
        ]),
      ),
      liveRunsByBucket: Object.fromEntries(
        Object.entries(buckets).map(([bucket, usage]) => [
          bucket,
          usage.liveRuns ?? 0,
        ]),
      ),
      recordedRunsByBucket: Object.fromEntries(
        Object.entries(buckets).map(([bucket, usage]) => [
          bucket,
          usage.recordedRuns ?? 0,
        ]),
      ),
    };
  }

  private async readyDriver(): Promise<NeonDriver> {
    return this.getDriver();
  }

  private getDriver(): Promise<NeonDriver> {
    if (this.driverPromise) return this.driverPromise;
    if (this.options.driver) {
      this.driverPromise = Promise.resolve(this.options.driver);
      return this.driverPromise;
    }
    if (!this.options.databaseUrl) {
      return Promise.reject(
        new PersistenceConfigurationError("neon_database_not_configured"),
      );
    }
    const databaseUrl = this.options.databaseUrl;
    this.driverPromise = (async () => {
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(databaseUrl);
      return {
        async query<
          T extends Record<string, unknown> = Record<string, unknown>,
        >(query: string, parameters: unknown[] = []) {
          return (await sql.query(query, parameters)) as T[];
        },
      } satisfies NeonDriver;
    })();
    return this.driverPromise;
  }
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  }
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function createNeonQuotaRepository(
  options: NeonQuotaOptions,
): QuotaRepository {
  return new NeonQuotaRepository(options);
}
