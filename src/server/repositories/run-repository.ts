import type { FieldResult, Outcome, Provider, RunStatus } from "@/domain/types";
import { neonSchemaStatements } from "@/server/db/schema";

export type ExecutionMode = "recorded" | "live";
export type SourceType = "synthetic" | "custom";

export type SafeFileMetadata = {
  filename: string;
  mediaType: string;
  sizeBytes: number;
  pageCount: number | null;
};

export type RequestedField = {
  key: string;
  label: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type RunStepRecord = {
  kind: "stage" | "field" | "retry" | "decision" | "purge";
  stage: string;
  timestamp: string;
  durationMs: number | null;
  safeCode?: string;
};

export type StoredRunRecord = {
  id: string;
  provider: Provider;
  model: string;
  promptVersion: string;
  executionMode: ExecutionMode;
  sourceType: SourceType;
  file: SafeFileMetadata;
  documentKey: string | null;
  requestedFields: RequestedField[];
  status: RunStatus;
  outcome: Outcome | null;
  usage: TokenUsage;
  estimatedCostUsd: number;
  consent: boolean;
  createdAt: string;
  expiresAt: string;
  deletedAt: string | null;
  deletionTokenHash: string;
  retryCount: number;
  latencyMs: number | null;
  stepDurations: Record<string, number>;
};

export type SaveRunResultsInput = {
  fields: FieldResult[];
  outcome: Outcome;
  usage: TokenUsage;
  estimatedCostUsd: number;
  retryCount: number;
  latencyMs: number;
  stepDurations: Record<string, number>;
  completedAt: string;
};

export type PublicRunRecord = Omit<StoredRunRecord, "documentKey" | "deletionTokenHash"> & {
  details?: {
    steps: RunStepRecord[];
    result: SaveRunResultsInput;
  };
};

export type AnonymousUsageAggregate = {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  providerCounts: Record<Provider, number>;
  outcomeCounts: Partial<Record<Outcome, number>>;
};

export interface RunRepository {
  createRun(record: StoredRunRecord): Promise<void>;
  setStatus(runId: string, status: RunStatus): Promise<void>;
  appendStep(runId: string, step: RunStepRecord): Promise<void>;
  saveResults(runId: string, result: SaveRunResultsInput): Promise<void>;
  markFailed(runId: string, input: { timestamp: string; safeCode: string }): Promise<void>;
  readPublicRun(runId: string, now: Date): Promise<PublicRunRecord | null>;
  listPublicRuns(now: Date): Promise<PublicRunRecord[]>;
  aggregateAnonymousUsage(): Promise<AnonymousUsageAggregate>;
  getDeletionTokenHash(runId: string): Promise<string | null>;
  deleteDetailedData(
    runId: string,
    deletedAt: string,
    deleteDocument?: (documentKey: string) => Promise<void>,
  ): Promise<boolean>;
  purgeExpiredData(
    now: Date,
    deleteDocument?: (documentKey: string) => Promise<void>,
  ): Promise<{ purgedRunIds: string[]; documentKeys: string[] }>;
}

type InternalRun = {
  record: StoredRunRecord;
  steps: RunStepRecord[];
  result: SaveRunResultsInput | null;
  detailsDeleted: boolean;
  completionAggregated: boolean;
  failureAggregated: boolean;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isExpired(run: InternalRun, now: Date): boolean {
  return Date.parse(run.record.expiresAt) <= now.getTime();
}

export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, InternalRun>();

  private readonly aggregate: AnonymousUsageAggregate = {
    totalRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedCostUsd: 0,
    providerCounts: { openai: 0, anthropic: 0 },
    outcomeCounts: {},
  };

  async createRun(record: StoredRunRecord): Promise<void> {
    if (this.runs.has(record.id)) throw new Error("run_already_exists");
    this.runs.set(record.id, {
      record: clone(record),
      steps: [],
      result: null,
      detailsDeleted: false,
      completionAggregated: false,
      failureAggregated: false,
    });
    this.aggregate.totalRuns += 1;
    this.aggregate.providerCounts[record.provider] += 1;
  }

  async setStatus(runId: string, status: RunStatus): Promise<void> {
    this.requireRun(runId).record.status = status;
  }

  async appendStep(runId: string, step: RunStepRecord): Promise<void> {
    const run = this.requireRun(runId);
    if (run.detailsDeleted) return;
    run.steps.push(clone(step));
  }

  async saveResults(runId: string, result: SaveRunResultsInput): Promise<void> {
    const run = this.requireRun(runId);
    if (run.detailsDeleted) throw new Error("run_details_unavailable");

    run.result = clone(result);
    run.record.status = "completed";
    run.record.outcome = result.outcome;
    run.record.usage = clone(result.usage);
    run.record.estimatedCostUsd = result.estimatedCostUsd;
    run.record.retryCount = result.retryCount;
    run.record.latencyMs = result.latencyMs;
    run.record.stepDurations = clone(result.stepDurations);

    if (!run.completionAggregated) {
      run.completionAggregated = true;
      this.aggregate.completedRuns += 1;
      this.aggregate.totalInputTokens += result.usage.inputTokens;
      this.aggregate.totalOutputTokens += result.usage.outputTokens;
      this.aggregate.estimatedCostUsd += result.estimatedCostUsd;
      this.aggregate.outcomeCounts[result.outcome] =
        (this.aggregate.outcomeCounts[result.outcome] ?? 0) + 1;
    }
  }

  async markFailed(runId: string, input: { timestamp: string; safeCode: string }): Promise<void> {
    const run = this.requireRun(runId);
    run.record.status = "failed";
    if (!run.detailsDeleted) {
      run.steps.push({
        kind: "stage",
        stage: "failed",
        timestamp: input.timestamp,
        durationMs: null,
        safeCode: input.safeCode,
      });
    }
    if (!run.failureAggregated) {
      run.failureAggregated = true;
      this.aggregate.failedRuns += 1;
    }
  }

  async readPublicRun(runId: string, now: Date): Promise<PublicRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    return this.toPublicRun(run, now);
  }

  async listPublicRuns(now: Date): Promise<PublicRunRecord[]> {
    return [...this.runs.values()]
      .sort((a, b) => Date.parse(b.record.createdAt) - Date.parse(a.record.createdAt))
      .map((run) => this.toPublicRun(run, now));
  }

  async aggregateAnonymousUsage(): Promise<AnonymousUsageAggregate> {
    return clone(this.aggregate);
  }

  async getDeletionTokenHash(runId: string): Promise<string | null> {
    const run = this.runs.get(runId);
    if (!run || run.detailsDeleted) return null;
    return run.record.deletionTokenHash;
  }

  async deleteDetailedData(
    runId: string,
    deletedAt: string,
    deleteDocument?: (documentKey: string) => Promise<void>,
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || run.detailsDeleted) return false;
    if (run.record.documentKey && deleteDocument) {
      await deleteDocument(run.record.documentKey);
    }
    run.record.status = "deleted";
    run.record.deletedAt = deletedAt;
    this.clearDetails(run);
    return true;
  }

  async purgeExpiredData(
    now: Date,
    deleteDocument?: (documentKey: string) => Promise<void>,
  ): Promise<{ purgedRunIds: string[]; documentKeys: string[] }> {
    const purgedRunIds: string[] = [];
    const documentKeys: string[] = [];

    for (const run of this.runs.values()) {
      if (run.detailsDeleted || !isExpired(run, now)) continue;
      if (run.record.documentKey && deleteDocument) {
        await deleteDocument(run.record.documentKey);
      }
      purgedRunIds.push(run.record.id);
      if (run.record.documentKey) documentKeys.push(run.record.documentKey);
      run.record.status = "expired";
      this.clearDetails(run);
    }

    return { purgedRunIds, documentKeys };
  }

  private requireRun(runId: string): InternalRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error("run_not_found");
    return run;
  }

  private clearDetails(run: InternalRun): void {
    run.detailsDeleted = true;
    run.steps = [];
    run.result = null;
    run.record.file.filename = "expired-document";
    run.record.requestedFields = [];
    run.record.documentKey = null;
    run.record.deletionTokenHash = "";
  }

  private toPublicRun(run: InternalRun, now: Date): PublicRunRecord {
    const safeRecord = clone(run.record);
    Reflect.deleteProperty(safeRecord, "documentKey");
    Reflect.deleteProperty(safeRecord, "deletionTokenHash");
    const status: RunStatus = isExpired(run, now) && safeRecord.status !== "deleted" ? "expired" : safeRecord.status;
    const publicRun = { ...safeRecord, status } as PublicRunRecord;

    if (status === "expired" || status === "deleted") {
      publicRun.file = { ...publicRun.file, filename: "expired-document" };
      publicRun.requestedFields = [];
    }

    if (!run.detailsDeleted && !isExpired(run, now) && run.result) {
      publicRun.details = {
        steps: clone(run.steps),
        result: clone(run.result),
      };
    }
    return publicRun;
  }
}

export class PersistenceConfigurationError extends Error {
  readonly name = "PersistenceConfigurationError";
}

type DatabaseRow = Record<string, unknown>;

export interface NeonDriver {
  query<T extends DatabaseRow = DatabaseRow>(sql: string, parameters?: unknown[]): Promise<T[]>;
}

type NeonRepositoryOptions = {
  databaseUrl: string | undefined;
  driver?: NeonDriver;
};

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function asJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

class NeonRunRepository implements RunRepository {
  private driverPromise: Promise<NeonDriver> | null = null;
  private schemaPromise: Promise<void> | null = null;

  constructor(private readonly options: NeonRepositoryOptions) {}

  async createRun(record: StoredRunRecord): Promise<void> {
    const driver = await this.readyDriver();
    await driver.query(
      `INSERT INTO runs (
        id, provider, model, execution_mode, source_type, file_metadata, document_key,
        requested_fields, status, outcome, usage, estimated_cost_usd, consent, created_at,
        expires_at, deleted_at, deletion_token_hash, retry_count, latency_ms, step_durations,
        prompt_version
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11::jsonb, $12,
        $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21
      )`,
      [
        record.id,
        record.provider,
        record.model,
        record.executionMode,
        record.sourceType,
        JSON.stringify(record.file),
        record.documentKey,
        JSON.stringify(record.requestedFields),
        record.status,
        record.outcome,
        JSON.stringify(record.usage),
        record.estimatedCostUsd,
        record.consent,
        record.createdAt,
        record.expiresAt,
        record.deletedAt,
        record.deletionTokenHash,
        record.retryCount,
        record.latencyMs,
        JSON.stringify(record.stepDurations),
        record.promptVersion,
      ],
    );
  }

  async setStatus(runId: string, status: RunStatus): Promise<void> {
    const driver = await this.readyDriver();
    await driver.query("UPDATE runs SET status = $2 WHERE id = $1", [runId, status]);
  }

  async appendStep(runId: string, step: RunStepRecord): Promise<void> {
    const driver = await this.readyDriver();
    await driver.query("INSERT INTO run_steps (run_id, step_json) VALUES ($1, $2::jsonb)", [
      runId,
      JSON.stringify(step),
    ]);
  }

  async saveResults(runId: string, result: SaveRunResultsInput): Promise<void> {
    const driver = await this.readyDriver();
    await driver.query(
      `WITH saved AS (
        INSERT INTO run_results (run_id, result_json) VALUES ($1, $2::jsonb)
        ON CONFLICT (run_id) DO UPDATE SET result_json = EXCLUDED.result_json
      )
      UPDATE runs SET status = 'completed', outcome = $3, usage = $4::jsonb,
        estimated_cost_usd = $5, retry_count = $6, latency_ms = $7,
        step_durations = $8::jsonb, was_completed = true
      WHERE id = $1`,
      [
        runId,
        JSON.stringify(result),
        result.outcome,
        JSON.stringify(result.usage),
        result.estimatedCostUsd,
        result.retryCount,
        result.latencyMs,
        JSON.stringify(result.stepDurations),
      ],
    );
  }

  async markFailed(runId: string, input: { timestamp: string; safeCode: string }): Promise<void> {
    const driver = await this.readyDriver();
    const step: RunStepRecord = {
      kind: "stage",
      stage: "failed",
      timestamp: input.timestamp,
      durationMs: null,
      safeCode: input.safeCode,
    };
    await driver.query(
      `WITH saved AS (
        INSERT INTO run_steps (run_id, step_json) VALUES ($1, $2::jsonb)
      )
      UPDATE runs SET status = 'failed', was_failed = true WHERE id = $1`,
      [runId, JSON.stringify(step)],
    );
  }

  async readPublicRun(runId: string, now: Date): Promise<PublicRunRecord | null> {
    const driver = await this.readyDriver();
    const rows = await driver.query("SELECT * FROM runs WHERE id = $1", [runId]);
    if (!rows[0]) return null;
    return this.publicFromRow(driver, rows[0], now);
  }

  async listPublicRuns(now: Date): Promise<PublicRunRecord[]> {
    const driver = await this.readyDriver();
    const rows = await driver.query("SELECT * FROM runs ORDER BY created_at DESC");
    return Promise.all(rows.map((row) => this.publicFromRow(driver, row, now, false)));
  }

  async aggregateAnonymousUsage(): Promise<AnonymousUsageAggregate> {
    const driver = await this.readyDriver();
    const rows = await driver.query(
      "SELECT provider, outcome, usage, estimated_cost_usd, was_completed, was_failed FROM runs",
    );
    const aggregate: AnonymousUsageAggregate = {
      totalRuns: rows.length,
      completedRuns: 0,
      failedRuns: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      providerCounts: { openai: 0, anthropic: 0 },
      outcomeCounts: {},
    };
    for (const row of rows) {
      const provider = row.provider as Provider;
      const usage = asJson<TokenUsage>(row.usage);
      aggregate.providerCounts[provider] += 1;
      aggregate.completedRuns += row.was_completed ? 1 : 0;
      aggregate.failedRuns += row.was_failed ? 1 : 0;
      aggregate.totalInputTokens += usage.inputTokens;
      aggregate.totalOutputTokens += usage.outputTokens;
      aggregate.estimatedCostUsd += Number(row.estimated_cost_usd);
      const outcome = row.outcome as Outcome | null;
      if (outcome) aggregate.outcomeCounts[outcome] = (aggregate.outcomeCounts[outcome] ?? 0) + 1;
    }
    return aggregate;
  }

  async getDeletionTokenHash(runId: string): Promise<string | null> {
    const driver = await this.readyDriver();
    const rows = await driver.query(
      "SELECT deletion_token_hash FROM runs WHERE id = $1 AND details_deleted = false",
      [runId],
    );
    return (rows[0]?.deletion_token_hash as string | null | undefined) ?? null;
  }

  async deleteDetailedData(
    runId: string,
    deletedAt: string,
    deleteDocument?: (documentKey: string) => Promise<void>,
  ): Promise<boolean> {
    const driver = await this.readyDriver();
    const candidates = await driver.query(
      "SELECT document_key FROM runs WHERE id = $1 AND details_deleted = false",
      [runId],
    );
    const documentKey = candidates[0]?.document_key ? String(candidates[0].document_key) : null;
    if (documentKey && deleteDocument) await deleteDocument(documentKey);
    const rows = await driver.query(
      `WITH removed_steps AS (DELETE FROM run_steps WHERE run_id = $1),
        removed_result AS (DELETE FROM run_results WHERE run_id = $1)
      UPDATE runs SET status = 'deleted', deleted_at = $2, document_key = NULL,
        deletion_token_hash = NULL, details_deleted = true,
        file_metadata = jsonb_set(file_metadata, '{filename}', '"expired-document"'::jsonb),
        requested_fields = '[]'::jsonb
      WHERE id = $1 AND details_deleted = false RETURNING id`,
      [runId, deletedAt],
    );
    return rows.length > 0;
  }

  async purgeExpiredData(
    now: Date,
    deleteDocument?: (documentKey: string) => Promise<void>,
  ): Promise<{ purgedRunIds: string[]; documentKeys: string[] }> {
    const driver = await this.readyDriver();
    const candidates = await driver.query(
      "SELECT id, document_key FROM runs WHERE expires_at <= $1 AND details_deleted = false ORDER BY id",
      [now.toISOString()],
    );
    const purgedRunIds: string[] = [];
    const documentKeys: string[] = [];
    for (const candidate of candidates) {
      const runId = String(candidate.id);
      const documentKey = candidate.document_key ? String(candidate.document_key) : null;
      if (documentKey && deleteDocument) await deleteDocument(documentKey);
      const rows = await driver.query(
        `WITH removed_steps AS (DELETE FROM run_steps WHERE run_id = $1),
          removed_result AS (DELETE FROM run_results WHERE run_id = $1)
        UPDATE runs SET status = 'expired', document_key = NULL, deletion_token_hash = NULL,
          details_deleted = true,
          file_metadata = jsonb_set(file_metadata, '{filename}', '"expired-document"'::jsonb),
          requested_fields = '[]'::jsonb
        WHERE id = $1 AND details_deleted = false RETURNING id`,
        [runId],
      );
      if (rows.length === 0) continue;
      purgedRunIds.push(runId);
      if (documentKey) documentKeys.push(documentKey);
    }
    return { purgedRunIds, documentKeys };
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
        async query<T extends DatabaseRow = DatabaseRow>(query: string, parameters: unknown[] = []) {
          return (await sql.query(query, parameters)) as T[];
        },
      } satisfies NeonDriver;
    })();
    return this.driverPromise;
  }

  private async publicFromRow(
    driver: NeonDriver,
    row: DatabaseRow,
    now: Date,
    includeDetails = true,
  ): Promise<PublicRunRecord> {
    const expiresAt = asIso(row.expires_at);
    const expired = Date.parse(expiresAt) <= now.getTime();
    const detailsDeleted = Boolean(row.details_deleted);
    const publicRun: PublicRunRecord = {
      id: String(row.id),
      provider: row.provider as Provider,
      model: String(row.model),
      promptVersion: String(row.prompt_version),
      executionMode: row.execution_mode as ExecutionMode,
      sourceType: row.source_type as SourceType,
      file: asJson<SafeFileMetadata>(row.file_metadata),
      requestedFields: asJson<RequestedField[]>(row.requested_fields),
      status: expired && row.status !== "deleted" ? "expired" : (row.status as RunStatus),
      outcome: (row.outcome as Outcome | null) ?? null,
      usage: asJson<TokenUsage>(row.usage),
      estimatedCostUsd: Number(row.estimated_cost_usd),
      consent: Boolean(row.consent),
      createdAt: asIso(row.created_at),
      expiresAt,
      deletedAt: row.deleted_at ? asIso(row.deleted_at) : null,
      retryCount: Number(row.retry_count),
      latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
      stepDurations: asJson<Record<string, number>>(row.step_durations),
    };
    if (publicRun.status === "expired" || publicRun.status === "deleted") {
      publicRun.file = { ...publicRun.file, filename: "expired-document" };
      publicRun.requestedFields = [];
    }
    if (!includeDetails || expired || detailsDeleted) return publicRun;

    const [stepRows, resultRows] = await Promise.all([
      driver.query("SELECT step_json FROM run_steps WHERE run_id = $1 ORDER BY sequence", [row.id]),
      driver.query("SELECT result_json FROM run_results WHERE run_id = $1", [row.id]),
    ]);
    if (resultRows[0]) {
      publicRun.details = {
        steps: stepRows.map((stepRow) => asJson<RunStepRecord>(stepRow.step_json)),
        result: asJson<SaveRunResultsInput>(resultRows[0].result_json),
      };
    }
    return publicRun;
  }
}

export function createNeonRunRepository(options: NeonRepositoryOptions): RunRepository {
  return new NeonRunRepository(options);
}
