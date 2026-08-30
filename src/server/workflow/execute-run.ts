import { validateUpload } from "@/domain/file-validation";
import { decideOutcome } from "@/domain/outcomes";
import { estimateRunCost } from "@/domain/pricing";
import { applyActionPolicy } from "@/domain/action-policy";
import type {
  FieldResult,
  RunEvent,
  RunStatus,
  SyntheticFixture,
} from "@/domain/types";
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
import type { QuotaRepository } from "@/server/security/rate-limit";
import type { DocumentStore } from "@/server/storage/document-store";
import {
  DocumentGroundingError,
  evidenceMapsToPage,
  groundDocument,
  type DocumentGrounder,
} from "@/server/workflow/document-grounding";
import {
  isTrustworthyTokenUsage,
  isRetryableProviderError,
  ProviderRequestError,
  type ExtractedField,
  type ExtractionProvider,
  type ProviderExtractionResponse,
} from "@/server/workflow/provider";

const RETENTION_MS = (23 * 60 + 55) * 60 * 1000;
const DEFAULT_REPLAY_STAGE_DELAY_MS = 140;
const MAX_REPLAY_STAGE_DELAY_MS = 500;

class PersistenceWriteError extends Error {
  readonly name = "PersistenceWriteError";
}

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
  fixture?: SyntheticFixture | null;
};

export type FieldEvaluatorInput = {
  extractedField: ExtractedField;
  requestedField: RequestedField;
  sourceType: SourceType;
};

export type FieldEvaluator = (
  input: FieldEvaluatorInput,
) => Promise<FieldResult>;

export type ExecuteRunDependencies = {
  repository: RunRepository;
  documentStore: DocumentStore;
  provider: ExtractionProvider;
  clock?: () => Date;
  processingClock?: () => number;
  idSource?: () => string;
  deletionCredentialSource?: () => DeletionCredential;
  evaluateField?: FieldEvaluator;
  sleep?: (delayMs: number) => Promise<void>;
  replayStageDelayMs?: number;
  abortSignal?: AbortSignal;
  documentGrounder?: DocumentGrounder;
  quotaReservation?: {
    repository: QuotaRepository;
    reservationId: string;
  };
};

function defaultClock(): Date {
  return new Date();
}

function defaultProcessingClock(): number {
  return performance.now();
}

function defaultIdSource(): string {
  return crypto.randomUUID();
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function safeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).at(-1) ?? "document";
  const sanitized = basename
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
  return sanitized || "document";
}

function comparable(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function optionalText(value: string | null): string | null {
  const cleaned = value?.trim().replace(/\s+/g, " ") ?? "";
  return cleaned || null;
}

function isMoneyField(field: RequestedField): boolean {
  return /(?:total|amount|price|cost)/i.test(`${field.key} ${field.label}`);
}

function isIdentifierField(field: RequestedField): boolean {
  return /(?:number|identifier|\bid\b|code|reference|purchase[ _-]?order)/i.test(
    `${field.key} ${field.label}`,
  );
}

type MoneyValue = { amount: number; currency: string | null };

function normalizeCurrency(value: string | undefined): string | null {
  if (!value) return null;
  return value.toUpperCase() === "S$" ? "SGD" : value.toUpperCase();
}

function moneyValues(value: string): MoneyValue[] {
  const pattern =
    /(?:(S\$|SGD|USD|EUR|GBP|JPY|AUD|CAD)\s*)?([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(SGD|USD|EUR|GBP|JPY|AUD|CAD))?/gi;
  return [...value.matchAll(pattern)].flatMap((match) => {
    const amount = Number(match[2].replace(/,/g, ""));
    const currency = normalizeCurrency(match[1] ?? match[3]);
    return Number.isFinite(amount) ? [{ amount, currency }] : [];
  });
}

function normalizeFieldValue(
  field: RequestedField,
  value: string,
): string | null {
  const cleaned = optionalText(value);
  if (!cleaned) return null;
  if (isMoneyField(field)) {
    const money = moneyValues(cleaned)[0];
    if (!money) return null;
    const amount = money.amount.toFixed(2);
    return money.currency ? `${amount} ${money.currency}` : amount;
  }
  return isIdentifierField(field) ? cleaned.toUpperCase() : cleaned;
}

function comparisonToken(field: RequestedField, value: string): string {
  if (isIdentifierField(field))
    return comparable(value).replace(/[^\p{L}\p{N}]/gu, "");
  return comparable(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function valuesMatch(
  field: RequestedField,
  left: string,
  right: string,
): boolean {
  if (isMoneyField(field)) {
    const leftMoney = moneyValues(left)[0];
    const rightMoney = moneyValues(right)[0];
    if (!leftMoney || !rightMoney || leftMoney.amount !== rightMoney.amount)
      return false;
    return (
      leftMoney.currency === rightMoney.currency ||
      leftMoney.currency === null ||
      rightMoney.currency === null
    );
  }
  return comparisonToken(field, left) === comparisonToken(field, right);
}

function evidenceSupportsValue(
  field: RequestedField,
  normalizedValue: string,
  evidence: string,
): boolean {
  if (isMoneyField(field)) {
    const expected = moneyValues(normalizedValue)[0];
    if (!expected) return false;
    return moneyValues(evidence).some(
      (candidate) =>
        candidate.amount === expected.amount &&
        (expected.currency === null ||
          candidate.currency === expected.currency),
    );
  }
  const valueToken = comparisonToken(field, normalizedValue);
  if (!valueToken) return false;
  if (isIdentifierField(field)) {
    const evidenceTokens =
      evidence.match(/[\p{L}\p{N}]+(?:[-_./][\p{L}\p{N}]+)*/gu) ?? [];
    return evidenceTokens.some(
      (evidenceToken) => comparisonToken(field, evidenceToken) === valueToken,
    );
  }
  return ` ${comparisonToken(field, evidence)} `.includes(` ${valueToken} `);
}

function deterministicFieldResult(
  input: FieldEvaluatorInput,
  candidate?: FieldResult,
  grounding?: { required: boolean; evidenceGrounded: boolean },
): FieldResult {
  const extractedValue = optionalText(input.extractedField.extractedValue);
  const normalizedValue = extractedValue
    ? normalizeFieldValue(input.requestedField, extractedValue)
    : null;
  const providerNormalizedValue = optionalText(
    input.extractedField.normalizedValue,
  );
  const evidence = optionalText(input.extractedField.evidence);
  let evaluatorStatus: FieldResult["evaluatorStatus"];

  if (!extractedValue) {
    evaluatorStatus = "not_found";
  } else if (!normalizedValue) {
    evaluatorStatus = grounding?.required ? "conflict" : "not_found";
  } else if (grounding?.required && !grounding.evidenceGrounded) {
    evaluatorStatus = "conflict";
  } else if (
    providerNormalizedValue !== null &&
    !valuesMatch(input.requestedField, normalizedValue, providerNormalizedValue)
  ) {
    evaluatorStatus = "conflict";
  } else if (
    !evidence ||
    !evidenceSupportsValue(input.requestedField, normalizedValue, evidence)
  ) {
    evaluatorStatus = "conflict";
  } else if (candidate?.evaluatorStatus === "conflict") {
    evaluatorStatus = "conflict";
  } else {
    evaluatorStatus = "pass";
  }

  return {
    key: input.requestedField.key,
    label: input.requestedField.label,
    extractedValue,
    normalizedValue,
    evidence,
    page: input.extractedField.page,
    evaluatorStatus,
    referenceMatch: null,
  };
}

async function defaultEvaluateField(
  input: FieldEvaluatorInput,
): Promise<FieldResult> {
  return deterministicFieldResult(input);
}

function compareFieldWithReference(
  field: FieldResult,
  requestedField: RequestedField,
  referenceValue: string | null | undefined,
): FieldResult {
  if (referenceValue === undefined || referenceValue === null) {
    return { ...field, referenceMatch: null };
  }
  const normalizedReference = normalizeFieldValue(
    requestedField,
    referenceValue,
  );
  const referenceMatch =
    field.normalizedValue !== null &&
    normalizedReference !== null &&
    valuesMatch(requestedField, field.normalizedValue, normalizedReference);
  return {
    ...field,
    referenceMatch,
    evaluatorStatus:
      field.evaluatorStatus === "not_found"
        ? "not_found"
        : field.evaluatorStatus === "conflict" || !referenceMatch
          ? "conflict"
          : "pass",
  };
}

function publicError(
  error: unknown,
  stage: RunStatus,
): { code: string; message: string } {
  if (error instanceof PersistenceWriteError) {
    return {
      code: "workflow_failed",
      message: "The run could not be completed safely.",
    };
  }
  if (error instanceof DocumentGroundingError) {
    return {
      code: "document_grounding_failed",
      message: "The document could not be grounded safely.",
    };
  }
  if (error instanceof ProviderRequestError) {
    const messages: Record<string, string> = {
      provider_rate_limited:
        "The selected provider is temporarily rate limited.",
      provider_unavailable: "The selected provider is temporarily unavailable.",
      provider_auth_failed: "Live provider access is not configured.",
      provider_request_rejected: "The selected provider rejected this request.",
      live_provider_disabled:
        "Live processing is disabled. A demo sample remains available.",
      live_provider_key_missing:
        "Live processing is not configured. A demo sample remains available.",
      provider_schema_mismatch:
        "The provider response did not pass the extraction contract.",
    };
    return {
      code: error.safeCode,
      message:
        messages[error.safeCode] ??
        "The selected provider could not complete this run.",
    };
  }
  if (error instanceof Error && error.name === "ZodError") {
    return {
      code: "provider_schema_mismatch",
      message: "The provider response did not pass the extraction contract.",
    };
  }
  if (stage === "storing") {
    return {
      code: "storage_unavailable",
      message: "The document could not be stored safely.",
    };
  }
  return {
    code: "workflow_failed",
    message: "The run could not be completed safely.",
  };
}

function hasTrustworthyUsage(
  response: ProviderExtractionResponse,
  provider: ExtractionProvider,
): boolean {
  return (
    response.usageTrustworthy !== false &&
    isTrustworthyTokenUsage(response.usage, provider.provider, provider.model)
  );
}

async function extractWithOneRetry(
  provider: ExtractionProvider,
  input: ExecuteRunInput,
  onDispatch: () => Promise<void>,
  onRetry: (error: ProviderRequestError) => Promise<void>,
  signal?: AbortSignal,
): Promise<{ response: ProviderExtractionResponse; retryCount: number }> {
  let retryCount = 0;
  for (;;) {
    try {
      signal?.throwIfAborted();
      return {
        response: await provider.extract({
          document: {
            filename: safeFilename(input.file.filename),
            mediaType: input.file.mediaType,
            bytes: input.file.bytes,
          },
          requestedFields: input.requestedFields,
          signal,
          onDispatch,
        }),
        retryCount,
      };
    } catch (error) {
      if (retryCount === 0 && isRetryableProviderError(error)) {
        retryCount = 1;
        await onRetry(error as ProviderRequestError);
        signal?.throwIfAborted();
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
  const processingClock =
    dependencies.processingClock ?? defaultProcessingClock;
  const idSource = dependencies.idSource ?? defaultIdSource;
  const credentialSource =
    dependencies.deletionCredentialSource ?? createDeletionCredential;
  const evaluator = dependencies.evaluateField ?? defaultEvaluateField;
  const documentGrounder = dependencies.documentGrounder ?? groundDocument;
  const sleep = dependencies.sleep ?? defaultSleep;
  const signal = dependencies.abortSignal;
  const runId = idSource();
  const createdAtDate = clock();
  const createdAt = createdAtDate.toISOString();
  const expiresAt = new Date(
    createdAtDate.getTime() + RETENTION_MS,
  ).toISOString();
  const delayMs = Math.min(
    MAX_REPLAY_STAGE_DELAY_MS,
    Math.max(
      0,
      dependencies.replayStageDelayMs ?? DEFAULT_REPLAY_STAGE_DELAY_MS,
    ),
  );
  let stageCount = 0;
  let runCreated = false;
  let currentStage: RunStatus = "validating";
  let currentStageStartedAt: number | null = null;
  let retryCount = 0;
  let billableCostUsd: number | null = null;
  let finalUsageTrustworthy = false;
  let quotaSettlementStarted = false;
  let quotaSettlementAccepted = false;
  let providerDispatchCount = 0;
  const stepDurations: Record<string, number> = {};

  const releaseQuotaReservation = async (): Promise<void> => {
    if (
      !dependencies.quotaReservation ||
      quotaSettlementStarted ||
      providerDispatchCount > 0
    ) {
      return;
    }
    try {
      await dependencies.quotaReservation.repository.releaseLiveReservation(
        dependencies.quotaReservation.reservationId,
      );
    } catch {
      // Quota cleanup must not expose persistence details in the public event stream.
    }
  };

  const settleProviderCost = async (): Promise<boolean> => {
    if (!dependencies.quotaReservation) return true;
    if (quotaSettlementStarted) return quotaSettlementAccepted;
    quotaSettlementStarted = true;
    try {
      const useExactCost =
        providerDispatchCount === 1 &&
        retryCount === 0 &&
        finalUsageTrustworthy &&
        billableCostUsd !== null;
      const settlement = useExactCost
        ? await dependencies.quotaReservation.repository.settleLiveReservation(
            dependencies.quotaReservation.reservationId,
            billableCostUsd!,
          )
        : await dependencies.quotaReservation.repository.settleLiveReservationConservatively(
            dependencies.quotaReservation.reservationId,
          );
      quotaSettlementAccepted =
        settlement.status === "settled" ||
        settlement.status === "already_settled";
      return quotaSettlementAccepted;
    } catch {
      return false;
    }
  };

  const announce = async (stage: RunStatus): Promise<RunEvent> => {
    signal?.throwIfAborted();
    currentStage = stage;
    if (
      dependencies.provider.executionMode === "recorded" &&
      stageCount > 0 &&
      delayMs > 0
    ) {
      await sleep(delayMs);
      signal?.throwIfAborted();
    }
    stageCount += 1;
    if (runCreated) {
      try {
        await dependencies.repository.setStatus(runId, stage);
      } catch (error) {
        throw new PersistenceWriteError("run_status_write_failed", {
          cause: error,
        });
      }
    }
    return { type: "stage", stage, timestamp: clock().toISOString() };
  };

  const appendStage = async (
    stage: RunStatus,
    startedAt: number,
  ): Promise<void> => {
    signal?.throwIfAborted();
    const durationMs = Math.max(0, processingClock() - startedAt);
    stepDurations[stage] = durationMs;
    currentStageStartedAt = null;
    if (runCreated) {
      await dependencies.repository.appendStep(runId, {
        kind: "stage",
        stage,
        timestamp: clock().toISOString(),
        durationMs,
      });
    }
  };

  const totalProcessingLatency = (): number =>
    Object.values(stepDurations).reduce(
      (total, duration) => total + duration,
      0,
    );

  let validation: ReturnType<typeof validateUpload>;
  let validationStartedAt: number;
  try {
    signal?.throwIfAborted();
    yield await announce("validating");
    validationStartedAt = processingClock();
    currentStageStartedAt = validationStartedAt;
    validation = validateUpload({
      bytes: input.file.bytes,
      filename: safeFilename(input.file.filename),
      reportedType: input.file.mediaType,
      requestedFields: input.requestedFields.map((field) => field.label),
      consent: input.consent,
      pageCount: input.file.pageCount,
      sourceType: input.sourceType,
    });
  } catch (error) {
    if (signal?.aborted) {
      await releaseQuotaReservation();
      return;
    }
    throw error;
  }
  if (!validation.valid) {
    await releaseQuotaReservation();
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
      providerDispatched: false,
      sourceType: input.sourceType,
      documentFamily: input.fixture?.family ?? null,
      fixtureId: input.fixture?.id ?? null,
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
      completedAt: null,
      expiresAt,
      deletedAt: null,
      deletionTokenHash: deletionCredential.hash,
      retryCount: 0,
      latencyMs: null,
      stepDurations: {},
    });
  } catch {
    await releaseQuotaReservation();
    yield {
      type: "failed",
      code: "telemetry_unavailable",
      message: "The run could not be recorded safely.",
      timestamp: clock().toISOString(),
    };
    return;
  }
  runCreated = true;

  try {
    await appendStage("validating", validationStartedAt);
    yield await announce("storing");
    const storageStartedAt = processingClock();
    currentStageStartedAt = storageStartedAt;
    await dependencies.documentStore.storePrivateDocument({
      key: documentKey,
      bytes: input.file.bytes,
      contentType: input.file.mediaType,
    });
    await appendStage("storing", storageStartedAt);

    yield await announce("extracting");
    const extractionStartedAt = processingClock();
    currentStageStartedAt = extractionStartedAt;
    const { response, retryCount: completedRetryCount } =
      await extractWithOneRetry(
        dependencies.provider,
        input,
        async () => {
          signal?.throwIfAborted();
          if (dependencies.provider.executionMode === "live") {
            let quotaMarked = false;
            try {
              if (dependencies.quotaReservation) {
                quotaMarked =
                  await dependencies.quotaReservation.repository.markLiveReservationDispatched(
                    dependencies.quotaReservation.reservationId,
                  );
                if (!quotaMarked) throw new Error("quota_dispatch_mark_failed");
              }
              signal?.throwIfAborted();
              const attributed = await dependencies.repository.markProviderDispatched(runId);
              if (!attributed) throw new Error("provider_dispatch_attribution_failed");
            } catch (error) {
              if (quotaMarked && dependencies.quotaReservation) {
                const cleared = await dependencies.quotaReservation.repository
                  .clearLiveReservationDispatched(dependencies.quotaReservation.reservationId)
                  .catch(() => false);
                if (!cleared) {
                  await dependencies.quotaReservation.repository
                    .releaseLiveReservation(dependencies.quotaReservation.reservationId)
                    .catch(() => false);
                }
              }
              throw error;
            }
          }
          providerDispatchCount += 1;
        },
        async (error) => {
          retryCount = 1;
          const step: RunStepRecord = {
            kind: "retry",
            stage: "extracting",
            timestamp: clock().toISOString(),
            durationMs: null,
            safeCode: error.safeCode,
          };
          await dependencies.repository.appendStep(runId, step);
        },
        signal,
      );
    if (
      dependencies.quotaReservation &&
      dependencies.provider.executionMode === "live" &&
      providerDispatchCount === 0
    ) {
      throw new Error("provider_dispatch_unconfirmed");
    }
    finalUsageTrustworthy = hasTrustworthyUsage(
      response,
      dependencies.provider,
    );
    billableCostUsd =
      dependencies.provider.executionMode === "live" && finalUsageTrustworthy
        ? estimateRunCost({
            provider: dependencies.provider.provider,
            model: dependencies.provider.model,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
          })
        : null;
    retryCount = completedRetryCount;
    await appendStage("extracting", extractionStartedAt);

    yield await announce("verifying");
    const verificationStartedAt = processingClock();
    currentStageStartedAt = verificationStartedAt;
    const groundingRequired = !(
      dependencies.provider.executionMode === "recorded" &&
      input.sourceType === "synthetic"
    );
    let groundedPages: string[] | null = null;
    if (groundingRequired) {
      try {
        groundedPages = await documentGrounder({
          bytes: input.file.bytes,
          mediaType: input.file.mediaType,
          pageCount: input.file.pageCount,
          signal,
        });
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        ) {
          throw error;
        }
        if (error instanceof DocumentGroundingError) throw error;
        throw new DocumentGroundingError("document_grounding_failed", {
          cause: error,
        });
      }
    }
    const verifiedFields = await Promise.all(
      input.requestedFields.map(async (requestedField, index) => {
        const evaluatorInput: FieldEvaluatorInput = {
          extractedField: response.extraction.fields[index],
          requestedField,
          sourceType: input.sourceType,
        };
        const candidate = await evaluator(evaluatorInput);
        return deterministicFieldResult(evaluatorInput, candidate, {
          required: groundingRequired,
          evidenceGrounded:
            !groundingRequired ||
            evidenceMapsToPage({
              pages: groundedPages ?? [],
              page: evaluatorInput.extractedField.page,
              evidence: evaluatorInput.extractedField.evidence,
            }),
        });
      }),
    );
    signal?.throwIfAborted();
    await appendStage("verifying", verificationStartedAt);

    yield await announce("comparing");
    const comparisonStartedAt = processingClock();
    currentStageStartedAt = comparisonStartedAt;
    const fields = verifiedFields.map((field, index) =>
      compareFieldWithReference(
        field,
        input.requestedFields[index],
        input.referenceData?.[input.requestedFields[index].key],
      ),
    );
    await appendStage("comparing", comparisonStartedAt);
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

    yield await announce("deciding");
    const decisionStartedAt = processingClock();
    currentStageStartedAt = decisionStartedAt;
    const guardedDocument =
      input.sourceType === "custom" &&
      (response.extraction.classification === "irrelevant" ||
        response.extraction.classification === "uncertain");
    const outcome = guardedDocument
      ? "not_found"
      : decideOutcome({ sourceType: input.sourceType, fields });
    const action = {
      ...applyActionPolicy(
        outcome,
        response.extraction.action,
        input.sourceType === "synthetic" ? (input.fixture ?? null) : null,
        response.extraction.classification,
      ),
      stagedAt: null,
    };
    await dependencies.repository.appendStep(runId, {
      kind: "decision",
      stage: outcome,
      timestamp: clock().toISOString(),
      durationMs: null,
    });
    await appendStage("deciding", decisionStartedAt);

    yield await announce("publishing");
    const publishingStartedAt = processingClock();
    currentStageStartedAt = publishingStartedAt;
    const estimatedCostUsd = billableCostUsd ?? 0;
    if (dependencies.quotaReservation) {
      if (dependencies.provider.executionMode === "live") {
        if (!(await settleProviderCost())) {
          throw new Error("quota_settlement_failed");
        }
      } else {
        await releaseQuotaReservation();
      }
    }
    await appendStage("publishing", publishingStartedAt);
    const completedAt = clock().toISOString();
    await dependencies.repository.saveResults(runId, {
      fields,
      outcome,
      documentClassification: response.extraction.classification,
      documentInstruction: response.extraction.documentInstruction,
      action,
      usage: finalUsageTrustworthy
        ? response.usage
        : { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd,
      retryCount,
      latencyMs: totalProcessingLatency(),
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
    if (providerDispatchCount > 0) await settleProviderCost();
    await releaseQuotaReservation();
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      if (runCreated) {
        try {
          await dependencies.repository.deleteDetailedData(
            runId,
            clock().toISOString(),
            async (documentKey) => {
              await dependencies.documentStore.deleteDocument(documentKey);
            },
          );
        } catch {
          // The repository tombstone is the access-control boundary.
        }
      }
      return;
    }
    const safe = publicError(error, currentStage);
    if (currentStageStartedAt !== null) {
      stepDurations[currentStage] = Math.max(
        0,
        processingClock() - currentStageStartedAt,
      );
      currentStageStartedAt = null;
    } else if (stepDurations[currentStage] === undefined) {
      stepDurations[currentStage] = 0;
    }
    if (runCreated) {
      try {
        await dependencies.repository.markFailed(runId, {
          timestamp: clock().toISOString(),
          safeCode: safe.code,
          failedStage: currentStage,
          retryCount,
          latencyMs: totalProcessingLatency(),
          stepDurations,
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
      deletionToken: deletionCredential.token,
      timestamp: clock().toISOString(),
    };
  }
}
