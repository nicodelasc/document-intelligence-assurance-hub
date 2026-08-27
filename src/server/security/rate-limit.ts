import type { ExecutionMode, SourceType } from "@/server/repositories/run-repository";
import {
  PersistenceConfigurationError,
  type NeonDriver,
} from "@/server/repositories/run-repository";
import { neonSchemaStatements } from "@/server/db/schema";
import { randomUUID } from "node:crypto";

export const DEFAULT_DAILY_MODEL_BUDGET_USD = 3;
export const DEFAULT_LIVE_RUN_RESERVATION_USD = 1;
export const MAX_CUSTOM_UPLOADS_PER_DAY = 3;
export const MAX_LIVE_RUNS_PER_DAY = 6;

export type QuotaDenialReason =
  | "custom_upload_limit"
  | "live_run_limit"
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
  globalSpendUsd: number;
};

type LiveReservation = {
  id: string;
  day: string;
  reservedCostUsd: number;
  actualCostUsd: number;
  status: "pending" | "settled" | "released";
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
  settleLiveReservation(reservationId: string, actualCostUsd: number): Promise<QuotaSettlement>;
  releaseLiveReservation(reservationId: string): Promise<boolean>;
  snapshot(now: Date): Promise<{
    globalSpendUsd: number;
    reservedSpendUsd: number;
    customUploadsByBucket: Record<string, number>;
    liveRunsByBucket: Record<string, number>;
  }>;
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export class InMemoryQuotaRepository implements QuotaRepository {
  private readonly days = new Map<string, DailyUsage>();
  private readonly reservations = new Map<string, LiveReservation>();
  private lockTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly dailyBudgetUsd = DEFAULT_DAILY_MODEL_BUDGET_USD,
    private readonly idSource: () => string = randomUUID,
    private readonly liveRunReservationUsd = DEFAULT_LIVE_RUN_RESERVATION_USD,
  ) {}

  async reserve(input: QuotaReservation): Promise<QuotaDecision> {
    return this.withLock(() => {
      const usage = this.day(input.now);
      const customUploads = usage.customUploadsByBucket.get(input.bucket) ?? 0;
      const liveRuns = usage.liveRunsByBucket.get(input.bucket) ?? 0;

      if (input.sourceType === "custom" && customUploads >= MAX_CUSTOM_UPLOADS_PER_DAY) {
        return { allowed: false, reason: "custom_upload_limit", replayAvailable: true };
      }

      if (input.executionMode === "live" && !input.liveEnabled) {
        return { allowed: false, reason: "live_disabled", replayAvailable: true };
      }

      if (input.executionMode === "live" && liveRuns >= MAX_LIVE_RUNS_PER_DAY) {
        return { allowed: false, reason: "live_run_limit", replayAvailable: true };
      }

      if (input.executionMode === "live") {
        const day = utcDay(input.now);
        const remainingBudget =
          this.dailyBudgetUsd - usage.globalSpendUsd - this.pendingSpendUsd(day);
        const callerEstimate = Number.isFinite(input.estimatedCostUsd)
          ? Math.max(0, input.estimatedCostUsd)
          : this.dailyBudgetUsd + this.liveRunReservationUsd;
        const reservationCostUsd = Math.max(this.liveRunReservationUsd, callerEstimate);
        if (remainingBudget < reservationCostUsd) {
          return { allowed: false, reason: "daily_budget", replayAvailable: true };
        }
        const reservationId = this.idSource();
        this.reservations.set(reservationId, {
          id: reservationId,
          day,
          reservedCostUsd: reservationCostUsd,
          actualCostUsd: 0,
          status: "pending",
        });
        if (input.sourceType === "custom") {
          usage.customUploadsByBucket.set(input.bucket, customUploads + 1);
        }
        usage.liveRunsByBucket.set(input.bucket, liveRuns + 1);
        return { allowed: true, reservationId, reservedCostUsd: reservationCostUsd };
      }
      if (input.sourceType === "custom") {
        usage.customUploadsByBucket.set(input.bucket, customUploads + 1);
      }
      return { allowed: true, reservationId: null, reservedCostUsd: 0 };
    });
  }

  async settleLiveReservation(reservationId: string, actualCostUsd: number): Promise<QuotaSettlement> {
    return this.withLock(() => {
      const reservation = this.reservations.get(reservationId);
      if (!reservation) return { status: "not_found", actualCostUsd: 0 };
      if (reservation.status === "released") return { status: "released", actualCostUsd: 0 };
      if (reservation.status === "settled") {
        return { status: "already_settled", actualCostUsd: reservation.actualCostUsd };
      }
      const actual = Math.max(0, actualCostUsd);
      reservation.status = "settled";
      reservation.actualCostUsd = actual;
      this.days.get(reservation.day)!.globalSpendUsd += actual;
      return {
        status:
          actual > reservation.reservedCostUsd ? "reservation_exceeded" : "settled",
        actualCostUsd: actual,
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

  async snapshot(now: Date): Promise<{
    globalSpendUsd: number;
    reservedSpendUsd: number;
    customUploadsByBucket: Record<string, number>;
    liveRunsByBucket: Record<string, number>;
  }> {
    return this.withLock(() => {
      const usage = this.day(now);
      return {
        globalSpendUsd: usage.globalSpendUsd,
        reservedSpendUsd: this.pendingSpendUsd(utcDay(now)),
        customUploadsByBucket: Object.fromEntries(usage.customUploadsByBucket),
        liveRunsByBucket: Object.fromEntries(usage.liveRunsByBucket),
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
  idSource?: () => string;
};

class NeonQuotaRepository implements QuotaRepository {
  private driverPromise: Promise<NeonDriver> | null = null;
  private schemaPromise: Promise<void> | null = null;

  constructor(private readonly options: NeonQuotaOptions) {}

  async reserve(input: QuotaReservation): Promise<QuotaDecision> {
    const driver = await this.readyDriver();
    const reservationId = this.options.idSource?.() ?? randomUUID();
    const rows = await driver.query<{ decision: unknown }>(
      `SELECT reserve_daily_quota(
        $1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) AS decision`,
      [
        utcDay(input.now),
        input.bucket,
        input.sourceType === "custom",
        input.executionMode === "live",
        input.liveEnabled,
        MAX_CUSTOM_UPLOADS_PER_DAY,
        MAX_LIVE_RUNS_PER_DAY,
        this.options.dailyBudgetUsd ?? DEFAULT_DAILY_MODEL_BUDGET_USD,
        reservationId,
        Math.max(
          this.options.liveRunReservationUsd ?? DEFAULT_LIVE_RUN_RESERVATION_USD,
          Number.isFinite(input.estimatedCostUsd)
            ? Math.max(0, input.estimatedCostUsd)
            : (this.options.dailyBudgetUsd ?? DEFAULT_DAILY_MODEL_BUDGET_USD) +
                (this.options.liveRunReservationUsd ?? DEFAULT_LIVE_RUN_RESERVATION_USD),
        ),
      ],
    );
    const response = parseJsonRecord(rows[0]?.decision);
    const decision = response?.decision;
    if (decision === "allowed") {
      return {
        allowed: true,
        reservationId:
          typeof response?.reservationId === "string" ? response.reservationId : null,
        reservedCostUsd: Number(response?.reservedCostUsd ?? 0),
      };
    }
    if (
      decision === "custom_upload_limit" ||
      decision === "live_run_limit" ||
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
    const driver = await this.readyDriver();
    const rows = await driver.query<{ result: unknown }>(
      "SELECT settle_daily_quota($1, $2, false) AS result",
      [reservationId, Math.max(0, actualCostUsd)],
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

  async releaseLiveReservation(reservationId: string): Promise<boolean> {
    const driver = await this.readyDriver();
    const rows = await driver.query<{ result: unknown }>(
      "SELECT settle_daily_quota($1, 0, true) AS result",
      [reservationId],
    );
    return parseJsonRecord(rows[0]?.result)?.status === "released";
  }

  async snapshot(now: Date): Promise<{
    globalSpendUsd: number;
    reservedSpendUsd: number;
    customUploadsByBucket: Record<string, number>;
    liveRunsByBucket: Record<string, number>;
  }> {
    const driver = await this.readyDriver();
    const rows = await driver.query<{
      anonymous_buckets: unknown;
      global_spend_usd: unknown;
      reserved_spend_usd: unknown;
    }>(
      `SELECT
        usage.anonymous_buckets,
        usage.global_spend_usd,
        COALESCE(SUM(reservation.reserved_cost_usd), 0) AS reserved_spend_usd
      FROM daily_usage AS usage
      LEFT JOIN model_budget_reservations AS reservation
        ON reservation.usage_day = usage.usage_day AND reservation.status = 'pending'
      WHERE usage.usage_day = $1::date
      GROUP BY usage.usage_day, usage.anonymous_buckets, usage.global_spend_usd`,
      [utcDay(now)],
    );
    const row = rows[0];
    if (!row) {
      return {
        globalSpendUsd: 0,
        reservedSpendUsd: 0,
        customUploadsByBucket: {},
        liveRunsByBucket: {},
      };
    }
    const buckets = (typeof row.anonymous_buckets === "string"
      ? JSON.parse(row.anonymous_buckets)
      : row.anonymous_buckets) as Record<string, { customUploads?: number; liveRuns?: number }>;
    return {
      globalSpendUsd: Number(row.global_spend_usd),
      reservedSpendUsd: Number(row.reserved_spend_usd),
      customUploadsByBucket: Object.fromEntries(
        Object.entries(buckets).map(([bucket, usage]) => [bucket, usage.customUploads ?? 0]),
      ),
      liveRunsByBucket: Object.fromEntries(
        Object.entries(buckets).map(([bucket, usage]) => [bucket, usage.liveRuns ?? 0]),
      ),
    };
  }

  private async readyDriver(): Promise<NeonDriver> {
    const driver = await this.getDriver();
    if (!this.schemaPromise) {
      this.schemaPromise = (async () => {
        for (const statement of neonSchemaStatements) await driver.query(statement);
      })();
    }
    await this.schemaPromise;
    return driver;
  }

  private getDriver(): Promise<NeonDriver> {
    if (this.driverPromise) return this.driverPromise;
    if (this.options.driver) {
      this.driverPromise = Promise.resolve(this.options.driver);
      return this.driverPromise;
    }
    if (!this.options.databaseUrl) {
      return Promise.reject(new PersistenceConfigurationError("neon_database_not_configured"));
    }
    const databaseUrl = this.options.databaseUrl;
    this.driverPromise = (async () => {
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(databaseUrl);
      return {
        async query<T extends Record<string, unknown> = Record<string, unknown>>(
          query: string,
          parameters: unknown[] = [],
        ) {
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

export function createNeonQuotaRepository(options: NeonQuotaOptions): QuotaRepository {
  return new NeonQuotaRepository(options);
}
