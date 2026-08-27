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

function quotaError(reason: string, requestId: string): Response {
  const messages: Record<string, string> = {
    custom_upload_limit: "This browser has reached the daily custom-upload limit.",
    global_custom_upload_limit: "The public daily custom-upload limit has been reached.",
    live_run_limit: "This browser has reached the daily live-run limit.",
    recorded_run_limit: "This browser has reached the daily recorded-replay limit.",
    global_recorded_run_limit: "The public daily recorded-replay limit has been reached.",
    daily_budget: "The daily live model budget is unavailable.",
    live_disabled:
      "Live processing is disabled. Choose a synthetic recorded replay to continue.",
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
    if (input.sourceType === "custom" && input.executionMode === "recorded") {
      return attachBucketCookie(
        safeErrorResponse({
          code: "recorded_custom_unavailable",
          message:
            "Recorded mode cannot extract a custom document. Choose a synthetic recorded replay or enable live processing.",
          requestId,
          status: 409,
          headers: noIndexHeaders,
        }),
        bucket,
      );
    }
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
    let provider;
    try {
      provider = await container.createProvider({
        provider: input.provider,
        executionMode: input.executionMode,
        sampleId: input.sample?.id ?? null,
      });
    } catch {
      if (quota.reservationId) {
        await container.quotaRepository.releaseLiveReservation(quota.reservationId);
      }
      throw new Error("provider_initialization_failed");
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
        provider,
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
  request: Request,
  container: HttpContainer,
): Promise<Response> {
  const requestId = container.requestIdSource();
  try {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const rawOffset = url.searchParams.get("offset");
    const requestedLimit = rawLimit === null ? 20 : Number(rawLimit);
    const requestedOffset = rawOffset === null ? 0 : Number(rawOffset);
    if (
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      !Number.isInteger(requestedOffset) ||
      requestedOffset < 0 ||
      requestedOffset > 10_000
    ) {
      return safeErrorResponse({
        code: "invalid_pagination",
        message: "Pagination values must be bounded non-negative integers.",
        requestId,
        status: 400,
        headers: noIndexHeaders,
      });
    }
    const limit = Math.min(50, requestedLimit);
    const runs = await container.repository.listPublicRuns(container.clock(), {
      limit,
      offset: requestedOffset,
      includeDetails: false,
    });
    return safeJsonResponse(
      {
        runs: runs.map(serializePublicRunListRow),
        pagination: { limit, offset: requestedOffset, returned: runs.length },
      },
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
