import type {
  ActionProposal,
  DocumentFamily,
  FieldResult,
  Outcome,
  Provider,
  RunStatus,
  WorkflowActionType,
  WorkflowEvent,
  WorkflowEventStatus,
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
  providerDispatched: boolean;
  sourceType: SourceType;
  documentFamily: DocumentFamily | null;
  fixtureId: string | null;
  file: SafeFileMetadata;
  documentKey: string | null;
  requestedFields: RequestedField[];
  status: RunStatus;
  outcome: Outcome | null;
  usage: TokenUsage;
  estimatedCostUsd: number;
  consent: boolean;
  createdAt: string;
  completedAt: string | null;
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
    workflowEvents: WorkflowEvent[];
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

export type CreateWorkflowEventInput = {
  runId: string;
  action: WorkflowActionType;
  recipientRole: string | null;
  status: WorkflowEventStatus;
  now: Date;
  eventId: string;
};

export type ConfirmedModelCostAggregate = {
  completedRunCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  providerCounts: Record<Provider, number>;
  totalEstimatedCostUsd: number;
  averageEstimatedCostUsd: number;
  todayEstimatedCostUsd: number;
  monthToDateEstimatedCostUsd: number;
  byModel: Array<{
    provider: Provider;
    model: string;
    runCount: number;
    totalEstimatedCostUsd: number;
    averageEstimatedCostUsd: number;
  }>;
  byFamily: Array<{
    documentFamily: DocumentFamily;
    runCount: number;
    totalEstimatedCostUsd: number;
    averageEstimatedCostUsd: number;
  }>;
};

export type ExpiryBucketCounts = {
  lessThanOneHour: number;
  oneToSixHours: number;
  sixToTwentyFourHours: number;
};

export type ActiveDetailLifecycleAggregate = {
  activeDocuments: number;
  activePublicUploads: number;
  expiryBuckets: ExpiryBucketCounts;
};

export type CreateWorkflowEventResult =
  | { status: "created" | "already_created"; event: WorkflowEvent }
  | {
      status:
        | "not_found"
        | "unavailable"
        | "expired"
        | "deleted"
        | "id_collision";
    };

export interface RunRepository {
  claimRunRequest(runId: string, expiresAt: string, now: Date): Promise<boolean>;
  releaseRunRequest(runId: string): Promise<void>;
  createRun(record: StoredRunRecord): Promise<void>;
  markProviderDispatched(runId: string): Promise<boolean>;
  setStatus(runId: string, status: RunStatus): Promise<void>;
  appendStep(runId: string, step: RunStepRecord): Promise<void>;
  saveResults(runId: string, result: SaveRunResultsInput): Promise<void>;
  createWorkflowEvent(
    input: CreateWorkflowEventInput,
  ): Promise<CreateWorkflowEventResult>;
  stageAction(runId: string, now: Date): Promise<StageActionResult>;
  markFailed(runId: string, input: MarkRunFailedInput): Promise<void>;
  readPublicRun(runId: string, now: Date): Promise<PublicRunRecord | null>;
  listPublicRuns(now: Date, options?: PublicRunListOptions): Promise<PublicRunRecord[]>;
  countCleanupBacklog(now: Date): Promise<number>;
  aggregateAnonymousUsage(): Promise<AnonymousUsageAggregate>;
  aggregateConfirmedModelCosts(now: Date): Promise<ConfirmedModelCostAggregate>;
  aggregateActiveDetailLifecycle(
    now: Date,
  ): Promise<ActiveDetailLifecycleAggregate>;
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
  workflowEvents: Map<string, WorkflowEvent>;
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

function workflowIdentity(
  action: WorkflowActionType,
  recipientRole: string | null,
): string {
  return `${action}\u0000${recipientRole ?? ""}`;
}

function compareWorkflowEvents(left: WorkflowEvent, right: WorkflowEvent): number {
  return (
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  );
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * ONE_HOUR_MS;
const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS;

function roundedAmount(value: number): number {
  return Number(value.toFixed(12));
}

function isTrustworthyPositiveUsage(usage: TokenUsage): boolean {
  return (
    Number.isSafeInteger(usage.inputTokens) &&
    usage.inputTokens >= 0 &&
    Number.isSafeInteger(usage.outputTokens) &&
    usage.outputTokens >= 0 &&
    usage.inputTokens + usage.outputTokens > 0
  );
}

function isConfirmedCompletedModelRun(run: InternalRun, now: Date): boolean {
  const completedAt =
    run.record.completedAt === null ? Number.NaN : Date.parse(run.record.completedAt);
  return (
    run.completionAggregated &&
    run.record.providerDispatched &&
    Number.isFinite(completedAt) &&
    completedAt <= now.getTime() &&
    isTrustworthyPositiveUsage(run.record.usage) &&
    Number.isFinite(run.record.estimatedCostUsd) &&
    run.record.estimatedCostUsd >= 0
  );
}

function emptyConfirmedModelCostAggregate(): ConfirmedModelCostAggregate {
  return {
    completedRunCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    providerCounts: { openai: 0, anthropic: 0 },
    totalEstimatedCostUsd: 0,
    averageEstimatedCostUsd: 0,
    todayEstimatedCostUsd: 0,
    monthToDateEstimatedCostUsd: 0,
    byModel: [],
    byFamily: [],
  };
}

function compareModelCostRows(
  left: ConfirmedModelCostAggregate["byModel"][number],
  right: ConfirmedModelCostAggregate["byModel"][number],
): number {
  return (
    left.provider.localeCompare(right.provider) ||
    left.model.localeCompare(right.model)
  );
}

function compareFamilyCostRows(
  left: ConfirmedModelCostAggregate["byFamily"][number],
  right: ConfirmedModelCostAggregate["byFamily"][number],
): number {
  return left.documentFamily.localeCompare(right.documentFamily);
}

export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, InternalRun>();
  private readonly runRequestClaims = new Map<string, string>();
  private readonly workflowEventIds = new Map<string, string>();
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
    const initialRecord = clone(record);
    initialRecord.providerDispatched = false;
    initialRecord.completedAt = null;
    this.runs.set(record.id, {
      record: initialRecord,
      steps: [],
      result: null,
      workflowEvents: new Map(),
      detailsDeleted: false,
      completionAggregated: false,
      failureAggregated: false,
    });
    this.aggregate.totalRuns += 1;
  }

  async markProviderDispatched(runId: string): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || run.detailsDeleted || run.record.executionMode !== "live") return false;
    if (!run.record.providerDispatched) {
      run.record.providerDispatched = true;
      this.aggregate.providerCounts[run.record.provider] += 1;
    }
    return true;
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
    run.record.completedAt = result.completedAt;
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

  async createWorkflowEvent(
    input: CreateWorkflowEventInput,
  ): Promise<CreateWorkflowEventResult> {
    const run = this.runs.get(input.runId);
    if (!run) return { status: "not_found" };
    if (run.detailsDeleted || run.record.status === "deleted") {
      return { status: "deleted" };
    }
    if (run.record.status === "expired" || isExpired(run, input.now)) {
      return { status: "expired" };
    }
    if (run.record.status === "failed") {
      if (
        input.action !== "retry_processing" &&
        input.action !== "download_summary"
      ) {
        return { status: "unavailable" };
      }
    } else if (run.record.status !== "completed") {
      return { status: "unavailable" };
    }

    const identity = workflowIdentity(input.action, input.recipientRole);
    const existing = run.workflowEvents.get(identity);
    if (existing) {
      return { status: "already_created", event: clone(existing) };
    }
    if (this.workflowEventIds.has(input.eventId)) {
      return { status: "id_collision" };
    }

    const event: WorkflowEvent = {
      id: input.eventId,
      runId: input.runId,
      action: input.action,
      recipientRole: input.recipientRole,
      status: input.status,
      createdAt: input.now.toISOString(),
    };
    run.workflowEvents.set(identity, clone(event));
    this.workflowEventIds.set(input.eventId, `${input.runId}\u0000${identity}`);
    return { status: "created", event: clone(event) };
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

  async aggregateConfirmedModelCosts(
    now: Date,
  ): Promise<ConfirmedModelCostAggregate> {
    const aggregate = emptyConfirmedModelCostAggregate();
    const modelGroups = new Map<
      string,
      ConfirmedModelCostAggregate["byModel"][number]
    >();
    const familyGroups = new Map<
      DocumentFamily,
      ConfirmedModelCostAggregate["byFamily"][number]
    >();
    const todayStart = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

    for (const run of this.runs.values()) {
      if (!isConfirmedCompletedModelRun(run, now)) continue;
      const completedAt = Date.parse(run.record.completedAt!);
      const cost = run.record.estimatedCostUsd;
      aggregate.completedRunCount += 1;
      aggregate.totalInputTokens += run.record.usage.inputTokens;
      aggregate.totalOutputTokens += run.record.usage.outputTokens;
      aggregate.providerCounts[run.record.provider] += 1;
      aggregate.totalEstimatedCostUsd += cost;
      if (completedAt >= todayStart) aggregate.todayEstimatedCostUsd += cost;
      if (completedAt >= monthStart) aggregate.monthToDateEstimatedCostUsd += cost;

      const modelKey = `${run.record.provider}\u0000${run.record.model}`;
      const modelGroup = modelGroups.get(modelKey) ?? {
        provider: run.record.provider,
        model: run.record.model,
        runCount: 0,
        totalEstimatedCostUsd: 0,
        averageEstimatedCostUsd: 0,
      };
      modelGroup.runCount += 1;
      modelGroup.totalEstimatedCostUsd += cost;
      modelGroups.set(modelKey, modelGroup);

      if (run.record.documentFamily !== null) {
        const familyGroup = familyGroups.get(run.record.documentFamily) ?? {
          documentFamily: run.record.documentFamily,
          runCount: 0,
          totalEstimatedCostUsd: 0,
          averageEstimatedCostUsd: 0,
        };
        familyGroup.runCount += 1;
        familyGroup.totalEstimatedCostUsd += cost;
        familyGroups.set(run.record.documentFamily, familyGroup);
      }
    }

    aggregate.totalEstimatedCostUsd = roundedAmount(
      aggregate.totalEstimatedCostUsd,
    );
    aggregate.todayEstimatedCostUsd = roundedAmount(
      aggregate.todayEstimatedCostUsd,
    );
    aggregate.monthToDateEstimatedCostUsd = roundedAmount(
      aggregate.monthToDateEstimatedCostUsd,
    );
    aggregate.averageEstimatedCostUsd =
      aggregate.completedRunCount === 0
        ? 0
        : roundedAmount(
            aggregate.totalEstimatedCostUsd / aggregate.completedRunCount,
          );
    aggregate.byModel = [...modelGroups.values()]
      .map((group) => ({
        ...group,
        totalEstimatedCostUsd: roundedAmount(group.totalEstimatedCostUsd),
        averageEstimatedCostUsd: roundedAmount(
          group.totalEstimatedCostUsd / group.runCount,
        ),
      }))
      .sort(compareModelCostRows);
    aggregate.byFamily = [...familyGroups.values()]
      .map((group) => ({
        ...group,
        totalEstimatedCostUsd: roundedAmount(group.totalEstimatedCostUsd),
        averageEstimatedCostUsd: roundedAmount(
          group.totalEstimatedCostUsd / group.runCount,
        ),
      }))
      .sort(compareFamilyCostRows);
    return aggregate;
  }

  async aggregateActiveDetailLifecycle(
    now: Date,
  ): Promise<ActiveDetailLifecycleAggregate> {
    const aggregate: ActiveDetailLifecycleAggregate = {
      activeDocuments: 0,
      activePublicUploads: 0,
      expiryBuckets: {
        lessThanOneHour: 0,
        oneToSixHours: 0,
        sixToTwentyFourHours: 0,
      },
    };
    for (const run of this.runs.values()) {
      const expiresAt = Date.parse(run.record.expiresAt);
      const remainingMs = expiresAt - now.getTime();
      if (
        run.detailsDeleted ||
        run.record.status === "expired" ||
        run.record.status === "deleted" ||
        !Number.isFinite(expiresAt) ||
        remainingMs <= 0 ||
        remainingMs > TWENTY_FOUR_HOURS_MS
      ) {
        continue;
      }
      aggregate.activeDocuments += 1;
      if (run.record.sourceType === "custom") {
        aggregate.activePublicUploads += 1;
      }
      if (remainingMs <= ONE_HOUR_MS) {
        aggregate.expiryBuckets.lessThanOneHour += 1;
      } else if (remainingMs <= SIX_HOURS_MS) {
        aggregate.expiryBuckets.oneToSixHours += 1;
      } else {
        aggregate.expiryBuckets.sixToTwentyFourHours += 1;
      }
    }
    return aggregate;
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
    for (const event of run.workflowEvents.values()) {
      this.workflowEventIds.delete(event.id);
    }
    run.workflowEvents.clear();
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

    if (
      includeDetails &&
      !run.detailsDeleted &&
      status !== "expired" &&
      status !== "deleted"
    ) {
      publicRun.details = {
        steps: clone(run.steps),
        result: run.result ? clone(run.result) : null,
        workflowEvents: [...run.workflowEvents.values()]
          .sort(compareWorkflowEvents)
          .map(clone),
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

const workflowActionValues = new Set<WorkflowActionType>([
  "approve_and_stage",
  "mark_for_later_review",
  "assign_review",
  "request_clarification",
  "request_clearer_document",
  "prepare_email",
  "replace_document",
  "retry_processing",
  "download_summary",
]);

const workflowEventStatusValues = new Set<WorkflowEventStatus>([
  "prepared",
  "staged",
  "simulated",
]);

function workflowEventFromRow(row: DatabaseRow): WorkflowEvent | null {
  if (
    typeof row.id !== "string" ||
    typeof row.run_id !== "string" ||
    typeof row.action !== "string" ||
    !workflowActionValues.has(row.action as WorkflowActionType) ||
    (row.recipient_role !== null && typeof row.recipient_role !== "string") ||
    typeof row.status !== "string" ||
    !workflowEventStatusValues.has(row.status as WorkflowEventStatus) ||
    row.created_at === null ||
    row.created_at === undefined
  ) {
    return null;
  }
  try {
    return {
      id: row.id,
      runId: row.run_id,
      action: row.action as WorkflowActionType,
      recipientRole: row.recipient_role,
      status: row.status as WorkflowEventStatus,
      createdAt: asIso(row.created_at),
    };
  } catch {
    return null;
  }
}

const confirmedRunEligibilityCte = `WITH eligible_confirmed_runs AS MATERIALIZED (
  SELECT provider, model, document_family, estimated_cost_usd, completed_at,
    CASE
      WHEN jsonb_typeof(usage -> 'inputTokens') = 'number'
      THEN CASE
        WHEN (usage ->> 'inputTokens') ~ '^[0-9]+$'
        THEN CASE
          WHEN (usage ->> 'inputTokens')::numeric <= 9007199254740991
          THEN (usage ->> 'inputTokens')::bigint
          ELSE NULL
        END
        ELSE NULL
      END
      ELSE NULL
    END AS input_tokens,
    CASE
      WHEN jsonb_typeof(usage -> 'outputTokens') = 'number'
      THEN CASE
        WHEN (usage ->> 'outputTokens') ~ '^[0-9]+$'
        THEN CASE
          WHEN (usage ->> 'outputTokens')::numeric <= 9007199254740991
          THEN (usage ->> 'outputTokens')::bigint
          ELSE NULL
        END
        ELSE NULL
      END
      ELSE NULL
    END AS output_tokens
  FROM runs
  WHERE provider_dispatched = true
    AND was_completed = true
    AND provider IN ('openai', 'anthropic')
    AND completed_at IS NOT NULL
    AND completed_at <= $1::timestamptz
    AND estimated_cost_usd >= 0
), confirmed_runs AS MATERIALIZED (
  SELECT * FROM eligible_confirmed_runs
  WHERE input_tokens IS NOT NULL
    AND output_tokens IS NOT NULL
    AND input_tokens + output_tokens > 0
)`;

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
        prompt_version, provider_dispatched, document_family, fixture_id, completed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11::jsonb, $12,
        $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21, false, $22, $23, NULL
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
        record.documentFamily,
        record.fixtureId,
      ],
    );
  }

  async markProviderDispatched(runId: string): Promise<boolean> {
    const driver = await this.readyDriver();
    const rows = await driver.query(
      `UPDATE runs SET provider_dispatched = true
      WHERE id = $1 AND execution_mode = 'live' AND details_deleted = false
      RETURNING id`,
      [runId],
    );
    return rows.length === 1;
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
        step_durations = $8::jsonb, completed_at = $9::timestamptz,
        was_completed = true
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
        result.completedAt,
      ],
    );
  }

  async createWorkflowEvent(
    input: CreateWorkflowEventInput,
  ): Promise<CreateWorkflowEventResult> {
    const driver = await this.readyDriver();
    const timestamp = input.now.toISOString();
    const rows = await driver.query(
      `WITH locked_run AS (
        SELECT id, status, expires_at, details_deleted
        FROM runs WHERE id = $1 FOR UPDATE
      ), classified AS (
        SELECT *, CASE
          WHEN details_deleted OR status = 'deleted' THEN 'deleted'
          WHEN status = 'expired' OR expires_at <= $2::timestamptz THEN 'expired'
          WHEN status = 'failed' AND $4 IN ('retry_processing', 'download_summary') THEN 'available'
          WHEN status <> 'completed' THEN 'unavailable'
          ELSE 'available'
        END AS decision
        FROM locked_run
      ), inserted AS (
        INSERT INTO workflow_events (
          id, run_id, action, recipient_role, status, created_at
        )
        SELECT $3, id, $4, $5, $6, $2::timestamptz
        FROM classified WHERE decision = 'available'
        ON CONFLICT DO NOTHING
        RETURNING true AS event_created,
          id, run_id, action, recipient_role, status, created_at
      ), selected_event AS (
        SELECT event_created,
          id, run_id, action, recipient_role, status, created_at
        FROM inserted
        UNION ALL
        SELECT false AS event_created,
          existing.id, existing.run_id, existing.action,
          existing.recipient_role, existing.status, existing.created_at
        FROM classified
        JOIN workflow_events AS existing
          ON existing.run_id = classified.id AND action = $4
          AND COALESCE(recipient_role, '') = COALESCE($5, '')
        WHERE classified.decision = 'available'
        LIMIT 1
      )
      SELECT classified.decision, selected_event.*
      FROM classified
      LEFT JOIN selected_event ON true`,
      [
        input.runId,
        timestamp,
        input.eventId,
        input.action,
        input.recipientRole,
        input.status,
      ],
    );
    const row = rows[0];
    if (!row) return { status: "not_found" };
    const decision = String(row.decision);
    if (decision === "deleted" || decision === "expired" || decision === "unavailable") {
      return { status: decision };
    }
    if (decision !== "available") {
      throw new Error("workflow_event_decision_failed");
    }

    const event = workflowEventFromRow(row);
    const created = row.event_created;
    if (
      !event ||
      (created !== true && created !== false) ||
      event.runId !== input.runId ||
      event.action !== input.action ||
      event.recipientRole !== input.recipientRole ||
      (created && (event.id !== input.eventId || event.status !== input.status))
    ) {
      return { status: "id_collision" };
    }
    return {
      status: created ? "created" : "already_created",
      event: clone(event),
    };
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
          to_jsonb($4::text),
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
      [runId, timestamp, JSON.stringify(step), timestamp],
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
      provider_dispatched,
      source_type, document_family, fixture_id, file_metadata, requested_fields, status, outcome, usage,
      estimated_cost_usd, consent, created_at, expires_at, deleted_at,
      completed_at, retry_count, latency_ms, step_durations, details_deleted`;
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
        COUNT(*) FILTER (WHERE provider_dispatched AND provider = 'openai') AS openai_runs,
        COUNT(*) FILTER (WHERE provider_dispatched AND provider = 'anthropic') AS anthropic_runs,
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

  async aggregateConfirmedModelCosts(
    now: Date,
  ): Promise<ConfirmedModelCostAggregate> {
    const driver = await this.readyDriver();
    const nowIso = now.toISOString();
    const [summaryRows, modelRows, familyRows] = await Promise.all([
      driver.query(
        `${confirmedRunEligibilityCte}
        SELECT
          COUNT(*) AS completed_run_count,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COUNT(*) FILTER (WHERE provider = 'openai') AS openai_runs,
          COUNT(*) FILTER (WHERE provider = 'anthropic') AS anthropic_runs,
          COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost_usd,
          COALESCE(AVG(estimated_cost_usd), 0) AS average_estimated_cost_usd,
          COALESCE(SUM(estimated_cost_usd) FILTER (
            WHERE completed_at >= date_trunc(
              'day', $1::timestamptz AT TIME ZONE 'UTC'
            ) AT TIME ZONE 'UTC'
          ), 0) AS today_estimated_cost_usd,
          COALESCE(SUM(estimated_cost_usd) FILTER (
            WHERE completed_at >= date_trunc(
              'month', $1::timestamptz AT TIME ZONE 'UTC'
            ) AT TIME ZONE 'UTC'
          ), 0) AS month_to_date_estimated_cost_usd
        FROM confirmed_runs`,
        [nowIso],
      ),
      driver.query(
        `${confirmedRunEligibilityCte}
        SELECT provider, model, COUNT(*) AS run_count,
          COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost_usd,
          COALESCE(AVG(estimated_cost_usd), 0) AS average_estimated_cost_usd
        FROM confirmed_runs
        GROUP BY provider, model`,
        [nowIso],
      ),
      driver.query(
        `${confirmedRunEligibilityCte}
        SELECT document_family, COUNT(*) AS run_count,
          COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost_usd,
          COALESCE(AVG(estimated_cost_usd), 0) AS average_estimated_cost_usd
        FROM confirmed_runs
        WHERE document_family IN ('supplier_invoice', 'warehouse_goods_receipt')
        GROUP BY document_family`,
        [nowIso],
      ),
    ]);
    const summary = summaryRows[0] ?? {};
    return {
      completedRunCount: Number(summary.completed_run_count ?? 0),
      totalInputTokens: Number(summary.input_tokens ?? 0),
      totalOutputTokens: Number(summary.output_tokens ?? 0),
      providerCounts: {
        openai: Number(summary.openai_runs ?? 0),
        anthropic: Number(summary.anthropic_runs ?? 0),
      },
      totalEstimatedCostUsd: Number(summary.total_estimated_cost_usd ?? 0),
      averageEstimatedCostUsd: Number(
        summary.average_estimated_cost_usd ?? 0,
      ),
      todayEstimatedCostUsd: Number(summary.today_estimated_cost_usd ?? 0),
      monthToDateEstimatedCostUsd: Number(
        summary.month_to_date_estimated_cost_usd ?? 0,
      ),
      byModel: modelRows
        .map((row) => ({
          provider: row.provider as Provider,
          model: String(row.model),
          runCount: Number(row.run_count ?? 0),
          totalEstimatedCostUsd: Number(row.total_estimated_cost_usd ?? 0),
          averageEstimatedCostUsd: Number(
            row.average_estimated_cost_usd ?? 0,
          ),
        }))
        .sort(compareModelCostRows),
      byFamily: familyRows
        .map((row) => ({
          documentFamily: row.document_family as DocumentFamily,
          runCount: Number(row.run_count ?? 0),
          totalEstimatedCostUsd: Number(row.total_estimated_cost_usd ?? 0),
          averageEstimatedCostUsd: Number(
            row.average_estimated_cost_usd ?? 0,
          ),
        }))
        .sort(compareFamilyCostRows),
    };
  }

  async aggregateActiveDetailLifecycle(
    now: Date,
  ): Promise<ActiveDetailLifecycleAggregate> {
    const driver = await this.readyDriver();
    const rows = await driver.query(
      `SELECT
        COUNT(*) AS active_documents,
        COUNT(*) FILTER (WHERE source_type = 'custom') AS active_public_uploads,
        COUNT(*) FILTER (
          WHERE expires_at <= $1::timestamptz + interval '1 hour'
        ) AS less_than_one_hour,
        COUNT(*) FILTER (
          WHERE expires_at > $1::timestamptz + interval '1 hour'
            AND expires_at <= $1::timestamptz + interval '6 hours'
        ) AS one_to_six_hours,
        COUNT(*) FILTER (
          WHERE expires_at > $1::timestamptz + interval '6 hours'
            AND expires_at <= $1::timestamptz + interval '24 hours'
        ) AS six_to_twenty_four_hours
      FROM runs
      WHERE details_deleted = false
        AND status NOT IN ('expired', 'deleted')
        AND expires_at > $1::timestamptz
        AND expires_at <= $1::timestamptz + interval '24 hours'`,
      [now.toISOString()],
    );
    const row = rows[0] ?? {};
    return {
      activeDocuments: Number(row.active_documents ?? 0),
      activePublicUploads: Number(row.active_public_uploads ?? 0),
      expiryBuckets: {
        lessThanOneHour: Number(row.less_than_one_hour ?? 0),
        oneToSixHours: Number(row.one_to_six_hours ?? 0),
        sixToTwentyFourHours: Number(row.six_to_twenty_four_hours ?? 0),
      },
    };
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
      ), removed_workflow_events AS (
        DELETE FROM workflow_events WHERE run_id = $1
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
      providerDispatched: Boolean(row.provider_dispatched),
      sourceType: row.source_type as SourceType,
      documentFamily: (row.document_family as DocumentFamily | null | undefined) ?? null,
      fixtureId: (row.fixture_id as string | null | undefined) ?? null,
      file: asJson<SafeFileMetadata>(row.file_metadata),
      requestedFields: asJson<RequestedField[]>(row.requested_fields),
      status: expired && row.status !== "deleted" ? "expired" : (row.status as RunStatus),
      outcome: (row.outcome as Outcome | null) ?? null,
      usage: asJson<TokenUsage>(row.usage),
      estimatedCostUsd: Number(row.estimated_cost_usd),
      consent: Boolean(row.consent),
      createdAt: asIso(row.created_at),
      completedAt: row.completed_at ? asIso(row.completed_at) : null,
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
    if (
      !includeDetails ||
      expired ||
      detailsDeleted ||
      publicRun.status === "expired" ||
      publicRun.status === "deleted"
    ) {
      return publicRun;
    }

    const [stepRows, resultRows, workflowEventRows] = await Promise.all([
      driver.query("SELECT step_json FROM run_steps WHERE run_id = $1 ORDER BY sequence", [row.id]),
      driver.query("SELECT result_json FROM run_results WHERE run_id = $1", [row.id]),
      driver.query(
        `SELECT id, run_id, action, recipient_role, status, created_at
        FROM workflow_events WHERE run_id = $1 ORDER BY created_at, id`,
        [row.id],
      ),
    ]);
    const workflowEvents = workflowEventRows.map((eventRow) => {
      const event = workflowEventFromRow(eventRow);
      if (!event) throw new Error("workflow_event_hydration_failed");
      return event;
    });
    publicRun.details = {
      steps: stepRows.map((stepRow) => asJson<RunStepRecord>(stepRow.step_json)),
      result: resultRows[0] ? asJson<SaveRunResultsInput>(resultRows[0].result_json) : null,
      workflowEvents: workflowEvents.sort(compareWorkflowEvents),
    };
    return publicRun;
  }
}

export function createNeonRunRepository(options: NeonRepositoryOptions): RunRepository {
  return new NeonRunRepository(options);
}
