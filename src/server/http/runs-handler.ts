import {
  MultipartInputError,
  parseRunMultipart,
} from "@/server/http/multipart";
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
import { invalidateMetricsCache } from "@/server/http/metrics-handler";
import { estimateMaximumLiveRunCost } from "@/domain/pricing";
import { createHash } from "node:crypto";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

async function* invalidateMetricsAfterRun<T>(
  events: AsyncIterable<T>,
  repository: object,
): AsyncGenerator<T> {
  try {
    for await (const event of events) yield event;
  } finally {
    invalidateMetricsCache(repository);
  }
}

type RunPreflight = {
  sourceType: "synthetic" | "custom";
  executionMode: "recorded" | "live";
};

function runPreflight(request: Request): RunPreflight | null | "invalid" {
  const sourceType = request.headers.get("x-run-source-type");
  const executionMode = request.headers.get("x-run-execution-mode");
  if (sourceType === null && executionMode === null) {
    return request.headers
      .get("content-type")
      ?.toLocaleLowerCase()
      .startsWith("multipart/form-data")
      ? "invalid"
      : null;
  }
  if (
    (sourceType !== "synthetic" && sourceType !== "custom") ||
    (executionMode !== "recorded" && executionMode !== "live")
  ) {
    return "invalid";
  }
  return { sourceType, executionMode };
}

function idempotentRunId(idempotencyKey: string): string {
  return `run_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 48)}`;
}

function quotaError(reason: string, requestId: string): Response {
  const messages: Record<string, string> = {
    custom_upload_limit:
      "This browser has reached the daily custom-upload limit.",
    global_custom_upload_limit:
      "The public daily custom-upload limit has been reached.",
    live_run_limit: "This browser has reached the daily live-run limit.",
    recorded_run_limit: "This browser has reached the daily demo-run limit.",
    global_recorded_run_limit:
      "The public daily demo-run limit has been reached.",
    daily_budget: "The daily live model budget is unavailable.",
    live_disabled:
      "Live processing is disabled. Choose a synthetic sample to continue.",
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
  let claimedRunId: string | null = null;
  let workflowStarted = false;
  try {
    if (
      !(await container.abuseControl.allowRunSubmission({
        bucket: bucket.protectedBucket,
        now: container.clock(),
      }))
    ) {
      return attachBucketCookie(
        safeErrorResponse({
          code: "run_request_rate_limited",
          message: "Too many run requests were received. Retry shortly.",
          requestId,
          status: 429,
          headers: noIndexHeaders,
        }),
        bucket,
      );
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return attachBucketCookie(
        safeErrorResponse({
          code: "invalid_idempotency_key",
          message: "Provide one valid idempotency key for this submission.",
          requestId,
          status: 400,
          headers: noIndexHeaders,
        }),
        bucket,
      );
    }
    const preflight = runPreflight(request);
    if (preflight === "invalid") {
      return attachBucketCookie(
        safeErrorResponse({
          code: "invalid_run_preflight",
          message: "Run admission metadata is incomplete or invalid.",
          requestId,
          status: 400,
          headers: noIndexHeaders,
        }),
        bucket,
      );
    }
    const input = await parseRunMultipart(request, container);
    if (
      preflight &&
      (preflight.sourceType !== input.sourceType ||
        preflight.executionMode !== input.executionMode)
    ) {
      return attachBucketCookie(
        safeErrorResponse({
          code: "run_preflight_mismatch",
          message:
            "Run admission metadata does not match the multipart request.",
          requestId,
          status: 400,
          headers: noIndexHeaders,
        }),
        bucket,
      );
    }
    const providerAvailable = container.providerAvailability[input.provider];
    const executionMode = providerAvailable ? "live" : "recorded";
    if (input.sourceType === "custom" && !providerAvailable) {
      return attachBucketCookie(quotaError("live_disabled", requestId), bucket);
    }

    claimedRunId = idempotentRunId(idempotencyKey);
    const claimNow = container.clock();
    const claimed = await container.repository.claimRunRequest(
      claimedRunId,
      new Date(claimNow.getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
      claimNow,
    );
    if (!claimed) {
      return attachBucketCookie(
        safeErrorResponse({
          code: "duplicate_submission",
          message: "This submission was already accepted.",
          requestId,
          status: 409,
          headers: noIndexHeaders,
        }),
        bucket,
      );
    }

    let provider;
    try {
      provider = await container.createProvider({
        provider: input.provider,
        model: input.model,
        executionMode,
        sampleId: input.fixture?.id ?? null,
      });
    } catch {
      await container.repository.releaseRunRequest(claimedRunId);
      claimedRunId = null;
      throw new Error("provider_initialization_failed");
    }
    const quota = await container.quotaRepository.reserve({
      bucket: bucket.protectedBucket,
      sourceType: input.sourceType,
      executionMode,
      estimatedCostUsd:
        executionMode === "live"
          ? estimateMaximumLiveRunCost(provider.provider, provider.model)
          : 0,
      liveEnabled: providerAvailable,
      now: container.clock(),
    });
    if (!quota.allowed) {
      await container.repository.releaseRunRequest(claimedRunId);
      claimedRunId = null;
      return attachBucketCookie(quotaError(quota.reason, requestId), bucket);
    }

    const abortController = new AbortController();
    if (request.signal.aborted) {
      abortController.abort(request.signal.reason);
    } else {
      request.signal.addEventListener(
        "abort",
        () => abortController.abort(request.signal.reason),
        { once: true },
      );
    }

    const events = invalidateMetricsAfterRun(
      container.execute(
        {
          sourceType: input.sourceType,
          sourceOriginStatus: input.sourceOriginStatus,
          file: input.file,
          requestedFields: input.requestedFields,
          consent: input.consent,
          referenceData: input.referenceData,
          fixture: input.fixture,
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
          idSource: () => claimedRunId!,
          abortSignal: abortController.signal,
          clock: container.clock,
          replayStageDelayMs: container.replayStageDelayMs,
        },
      ),
      container.repository,
    );
    workflowStarted = true;
    return attachBucketCookie(
      ndjsonRunResponse(events, { clock: container.clock, abortController }),
      bucket,
    );
  } catch (error) {
    if (claimedRunId && !workflowStarted) {
      await container.repository
        .releaseRunRequest(claimedRunId)
        .catch(() => undefined);
    }
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
  const bucket = resolveAnonymousBucket(request, {
    tokenSource: container.bucketTokenSource,
    secure: process.env.NODE_ENV === "production",
  });
  const respond = (response: Response) => attachBucketCookie(response, bucket);
  try {
    if (
      !(await container.abuseControl.allowPublicRead({
        bucket: bucket.protectedBucket,
        resource: "run_list",
        now: container.clock(),
      }))
    ) {
      return respond(
        safeErrorResponse({
          code: "run_list_rate_limited",
          message:
            "Run history has been requested too frequently. Retry shortly.",
          requestId,
          status: 429,
          headers: noIndexHeaders,
        }),
      );
    }
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
      return respond(
        safeErrorResponse({
          code: "invalid_pagination",
          message: "Pagination values must be bounded non-negative integers.",
          requestId,
          status: 400,
          headers: noIndexHeaders,
        }),
      );
    }
    const limit = Math.min(50, requestedLimit);
    const runs = await container.repository.listPublicRuns(container.clock(), {
      limit,
      offset: requestedOffset,
      includeDetails: false,
    });
    return respond(
      safeJsonResponse(
        {
          runs: runs.map(serializePublicRunListRow),
          pagination: { limit, offset: requestedOffset, returned: runs.length },
        },
        { status: 200, headers: noIndexHeaders },
      ),
    );
  } catch {
    return respond(
      safeErrorResponse({
        code: "runs_unavailable",
        message: "Run history is temporarily unavailable.",
        requestId,
        status: 503,
        headers: noIndexHeaders,
      }),
    );
  }
}
