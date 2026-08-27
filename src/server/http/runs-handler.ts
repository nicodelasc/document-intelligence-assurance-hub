import type { ExtractionProvider } from "@/server/workflow/provider";
import { validateExtractionForRequest } from "@/server/workflow/provider";
import { createRecordedExtractionProvider } from "@/server/workflow/recorded-provider";
import type { ParsedRunRequest } from "@/server/http/multipart";
import { MultipartInputError, parseRunMultipart } from "@/server/http/multipart";
import type { HttpContainer } from "@/server/http/container";
import {
  attachBucketCookie,
  resolveAnonymousBucket,
} from "@/server/http/anonymous-bucket";
import {
  ndjsonRunResponse,
  noIndexHeaders,
  safeErrorResponse,
  safeJsonResponse,
} from "@/server/http/responses";
import { serializePublicRunListRow } from "@/server/http/public-serialization";

function customRecordedProvider(input: ParsedRunRequest): ExtractionProvider {
  return {
    provider: input.provider,
    model: input.provider === "openai" ? "gpt-5-mini" : "claude-haiku-4-5",
    promptVersion: "recorded-custom-no-extraction-2026-08-27.v1",
    executionMode: "recorded",
    async extract(request) {
      const extraction = validateExtractionForRequest(
        {
          fields: request.requestedFields.map((field) => ({
            key: field.key,
            label: field.label,
            extractedValue: null,
            normalizedValue: null,
            evidence: null,
            page: null,
          })),
        },
        request.requestedFields,
      );
      return { extraction, usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 0 };
    },
  };
}

function recordedProvider(input: ParsedRunRequest): ExtractionProvider {
  if (!input.sample) return customRecordedProvider(input);
  return createRecordedExtractionProvider({
    provider: input.provider,
    fixtureId: input.sample.id,
  });
}

function quotaError(reason: string, requestId: string): Response {
  const messages: Record<string, string> = {
    custom_upload_limit: "This browser has reached the daily custom-upload limit.",
    live_run_limit: "This browser has reached the daily live-run limit.",
    daily_budget: "The daily live model budget is unavailable.",
    live_disabled: "Live processing is disabled. A recorded replay remains available.",
  };
  return safeErrorResponse({
    code: reason,
    message: messages[reason] ?? "The run quota is unavailable.",
    requestId,
    status: reason === "live_disabled" ? 503 : 429,
    headers: noIndexHeaders,
  });
}

export async function handleRunsPost(
  request: Request,
  container: HttpContainer,
): Promise<Response> {
  const requestId = container.requestIdSource();
  const bucket = resolveAnonymousBucket(request, {
    tokenSource: container.bucketTokenSource,
    secure: process.env.NODE_ENV === "production",
  });
  try {
    const input = await parseRunMultipart(request, container);
    if (input.executionMode === "live" && !container.liveModeEnabled) {
      return attachBucketCookie(quotaError("live_disabled", requestId), bucket);
    }

    const quota = await container.quotaRepository.reserve({
      bucket: bucket.protectedBucket,
      sourceType: input.sourceType,
      executionMode: input.executionMode,
      estimatedCostUsd: 0,
      liveEnabled: container.liveModeEnabled,
      now: container.clock(),
    });
    if (!quota.allowed) {
      return attachBucketCookie(quotaError(quota.reason, requestId), bucket);
    }
    if (input.executionMode !== "recorded") {
      if (quota.reservationId) {
        await container.quotaRepository.releaseLiveReservation(quota.reservationId);
      }
      return attachBucketCookie(quotaError("live_disabled", requestId), bucket);
    }

    const events = container.execute(
      {
        sourceType: input.sourceType,
        file: input.file,
        requestedFields: input.requestedFields,
        consent: input.consent,
        referenceData: input.referenceData,
      },
      {
        repository: container.repository,
        quotaReservation:
          quota.reservationId === null
            ? undefined
            : {
                repository: container.quotaRepository,
                reservationId: quota.reservationId,
              },
        documentStore: container.documentStore,
        provider: recordedProvider(input),
        clock: container.clock,
        replayStageDelayMs: container.replayStageDelayMs,
      },
    );
    return attachBucketCookie(
      ndjsonRunResponse(events, { clock: container.clock }),
      bucket,
    );
  } catch (error) {
    if (error instanceof MultipartInputError) {
      return attachBucketCookie(
        safeErrorResponse({
          code: error.code,
          message: error.safeMessage,
          requestId,
          status: error.status,
          headers: noIndexHeaders,
        }),
        bucket,
      );
    }
    return attachBucketCookie(
      safeErrorResponse({
        code: "run_request_failed",
        message: "The run request could not be prepared safely.",
        requestId,
        status: 500,
        headers: noIndexHeaders,
      }),
      bucket,
    );
  }
}

export async function handleRunsGet(
  _request: Request,
  container: HttpContainer,
): Promise<Response> {
  const requestId = container.requestIdSource();
  try {
    const runs = await container.repository.listPublicRuns(container.clock());
    return safeJsonResponse(
      { runs: runs.map(serializePublicRunListRow) },
      { status: 200, headers: noIndexHeaders },
    );
  } catch {
    return safeErrorResponse({
      code: "runs_unavailable",
      message: "Run history is temporarily unavailable.",
      requestId,
      status: 503,
      headers: noIndexHeaders,
    });
  }
}
