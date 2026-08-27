import { validateUpload } from "@/domain/file-validation";
import { decideOutcome } from "@/domain/outcomes";
import { estimateRunCost } from "@/domain/pricing";
import type { FieldResult, RunEvent, RunStatus } from "@/domain/types";
import {
  type RequestedField,
  type RunRepository,
  type RunStepRecord,
  type SourceType,
} from "@/server/repositories/run-repository";
import {
  createDeletionCredential,
  type DeletionCredential,
} from "@/server/security/deletion-token";
import type { DocumentStore } from "@/server/storage/document-store";
import {
  isRetryableProviderError,
  ProviderRequestError,
  type ExtractedField,
  type ExtractionProvider,
  type ProviderExtractionResponse,
} from "@/server/workflow/provider";

const RETENTION_MS = (23 * 60 + 55) * 60 * 1000;
const DEFAULT_REPLAY_STAGE_DELAY_MS = 140;
const MAX_REPLAY_STAGE_DELAY_MS = 500;

export type ExecuteRunInput = {
  sourceType: SourceType;
  file: {
    filename: string;
    mediaType: string;
    bytes: Uint8Array;
    pageCount?: number;
  };
  requestedFields: RequestedField[];
  consent: boolean;
  referenceData?: Record<string, string | null>;
};

export type FieldEvaluatorInput = {
  extractedField: ExtractedField;
  requestedField: RequestedField;
  referenceValue: string | null | undefined;
  sourceType: SourceType;
};

export type FieldEvaluator = (input: FieldEvaluatorInput) => Promise<FieldResult>;

export type ExecuteRunDependencies = {
  repository: RunRepository;
  documentStore: DocumentStore;
  provider: ExtractionProvider;
  clock?: () => Date;
  idSource?: () => string;
  deletionCredentialSource?: () => DeletionCredential;
  evaluateField?: FieldEvaluator;
  sleep?: (delayMs: number) => Promise<void>;
  replayStageDelayMs?: number;
};

function defaultClock(): Date {
  return new Date();
}

function defaultIdSource(): string {
  return crypto.randomUUID();
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function safeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).at(-1) ?? "document";
  const sanitized = basename.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  return sanitized || "document";
}

function comparable(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

async function defaultEvaluateField(input: FieldEvaluatorInput): Promise<FieldResult> {
  const normalizedValue = input.extractedField.normalizedValue?.trim() || null;
  const extractedValue = input.extractedField.extractedValue?.trim() || null;
  const evidence = input.extractedField.evidence?.trim() || null;

  if (!extractedValue || !normalizedValue) {
    return {
      key: input.requestedField.key,
      label: input.requestedField.label,
      extractedValue,
      normalizedValue,
      evidence,
      page: input.extractedField.page,
      evaluatorStatus: "not_found",
      referenceMatch: null,
    };
  }

  const hasReference = input.referenceValue !== undefined && input.referenceValue !== null;
  const referenceMatch = hasReference
    ? comparable(normalizedValue) === comparable(input.referenceValue as string)
    : null;
  return {
    key: input.requestedField.key,
    label: input.requestedField.label,
    extractedValue,
    normalizedValue,
    evidence,
    page: input.extractedField.page,
    evaluatorStatus: !evidence || referenceMatch === false ? "conflict" : "pass",
    referenceMatch,
  };
}

function publicError(error: unknown, stage: RunStatus): { code: string; message: string } {
  if (error instanceof ProviderRequestError) {
    const messages: Record<string, string> = {
      provider_rate_limited: "The selected provider is temporarily rate limited.",
      provider_unavailable: "The selected provider is temporarily unavailable.",
      provider_auth_failed: "Live provider access is not configured.",
      provider_request_rejected: "The selected provider rejected this request.",
      live_provider_disabled: "Live processing is disabled. A recorded replay remains available.",
      live_provider_key_missing: "Live processing is not configured. A recorded replay remains available.",
      provider_schema_mismatch: "The provider response did not pass the extraction contract.",
    };
    return {
      code: error.safeCode,
      message: messages[error.safeCode] ?? "The selected provider could not complete this run.",
    };
  }
  if (error instanceof Error && error.name === "ZodError") {
    return {
      code: "provider_schema_mismatch",
      message: "The provider response did not pass the extraction contract.",
    };
  }
  if (stage === "storing") {
    return { code: "storage_unavailable", message: "The document could not be stored safely." };
  }
  return { code: "workflow_failed", message: "The run could not be completed safely." };
}

async function extractWithOneRetry(
  provider: ExtractionProvider,
  input: ExecuteRunInput,
  onRetry: (error: ProviderRequestError) => Promise<void>,
): Promise<{ response: ProviderExtractionResponse; retryCount: number }> {
  let retryCount = 0;
  for (;;) {
    try {
      return {
        response: await provider.extract({
          document: {
            filename: safeFilename(input.file.filename),
            mediaType: input.file.mediaType,
            bytes: input.file.bytes,
          },
          requestedFields: input.requestedFields,
        }),
        retryCount,
      };
    } catch (error) {
      if (retryCount === 0 && isRetryableProviderError(error)) {
        retryCount = 1;
        await onRetry(error as ProviderRequestError);
        continue;
      }
      throw error;
    }
  }
}

export async function* executeRun(
  input: ExecuteRunInput,
  dependencies: ExecuteRunDependencies,
): AsyncGenerator<RunEvent> {
  const clock = dependencies.clock ?? defaultClock;
  const idSource = dependencies.idSource ?? defaultIdSource;
  const credentialSource = dependencies.deletionCredentialSource ?? createDeletionCredential;
  const evaluator = dependencies.evaluateField ?? defaultEvaluateField;
  const sleep = dependencies.sleep ?? defaultSleep;
  const runId = idSource();
  const createdAtDate = clock();
  const createdAt = createdAtDate.toISOString();
  const expiresAt = new Date(createdAtDate.getTime() + RETENTION_MS).toISOString();
  const delayMs = Math.min(
    MAX_REPLAY_STAGE_DELAY_MS,
    Math.max(0, dependencies.replayStageDelayMs ?? DEFAULT_REPLAY_STAGE_DELAY_MS),
  );
  let stageCount = 0;
  let runCreated = false;
  let currentStage: RunStatus = "validating";
  const stepDurations: Record<string, number> = {};

  const announce = async (stage: RunStatus): Promise<RunEvent> => {
    currentStage = stage;
    if (dependencies.provider.executionMode === "recorded" && stageCount > 0 && delayMs > 0) {
      await sleep(delayMs);
    }
    stageCount += 1;
    if (runCreated) await dependencies.repository.setStatus(runId, stage);
    return { type: "stage", stage, timestamp: clock().toISOString() };
  };

  const appendStage = async (stage: RunStatus, startedAt: number): Promise<void> => {
    const durationMs = Math.max(0, clock().getTime() - startedAt);
    stepDurations[stage] = durationMs;
    if (runCreated) {
      await dependencies.repository.appendStep(runId, {
        kind: "stage",
        stage,
        timestamp: clock().toISOString(),
        durationMs,
      });
    }
  };

  const validationStartedAt = clock().getTime();
  yield await announce("validating");
  const validation = validateUpload({
    bytes: input.file.bytes,
    filename: safeFilename(input.file.filename),
    reportedType: input.file.mediaType,
    requestedFields: input.requestedFields.map((field) => field.label),
    consent: input.consent,
    pageCount: input.file.pageCount,
    sourceType: input.sourceType,
  });
  if (!validation.valid) {
    yield {
      type: "failed",
      code: "validation_failed",
      message: "The document or requested fields did not pass validation.",
      timestamp: clock().toISOString(),
    };
    return;
  }

  const deletionCredential = credentialSource();
  const documentKey = `runs/${runId}/document`;
  try {
    await dependencies.repository.createRun({
      id: runId,
      provider: dependencies.provider.provider,
      model: dependencies.provider.model,
      promptVersion: dependencies.provider.promptVersion,
      executionMode: dependencies.provider.executionMode,
      sourceType: input.sourceType,
      file: {
        filename: safeFilename(input.file.filename),
        mediaType: input.file.mediaType,
        sizeBytes: input.file.bytes.byteLength,
        pageCount: input.file.pageCount ?? null,
      },
      documentKey,
      requestedFields: input.requestedFields,
      status: "validating",
      outcome: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      consent: input.consent,
      createdAt,
      expiresAt,
      deletedAt: null,
      deletionTokenHash: deletionCredential.hash,
      retryCount: 0,
      latencyMs: null,
      stepDurations: {},
    });
  } catch {
    yield {
      type: "failed",
      code: "telemetry_unavailable",
      message: "The run could not be recorded safely.",
      timestamp: clock().toISOString(),
    };
    return;
  }
  runCreated = true;
  await appendStage("validating", validationStartedAt);

  try {
    const storageStartedAt = clock().getTime();
    yield await announce("storing");
    await dependencies.documentStore.storePrivateDocument({
      key: documentKey,
      bytes: input.file.bytes,
      contentType: input.file.mediaType,
    });
    await appendStage("storing", storageStartedAt);

    const extractionStartedAt = clock().getTime();
    yield await announce("extracting");
    const { response, retryCount } = await extractWithOneRetry(
      dependencies.provider,
      input,
      async (error) => {
        const step: RunStepRecord = {
          kind: "retry",
          stage: "extracting",
          timestamp: clock().toISOString(),
          durationMs: null,
          safeCode: error.safeCode,
        };
        await dependencies.repository.appendStep(runId, step);
      },
    );
    await appendStage("extracting", extractionStartedAt);

    const verificationStartedAt = clock().getTime();
    yield await announce("verifying");
    const fields = await Promise.all(
      input.requestedFields.map((requestedField, index) =>
        evaluator({
          extractedField: response.extraction.fields[index],
          requestedField,
          referenceValue: input.referenceData?.[requestedField.key],
          sourceType: input.sourceType,
        }),
      ),
    );
    await appendStage("verifying", verificationStartedAt);
    for (const field of fields) {
      const timestamp = clock().toISOString();
      await dependencies.repository.appendStep(runId, {
        kind: "field",
        stage: field.key,
        timestamp,
        durationMs: null,
      });
      yield { type: "field", field, timestamp };
    }

    const comparisonStartedAt = clock().getTime();
    yield await announce("comparing");
    await appendStage("comparing", comparisonStartedAt);

    const decisionStartedAt = clock().getTime();
    yield await announce("deciding");
    const outcome = decideOutcome({ sourceType: input.sourceType, fields });
    await dependencies.repository.appendStep(runId, {
      kind: "decision",
      stage: outcome,
      timestamp: clock().toISOString(),
      durationMs: null,
    });
    await appendStage("deciding", decisionStartedAt);

    const publishingStartedAt = clock().getTime();
    yield await announce("publishing");
    const estimatedCostUsd =
      dependencies.provider.executionMode === "live"
        ? estimateRunCost({
            provider: dependencies.provider.provider,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
          })
        : 0;
    await appendStage("publishing", publishingStartedAt);
    const completedAt = clock().toISOString();
    await dependencies.repository.saveResults(runId, {
      fields,
      outcome,
      usage: response.usage,
      estimatedCostUsd,
      retryCount,
      latencyMs: Math.max(0, clock().getTime() - createdAtDate.getTime()),
      stepDurations,
      completedAt,
    });

    yield {
      type: "completed",
      outcome,
      runId,
      executionMode: dependencies.provider.executionMode,
      deletionToken: deletionCredential.token,
      timestamp: clock().toISOString(),
    };
  } catch (error) {
    const safe = publicError(error, currentStage);
    if (runCreated) {
      try {
        await dependencies.repository.markFailed(runId, {
          timestamp: clock().toISOString(),
          safeCode: safe.code,
        });
      } catch {
        // The safe terminal event remains available even when telemetry storage is unavailable.
      }
    }
    yield {
      type: "failed",
      code: safe.code,
      message: safe.message,
      runId,
      timestamp: clock().toISOString(),
    };
  }
}
