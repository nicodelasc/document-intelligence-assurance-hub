import type { HttpContainer } from "@/server/http/container";
import { invalidateMetricsCache } from "@/server/http/metrics-handler";
import {
  attachBucketCookie,
  resolveAnonymousBucket,
} from "@/server/http/anonymous-bucket";
import { serializeActionProposal } from "@/server/http/public-serialization";
import {
  allowedWorkflowActionsForRun,
  workflowStatusForAction,
} from "@/domain/workflow-actions";
import {
  noIndexHeaders,
  safeErrorResponse,
  safeJsonResponse,
} from "@/server/http/responses";
import { verifyDeletionToken } from "@/server/security/deletion-token";

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
          message:
            "Posting handoff preparation was requested too frequently. Retry shortly.",
          requestId,
          status: 429,
          headers: noIndexHeaders,
        }),
      );
    }

    const capability = request.headers.get("x-run-capability")?.trim();
    const storedCapabilityHash =
      capability && capability.length <= 512
        ? await container.repository.getDeletionTokenHash(parameters.id)
        : null;
    if (
      !capability ||
      !storedCapabilityHash ||
      !verifyDeletionToken(capability, storedCapabilityHash)
    ) {
      return respond(
        safeErrorResponse({
          code: "stage_action_not_authorized",
          message:
            "This browser does not hold the capability required to prepare the posting handoff.",
          requestId,
          status: 401,
          headers: noIndexHeaders,
        }),
      );
    }

    const now = container.clock();
    const run = await container.repository.readPublicRun(parameters.id, now);
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
    if (run.status === "expired" || run.status === "deleted") {
      return respond(
        safeErrorResponse({
          code: run.status === "expired" ? "run_expired" : "run_deleted",
          message:
            run.status === "expired"
              ? "This run has expired and can no longer prepare a posting handoff."
              : "This run was deleted and can no longer prepare a posting handoff.",
          requestId,
          status: 410,
          headers: noIndexHeaders,
        }),
      );
    }
    const action = run.details?.result?.action;
    if (run.status !== "completed" || !action) {
      return respond(
        safeErrorResponse({
          code: "action_unavailable",
          message:
            "This run does not have a posting handoff that can be prepared.",
          requestId,
          status: 409,
          headers: noIndexHeaders,
        }),
      );
    }
    if (action.status === "blocked") {
      return respond(
        safeErrorResponse({
          code: "action_blocked",
          message:
            "Required evidence is incomplete so this action remains blocked.",
          requestId,
          status: 409,
          headers: noIndexHeaders,
        }),
      );
    }
    if (
      !allowedWorkflowActionsForRun({
        status: run.status,
        outcome: run.outcome,
        documentClassification:
          run.details?.result?.documentClassification ?? null,
        sourceOriginStatus: run.sourceOriginStatus,
      }).includes("approve_and_stage")
    ) {
      return respond(
        safeErrorResponse({
          code: "action_unavailable",
          message:
            "This run does not have a posting handoff that can be prepared.",
          requestId,
          status: 409,
          headers: noIndexHeaders,
        }),
      );
    }

    const eventStatus = workflowStatusForAction("approve_and_stage");
    const result = await container.repository.createWorkflowEvent({
      runId: parameters.id,
      action: "approve_and_stage",
      recipientRole: null,
      status: eventStatus,
      now,
      eventId: container.requestIdSource(),
    });
    if (result.status === "created" || result.status === "already_created") {
      const historicalStagedEvent =
        result.status === "already_created" && result.event.status === "staged";
      if (
        result.event.runId !== parameters.id ||
        result.event.action !== "approve_and_stage" ||
        result.event.recipientRole !== null ||
        (result.event.status !== eventStatus && !historicalStagedEvent)
      ) {
        throw new Error("stage_action_event_conflict");
      }
      if (result.status === "created") {
        invalidateMetricsCache(container.repository);
      }
      return respond(
        safeJsonResponse(
          {
            handoff: {
              status:
                result.status === "created"
                  ? eventStatus
                  : historicalStagedEvent
                    ? "historical_staged"
                    : "already_prepared",
              action: serializeActionProposal({
                ...action,
                stagedAt: null,
              }),
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
        message:
          "This run does not have a posting handoff that can be prepared.",
        status: 409,
      },
      expired: {
        code: "run_expired",
        message:
          "This run has expired and can no longer prepare a posting handoff.",
        status: 410,
      },
      deleted: {
        code: "run_deleted",
        message:
          "This run was deleted and can no longer prepare a posting handoff.",
        status: 410,
      },
    } as const;
    if (result.status === "id_collision") {
      throw new Error("stage_action_event_conflict");
    }
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
        message: "The posting handoff could not be prepared safely.",
        requestId,
        status: 503,
        headers: noIndexHeaders,
      }),
    );
  }
}
