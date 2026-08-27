import type { ExecutionMode, SourceType } from "@/server/repositories/run-repository";
import {
  PersistenceConfigurationError,
  type NeonDriver,
} from "@/server/repositories/run-repository";
import { neonSchemaStatements } from "@/server/db/schema";

export const DEFAULT_DAILY_MODEL_BUDGET_USD = 3;
export const MAX_CUSTOM_UPLOADS_PER_DAY = 3;
export const MAX_LIVE_RUNS_PER_DAY = 6;

export type QuotaDenialReason =
  | "custom_upload_limit"
  | "live_run_limit"
  | "daily_budget"
  | "live_disabled";

export type QuotaDecision =
  | { allowed: true }
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

export interface QuotaRepository {
  reserve(input: QuotaReservation): Promise<QuotaDecision>;
  snapshot(now: Date): Promise<{
    globalSpendUsd: number;
    customUploadsByBucket: Record<string, number>;
    liveRunsByBucket: Record<string, number>;
  }>;
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export class InMemoryQuotaRepository implements QuotaRepository {
  private readonly days = new Map<string, DailyUsage>();
  private lockTail: Promise<void> = Promise.resolve();

  constructor(private readonly dailyBudgetUsd = DEFAULT_DAILY_MODEL_BUDGET_USD) {}

  async reserve(input: QuotaReservation): Promise<QuotaDecision> {
    return this.withLock(() => {
      const usage = this.day(input.now);
      const customUploads = usage.customUploadsByBucket.get(input.bucket) ?? 0;
      const liveRuns = usage.liveRunsByBucket.get(input.bucket) ?? 0;
      const estimatedCostUsd = Math.max(0, input.estimatedCostUsd);

      if (input.sourceType === "custom" && customUploads >= MAX_CUSTOM_UPLOADS_PER_DAY) {
        return { allowed: false, reason: "custom_upload_limit", replayAvailable: true };
      }

      if (input.executionMode === "live" && !input.liveEnabled) {
        return { allowed: false, reason: "live_disabled", replayAvailable: true };
      }

      if (input.executionMode === "live" && liveRuns >= MAX_LIVE_RUNS_PER_DAY) {
        return { allowed: false, reason: "live_run_limit", replayAvailable: true };
      }

      if (
        input.executionMode === "live" &&
        usage.globalSpendUsd + estimatedCostUsd > this.dailyBudgetUsd
      ) {
        return { allowed: false, reason: "daily_budget", replayAvailable: true };
      }

      if (input.sourceType === "custom") {
        usage.customUploadsByBucket.set(input.bucket, customUploads + 1);
      }
      if (input.executionMode === "live") {
        usage.liveRunsByBucket.set(input.bucket, liveRuns + 1);
        usage.globalSpendUsd += estimatedCostUsd;
      }
      return { allowed: true };
    });
  }

  async snapshot(now: Date): Promise<{
    globalSpendUsd: number;
    customUploadsByBucket: Record<string, number>;
    liveRunsByBucket: Record<string, number>;
  }> {
    return this.withLock(() => {
      const usage = this.day(now);
      return {
        globalSpendUsd: usage.globalSpendUsd,
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
};

class NeonQuotaRepository implements QuotaRepository {
  private driverPromise: Promise<NeonDriver> | null = null;
  private schemaPromise: Promise<void> | null = null;

  constructor(private readonly options: NeonQuotaOptions) {}

  async reserve(input: QuotaReservation): Promise<QuotaDecision> {
    const driver = await this.readyDriver();
    const rows = await driver.query<{ decision: string }>(
      `SELECT reserve_daily_quota(
        $1::date, $2, $3, $4, $5, $6, $7, $8, $9
      ) AS decision`,
      [
        utcDay(input.now),
        input.bucket,
        input.sourceType === "custom",
        input.executionMode === "live",
        Math.max(0, input.estimatedCostUsd),
        input.liveEnabled,
        MAX_CUSTOM_UPLOADS_PER_DAY,
        MAX_LIVE_RUNS_PER_DAY,
        this.options.dailyBudgetUsd ?? DEFAULT_DAILY_MODEL_BUDGET_USD,
      ],
    );
    const decision = rows[0]?.decision;
    if (decision === "allowed") return { allowed: true };
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

  async snapshot(now: Date): Promise<{
    globalSpendUsd: number;
    customUploadsByBucket: Record<string, number>;
    liveRunsByBucket: Record<string, number>;
  }> {
    const driver = await this.readyDriver();
    const rows = await driver.query<{ anonymous_buckets: unknown; global_spend_usd: unknown }>(
      "SELECT anonymous_buckets, global_spend_usd FROM daily_usage WHERE usage_day = $1::date",
      [utcDay(now)],
    );
    const row = rows[0];
    if (!row) return { globalSpendUsd: 0, customUploadsByBucket: {}, liveRunsByBucket: {} };
    const buckets = (typeof row.anonymous_buckets === "string"
      ? JSON.parse(row.anonymous_buckets)
      : row.anonymous_buckets) as Record<string, { customUploads?: number; liveRuns?: number }>;
    return {
      globalSpendUsd: Number(row.global_spend_usd),
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

export function createNeonQuotaRepository(options: NeonQuotaOptions): QuotaRepository {
  return new NeonQuotaRepository(options);
}
