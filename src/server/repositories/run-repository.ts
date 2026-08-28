import type {
  ActionProposal,
  FieldResult,
  Outcome,
  Provider,
  RunStatus,
} from "@/domain/types";
import { actionProposalSchema } from "@/domain/run-schema";

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
  kind: "stage" | "field" | "retry" | "decision" | "action" | "purge";
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
  documentInstruction: string | null;
  action: ActionProposal;
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
    result: SaveRunResultsInput | null;
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

export type MarkRunFailedInput = {
  timestamp: string;
  safeCode: string;
  failedStage: RunStatus;
  retryCount: number;
  latencyMs: number;
  stepDurations: Record<string, number>;
};

export type PublicRunListOptions = {
  limit: number;
  offset: number;
  includeDetails: boolean;
};

export type PurgeExpiredResult = {
  purgedRunIds: string[];
  documentKeys: string[];
  failedRunIds: string[];
};

export type StageActionResult =
  | { status: "staged" | "already_staged"; action: ActionProposal }
  | {
      status:
        | "not_found"
        | "unavailable"
        | "blocked"
        | "expired"
        | "deleted";
    };

export interface RunRepository {
  claimRunRequest(runId: string, expiresAt: string, now: Date): Promise<boolean>;
  releaseRunRequest(runId: string): Promise<void>;
  createRun(record: StoredRunRecord): Promise<void>;
  setStatus(runId: string, status: RunStatus): Promise<void>;
  appendStep(runId: string, step: RunStepRecord): Promise<void>;
  saveResults(runId: string, result: SaveRunResultsInput): Promise<void>;
  stageAction(runId: string, now: Date): Promise<StageActionResult>;
  markFailed(runId: string, input: MarkRunFailedInput): Promise<void>;
  readPublicRun(runId: string, now: Date): Promise<PublicRunRecord | null>;
  listPublicRuns(now: Date, options?: PublicRunListOptions): Promise<PublicRunRecord[]>;
  countCleanupBacklog(now: Date): Promise<number>;
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
  ): Promise<PurgeExpiredResult>;
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
  private readonly runRequestClaims = new Map<string, string>();
  private readonly cleanupJobs = new Map<
    string,
    { runId: string; documentKey: string; attempts: number }
  >();

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

  async claimRunRequest(runId: string, expiresAt: string, now: Date): Promise<boolean> {
    for (const [claimedRunId, claimExpiry] of this.runRequestClaims) {
      if (Date.parse(claimExpiry) <= now.getTime()) {
        this.runRequestClaims.delete(claimedRunId);
      }
    }
    if (this.runRequestClaims.has(runId)) return false;
    this.runRequestClaims.set(runId, expiresAt);
    return true;
  }

  async releaseRunRequest(runId: string): Promise<void> {
    this.runRequestClaims.delete(runId);
  }

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
    if (record.executionMode === "live") {
      this.aggregate.providerCounts[record.provider] += 1;
    }
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

  async stageAction(runId: string, now: Date): Promise<StageActionResult> {
    const run = this.runs.get(runId);
    if (!run) return { status: "not_found" };
    if (run.detailsDeleted || run.record.status === "deleted") {
      return { status: "deleted" };
    }
    if (isExpired(run, now)) return { status: "expired" };
    if (run.record.status !== "completed" || !run.result || !run.result.action) {
      return { status: "unavailable" };
    }
    if (run.result.action.status === "blocked") return { status: "blocked" };
    if (run.result.action.stagedAt !== null) {
      return { status: "already_staged", action: clone(run.result.action) };
    }
    const timestamp = now.toISOString();
    run.result.action.stagedAt = timestamp;
    run.steps.push({
      kind: "action",
      stage: "action_staged",
      timestamp,
      durationMs: null,
    });
    return { status: "staged", action: clone(run.result.action) };
  }

  async markFailed(runId: string, input: MarkRunFailedInput): Promise<void> {
    const run = this.requireRun(runId);
    run.record.status = "failed";
    run.record.retryCount = input.retryCount;
    run.record.latencyMs = input.latencyMs;
    run.record.stepDurations = clone(input.stepDurations);
    if (!run.detailsDeleted) {
      run.steps.push({
        kind: "stage",
        stage: input.failedStage,
        timestamp: input.timestamp,
        durationMs: input.stepDurations[input.failedStage] ?? null,
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

  async listPublicRuns(
    now: Date,
    options?: PublicRunListOptions,
  ): Promise<PublicRunRecord[]> {
    const sorted = [...this.runs.values()]
      .sort((a, b) => Date.parse(b.record.createdAt) - Date.parse(a.record.createdAt))
      .slice(options?.offset ?? 0, options ? options.offset + options.limit : undefined);
    return sorted.map((run) =>
      this.toPublicRun(run, now, options?.includeDetails ?? true),
    );
  }

  async countCleanupBacklog(now: Date): Promise<number> {
    const expiredDetails = [...this.runs.values()].filter(
      (run) => !run.detailsDeleted && isExpired(run, now),
    ).length;
    return expiredDetails + this.cleanupJobs.size;
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
    const documentKey = run.record.documentKey;
    run.record.status = "deleted";
    run.record.deletedAt = deletedAt;
    this.clearDetails(run);
    if (documentKey) {
      this.cleanupJobs.set(runId, { runId, documentKey, attempts: 0 });
      await this.retryCleanupJob(runId, deleteDocument);
    }
    return true;
  }

  async purgeExpiredData(
    now: Date,
    deleteDocument?: (documentKey: string) => Promise<void>,
  ): Promise<PurgeExpiredResult> {
    const purgedRunIds: string[] = [];
    const documentKeys: string[] = [];
    const failedRunIds: string[] = [];

    for (const run of this.runs.values()) {
      if (run.detailsDeleted || !isExpired(run, now)) continue;
      const documentKey = run.record.documentKey;
      purgedRunIds.push(run.record.id);
      run.record.status = "expired";
      this.clearDetails(run);
      if (documentKey) {
        this.cleanupJobs.set(run.record.id, {
          runId: run.record.id,
          documentKey,
          attempts: 0,
        });
      }
    }

    for (const job of [...this.cleanupJobs.values()]) {
      const succeeded = await this.retryCleanupJob(job.runId, deleteDocument);
      if (succeeded) documentKeys.push(job.documentKey);
      else failedRunIds.push(job.runId);
    }

    return { purgedRunIds, documentKeys, failedRunIds };
  }

  private async retryCleanupJob(
    runId: string,
    deleteDocument?: (documentKey: string) => Promise<void>,
  ): Promise<boolean> {
    const job = this.cleanupJobs.get(runId);
    if (!job) return true;
    try {
      if (deleteDocument) await deleteDocument(job.documentKey);
      this.cleanupJobs.delete(runId);
      return true;
    } catch {
      job.attempts += 1;
      return false;
    }
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

  private toPublicRun(
    run: InternalRun,
    now: Date,
    includeDetails = true,
  ): PublicRunRecord {
    const safeRecord = clone(run.record);
    Reflect.deleteProperty(safeRecord, "documentKey");
    Reflect.deleteProperty(safeRecord, "deletionTokenHash");
    const status: RunStatus = isExpired(run, now) && safeRecord.status !== "deleted" ? "expired" : safeRecord.status;
    const publicRun = { ...safeRecord, status } as PublicRunRecord;

    if (status === "expired" || status === "deleted") {
      publicRun.file = { ...publicRun.file, filename: "expired-document" };
      publicRun.requestedFields = [];
    }

    if (includeDetails && !run.detailsDeleted && !isExpired(run, now)) {
      publicRun.details = {
        steps: clone(run.steps),
        result: run.result ? clone(run.result) : null,
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

  constructor(private readonly options: NeonRepositoryOptions) {}

  async claimRunRequest(runId: string, expiresAt: string, now: Date): Promise<boolean> {
    const driver = await this.readyDriver();
    const rows = await driver.query(
      `WITH cleared AS (
        DELETE FROM run_submission_claims WHERE expires_at <= $3
      )
      INSERT INTO run_submission_claims (run_id, claimed_at, expires_at)
      VALUES ($1, $3, $2)
      ON CONFLICT (run_id) DO NOTHING
      RETURNING run_id`,
      [runId, expiresAt, now.toISOString()],
    );
    return rows.length > 0;
  }

  async releaseRunRequest(runId: string): Promise<void> {
    const driver = await this.readyDriver();
    await driver.query("DELETE FROM run_submission_claims WHERE run_id = $1", [runId]);
  }

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
    await driver.query(
      "UPDATE runs SET status = $2 WHERE id = $1 AND details_deleted = false",
      [runId, status],
    );
  }

  async appendStep(runId: string, step: RunStepRecord): Promise<void> {
    const driver = await this.readyDriver();
    await driver.query(
      `WITH active_run AS (
        SELECT id FROM runs
        WHERE id = $1 AND details_deleted = false FOR UPDATE
      )
      INSERT INTO run_steps (run_id, step_json)
      SELECT id, $2::jsonb FROM active_run`,
      [runId, JSON.stringify(step)],
    );
  }

  async saveResults(runId: string, result: SaveRunResultsInput): Promise<void> {
    const driver = await this.readyDriver();
    await driver.query(
      `WITH active_run AS (
        SELECT id FROM runs
        WHERE id = $1 AND details_deleted = false FOR UPDATE
      ), saved AS (
        INSERT INTO run_results (run_id, result_json)
        SELECT id, $2::jsonb FROM active_run
        ON CONFLICT (run_id) DO UPDATE SET result_json = EXCLUDED.result_json
        RETURNING run_id
      )
      UPDATE runs SET status = 'completed', outcome = $3, usage = $4::jsonb,
        estimated_cost_usd = $5, retry_count = $6, latency_ms = $7,
        step_durations = $8::jsonb, was_completed = true
      FROM saved WHERE runs.id = saved.run_id`,
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

  async stageAction(runId: string, now: Date): Promise<StageActionResult> {
    const driver = await this.readyDriver();
    const timestamp = now.toISOString();
    const step: RunStepRecord = {
      kind: "action",
      stage: "action_staged",
      timestamp,
      durationMs: null,
    };
    const rows = await driver.query<{
      decision: unknown;
      result_json: unknown;
    }>(
      `WITH locked_run AS (
        SELECT id, status, expires_at, details_deleted
        FROM runs
        WHERE id = $1
        FOR UPDATE
      ), target AS (
        SELECT runs.id, runs.status, runs.expires_at, runs.details_deleted,
          result.result_json
        FROM locked_run AS runs
        LEFT JOIN LATERAL (
          SELECT result_json
          FROM run_results AS locked_result
          WHERE locked_result.run_id = runs.id
          FOR UPDATE OF locked_result
        ) AS result ON true
      ), classified AS (
        SELECT *, CASE
          WHEN details_deleted OR status = 'deleted' THEN 'deleted'
          WHEN expires_at <= $2::timestamptz THEN 'expired'
          WHEN status <> 'completed' OR result_json IS NULL THEN 'unavailable'
          WHEN result_json -> 'action' IS NULL THEN 'unavailable'
          WHEN result_json #>> '{action,status}' = 'blocked' THEN 'blocked'
          WHEN result_json #>> '{action,stagedAt}' IS NOT NULL THEN 'already_staged'
          ELSE 'staged'
        END AS decision
        FROM target
      ), updated AS (
        UPDATE run_results AS result
        SET result_json = jsonb_set(
          result.result_json,
          '{action,stagedAt}',
          to_jsonb($2::text),
          false
        )
        FROM classified
        WHERE result.run_id = classified.id AND classified.decision = 'staged'
        RETURNING result.run_id, result.result_json
      ), inserted AS (
        INSERT INTO run_steps (run_id, step_json)
        SELECT run_id, $3::jsonb FROM updated
        RETURNING run_id
      )
      SELECT classified.decision,
        COALESCE(updated.result_json, classified.result_json) AS result_json
      FROM classified
      LEFT JOIN updated ON updated.run_id = classified.id`,
      [runId, timestamp, JSON.stringify(step)],
    );
    const row = rows[0];
    if (!row) return { status: "not_found" };
    const decision = String(row.decision) as StageActionResult["status"];
    if (decision === "staged" || decision === "already_staged") {
      const result = asJson<SaveRunResultsInput>(row.result_json);
      return {
        status: decision,
        action: actionProposalSchema.parse(result.action),
      };
    }
    if (
      decision === "unavailable" ||
      decision === "blocked" ||
      decision === "expired" ||
      decision === "deleted"
    ) {
      return { status: decision };
    }
    throw new Error("stage_action_decision_failed");
  }

  async markFailed(runId: string, input: MarkRunFailedInput): Promise<void> {
    const driver = await this.readyDriver();
    const step: RunStepRecord = {
      kind: "stage",
      stage: input.failedStage,
      timestamp: input.timestamp,
      durationMs: input.stepDurations[input.failedStage] ?? null,
      safeCode: input.safeCode,
    };
    await driver.query(
      `WITH active_run AS (
        SELECT id FROM runs
        WHERE id = $1 AND details_deleted = false FOR UPDATE
      ), saved AS (
        INSERT INTO run_steps (run_id, step_json)
        SELECT id, $2::jsonb FROM active_run
        RETURNING run_id
      )
      UPDATE runs SET status = 'failed', retry_count = $3, latency_ms = $4,
        step_durations = $5::jsonb, was_failed = true
      FROM saved WHERE runs.id = saved.run_id`,
      [
        runId,
        JSON.stringify(step),
        input.retryCount,
        input.latencyMs,
        JSON.stringify(input.stepDurations),
      ],
    );
  }

  async readPublicRun(runId: string, now: Date): Promise<PublicRunRecord | null> {
    const driver = await this.readyDriver();
    const rows = await driver.query("SELECT * FROM runs WHERE id = $1", [runId]);
    if (!rows[0]) return null;
    return this.publicFromRow(driver, rows[0], now);
  }

  async listPublicRuns(
    now: Date,
    options?: PublicRunListOptions,
  ): Promise<PublicRunRecord[]> {
    const driver = await this.readyDriver();
    const publicColumns = `id, provider, model, prompt_version, execution_mode,
      source_type, file_metadata, requested_fields, status, outcome, usage,
      estimated_cost_usd, consent, created_at, expires_at, deleted_at,
      retry_count, latency_ms, step_durations, details_deleted`;
    const rows = options
      ? await driver.query(
          `SELECT ${publicColumns} FROM runs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          [options.limit, options.offset],
        )
      : await driver.query(`SELECT ${publicColumns} FROM runs ORDER BY created_at DESC`);
    return Promise.all(
      rows.map((row) =>
        this.publicFromRow(driver, row, now, options?.includeDetails ?? true),
      ),
    );
  }

  async countCleanupBacklog(now: Date): Promise<number> {
    const driver = await this.readyDriver();
    const rows = await driver.query(
      `SELECT (
        (SELECT COUNT(*) FROM runs WHERE expires_at <= $1 AND details_deleted = false) +
        (SELECT COUNT(*) FROM document_cleanup_jobs)
      ) AS backlog_count`,
      [now.toISOString()],
    );
    return Number(rows[0]?.backlog_count ?? 0);
  }

  async aggregateAnonymousUsage(): Promise<AnonymousUsageAggregate> {
    const driver = await this.readyDriver();
    const rows = await driver.query(
      `SELECT
        COUNT(*) AS total_runs,
        COUNT(*) FILTER (WHERE was_completed) AS completed_runs,
        COUNT(*) FILTER (WHERE was_failed) AS failed_runs,
        COALESCE(SUM((usage ->> 'inputTokens')::bigint), 0) AS input_tokens,
        COALESCE(SUM((usage ->> 'outputTokens')::bigint), 0) AS output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
        COUNT(*) FILTER (WHERE execution_mode = 'live' AND provider = 'openai') AS openai_runs,
        COUNT(*) FILTER (WHERE execution_mode = 'live' AND provider = 'anthropic') AS anthropic_runs,
        COUNT(*) FILTER (WHERE outcome = 'clear') AS clear_runs,
        COUNT(*) FILTER (WHERE outcome = 'needs_review') AS needs_review_runs,
        COUNT(*) FILTER (WHERE outcome = 'incomplete') AS incomplete_runs,
        COUNT(*) FILTER (WHERE outcome = 'evidence_consistent') AS evidence_consistent_runs,
        COUNT(*) FILTER (WHERE outcome = 'conflict') AS conflict_runs,
        COUNT(*) FILTER (WHERE outcome = 'not_found') AS not_found_runs
      FROM runs`,
    );
    const row = rows[0] ?? {};
    const outcomeCounts: Partial<Record<Outcome, number>> = {};
    const outcomeColumns: Array<[Outcome, string]> = [
      ["clear", "clear_runs"],
      ["needs_review", "needs_review_runs"],
      ["incomplete", "incomplete_runs"],
      ["evidence_consistent", "evidence_consistent_runs"],
      ["conflict", "conflict_runs"],
      ["not_found", "not_found_runs"],
    ];
    for (const [outcome, column] of outcomeColumns) {
      const count = Number(row[column] ?? 0);
      if (count > 0) outcomeCounts[outcome] = count;
    }
    const aggregate: AnonymousUsageAggregate = {
      totalRuns: Number(row.total_runs ?? 0),
      completedRuns: Number(row.completed_runs ?? 0),
      failedRuns: Number(row.failed_runs ?? 0),
      totalInputTokens: Number(row.input_tokens ?? 0),
      totalOutputTokens: Number(row.output_tokens ?? 0),
      estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
      providerCounts: {
        openai: Number(row.openai_runs ?? 0),
        anthropic: Number(row.anthropic_runs ?? 0),
      },
      outcomeCounts,
    };
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
    const documentKey = await this.tombstoneRun(
      driver,
      runId,
      "deleted",
      deletedAt,
    );
    if (documentKey === undefined) return false;
    if (documentKey) {
      await this.retryCleanupJob(driver, runId, documentKey, deletedAt, deleteDocument);
    }
    return true;
  }

  async purgeExpiredData(
    now: Date,
    deleteDocument?: (documentKey: string) => Promise<void>,
  ): Promise<PurgeExpiredResult> {
    const driver = await this.readyDriver();
    const candidates = await driver.query(
      "SELECT id FROM runs WHERE expires_at <= $1 AND details_deleted = false ORDER BY id",
      [now.toISOString()],
    );
    const purgedRunIds: string[] = [];
    const documentKeys: string[] = [];
    const failedRunIds: string[] = [];
    for (const candidate of candidates) {
      const runId = String(candidate.id);
      try {
        const tombstoned = await this.tombstoneRun(
          driver,
          runId,
          "expired",
          now.toISOString(),
        );
        if (tombstoned !== undefined) purgedRunIds.push(runId);
      } catch {
        failedRunIds.push(runId);
      }
    }

    const cleanupJobs = await driver.query(
      `SELECT run_id, document_key FROM document_cleanup_jobs
      WHERE next_attempt_at <= $1 ORDER BY next_attempt_at, run_id LIMIT 100`,
      [now.toISOString()],
    );
    for (const job of cleanupJobs) {
      const runId = String(job.run_id);
      const documentKey = String(job.document_key);
      const succeeded = await this.retryCleanupJob(
        driver,
        runId,
        documentKey,
        now.toISOString(),
        deleteDocument,
      );
      if (succeeded) documentKeys.push(documentKey);
      else if (!failedRunIds.includes(runId)) failedRunIds.push(runId);
    }
    return { purgedRunIds, documentKeys, failedRunIds };
  }

  private async tombstoneRun(
    driver: NeonDriver,
    runId: string,
    status: "deleted" | "expired",
    timestamp: string,
  ): Promise<string | null | undefined> {
    const rows = await driver.query(
      `WITH target AS (
        SELECT id, document_key FROM runs
        WHERE id = $1 AND details_deleted = false FOR UPDATE
      ), cleanup AS (
        INSERT INTO document_cleanup_jobs (
          run_id, document_key, created_at, next_attempt_at
        )
        SELECT id, document_key, $3::timestamptz, $3::timestamptz
        FROM target WHERE document_key IS NOT NULL
        ON CONFLICT (run_id) DO UPDATE SET
          document_key = EXCLUDED.document_key,
          next_attempt_at = LEAST(
            document_cleanup_jobs.next_attempt_at,
            EXCLUDED.next_attempt_at
          )
        RETURNING run_id
      ), removed_steps AS (
        DELETE FROM run_steps WHERE run_id = $1
      ), removed_result AS (
        DELETE FROM run_results WHERE run_id = $1
      ), tombstoned AS (
        UPDATE runs SET status = $2,
          deleted_at = CASE WHEN $2 = 'deleted' THEN $3::timestamptz ELSE deleted_at END,
          document_key = NULL, deletion_token_hash = NULL, details_deleted = true,
          file_metadata = jsonb_set(file_metadata, '{filename}', '"expired-document"'::jsonb),
          requested_fields = '[]'::jsonb
        FROM target WHERE runs.id = target.id
        RETURNING runs.id, target.document_key
      )
      SELECT id, document_key AS cleanup_document_key FROM tombstoned`,
      [runId, status, timestamp],
    );
    if (!rows[0]) return undefined;
    return rows[0].cleanup_document_key
      ? String(rows[0].cleanup_document_key)
      : null;
  }

  private async retryCleanupJob(
    driver: NeonDriver,
    runId: string,
    documentKey: string,
    attemptedAt: string,
    deleteDocument?: (documentKey: string) => Promise<void>,
  ): Promise<boolean> {
    try {
      if (deleteDocument) await deleteDocument(documentKey);
      await driver.query("DELETE FROM document_cleanup_jobs WHERE run_id = $1", [runId]);
      return true;
    } catch {
      await driver.query(
        `UPDATE document_cleanup_jobs SET
          attempt_count = attempt_count + 1,
          last_attempt_at = $2::timestamptz,
          next_attempt_at = $2::timestamptz + interval '5 minutes'
        WHERE run_id = $1`,
        [runId, attemptedAt],
      );
      return false;
    }
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
    publicRun.details = {
      steps: stepRows.map((stepRow) => asJson<RunStepRecord>(stepRow.step_json)),
      result: resultRows[0] ? asJson<SaveRunResultsInput>(resultRows[0].result_json) : null,
    };
    return publicRun;
  }
}

export function createNeonRunRepository(options: NeonRepositoryOptions): RunRepository {
  return new NeonRunRepository(options);
}
