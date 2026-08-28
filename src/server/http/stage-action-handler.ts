import type { HttpContainer } from "@/server/http/container";
import {
  attachBucketCookie,
  resolveAnonymousBucket,
} from "@/server/http/anonymous-bucket";
import { serializeActionProposal } from "@/server/http/public-serialization";
import {
  noIndexHeaders,
  safeErrorResponse,
  safeJsonResponse,
} from "@/server/http/responses";

function validRunId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

export async function handleStageActionPost(
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
          code: "stage_action_rate_limited",
          message: "Action staging was requested too frequently. Retry shortly.",
          requestId,
          status: 429,
          headers: noIndexHeaders,
        }),
      );
    }

    const result = await container.repository.stageAction(
      parameters.id,
      container.clock(),
    );
    if (result.status === "staged" || result.status === "already_staged") {
      return respond(
        safeJsonResponse(
          {
            staging: {
              status: result.status,
              action: serializeActionProposal(result.action),
            },
          },
          { status: 200, headers: noIndexHeaders },
        ),
      );
    }

    const errors = {
      not_found: {
        code: "run_not_found",
        message: "The requested run is unavailable.",
        status: 404,
      },
      unavailable: {
        code: "action_unavailable",
        message: "This run does not have an action that can be staged.",
        status: 409,
      },
      blocked: {
        code: "action_blocked",
        message: "Required evidence is incomplete so this action remains blocked.",
        status: 409,
      },
      expired: {
        code: "run_expired",
        message: "This run has expired and can no longer stage an action.",
        status: 410,
      },
      deleted: {
        code: "run_deleted",
        message: "This run was deleted and can no longer stage an action.",
        status: 410,
      },
    } as const;
    const error = errors[result.status];
    return respond(
      safeErrorResponse({
        ...error,
        requestId,
        headers: noIndexHeaders,
      }),
    );
  } catch {
    return respond(
      safeErrorResponse({
        code: "stage_action_unavailable",
        message: "The action could not be staged safely.",
        requestId,
        status: 503,
        headers: noIndexHeaders,
      }),
    );
  }
}
