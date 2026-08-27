import type { HttpContainer } from "@/server/http/container";
import { serializePublicRunDetail } from "@/server/http/public-serialization";
import {
  noIndexHeaders,
  safeErrorResponse,
  safeJsonResponse,
} from "@/server/http/responses";
import { deleteRunNow } from "@/server/security/deletion-token";
import {
  attachBucketCookie,
  resolveAnonymousBucket,
} from "@/server/http/anonymous-bucket";

function validRunId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

export async function handleRunGet(
  request: Request,
  parameters: { id: string },
  container: HttpContainer,
): Promise<Response> {
  const requestId = container.requestIdSource();
  if (!validRunId(parameters.id)) {
    return safeErrorResponse({
      code: "run_not_found",
      message: "The requested run is unavailable.",
      requestId,
      status: 404,
      headers: noIndexHeaders,
    });
  }
  const bucket = resolveAnonymousBucket(request, {
    tokenSource: container.bucketTokenSource,
    secure: process.env.NODE_ENV === "production",
  });
  const respond = (response: Response) => attachBucketCookie(response, bucket);
  try {
    if (
      !(await container.abuseControl.allowPublicRead({
        bucket: bucket.protectedBucket,
        resource: "run_detail",
        resourceId: parameters.id,
        now: container.clock(),
      }))
    ) {
      return respond(
        safeErrorResponse({
          code: "run_detail_rate_limited",
          message: "This public trace has been requested too frequently. Retry shortly.",
          requestId,
          status: 429,
          headers: noIndexHeaders,
        }),
      );
    }
    const run = await container.repository.readPublicRun(parameters.id, container.clock());
    if (!run) {
      return respond(
        safeErrorResponse({
          code: "run_not_found",
          message: "The requested run is unavailable.",
          requestId,
          status: 404,
          headers: noIndexHeaders,
        }),
      );
    }
    return respond(
      safeJsonResponse(
        { run: serializePublicRunDetail(run) },
        { status: 200, headers: noIndexHeaders },
      ),
    );
  } catch {
    return respond(
      safeErrorResponse({
        code: "run_unavailable",
        message: "The requested run is temporarily unavailable.",
        requestId,
        status: 503,
        headers: noIndexHeaders,
      }),
    );
  }
}

export async function handleRunDelete(
  request: Request,
  parameters: { id: string },
  container: HttpContainer,
): Promise<Response> {
  const requestId = container.requestIdSource();
  const token = request.headers.get("x-delete-token")?.trim();
  if (!token || token.length > 512 || !validRunId(parameters.id)) {
    return safeErrorResponse({
      code: "delete_not_authorized",
      message: "The deletion request could not be authorized.",
      requestId,
      status: 401,
      headers: noIndexHeaders,
    });
  }

  try {
    const result = await deleteRunNow({
      repository: container.repository,
      documentStore: container.documentStore,
      runId: parameters.id,
      token,
      now: container.clock(),
    });
    if (result === "unauthorized" || result === "not_found" || result === "deleted") {
      return safeJsonResponse(
        { deletion: { status: "accepted", runId: parameters.id } },
        { status: 202, headers: noIndexHeaders },
      );
    }
  } catch {
    return safeErrorResponse({
      code: "delete_temporarily_unavailable",
      message: "Deletion is temporarily unavailable. Retry with the same token.",
      requestId,
      status: 503,
      headers: noIndexHeaders,
    });
  }
  return safeErrorResponse({
    code: "delete_temporarily_unavailable",
    message: "Deletion is temporarily unavailable. Retry with the same token.",
    requestId,
    status: 503,
    headers: noIndexHeaders,
  });
}
