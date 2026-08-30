import {
  workflowActionRequestSchema,
  workflowEventSchema,
} from "@/domain/run-schema";
import type {
  EmailPreview,
  WorkflowActionRequest,
  WorkflowEvent,
} from "@/domain/types";
import {
  allowedWorkflowActionsForRun,
  createEmailPreview,
  recipientRoleAllowed,
  workflowStatusForAction,
} from "@/domain/workflow-actions";
import {
  attachBucketCookie,
  resolveAnonymousBucket,
} from "@/server/http/anonymous-bucket";
import type { HttpContainer } from "@/server/http/container";
import { invalidateMetricsCache } from "@/server/http/metrics-handler";
import { serializePublicRunDetail } from "@/server/http/public-serialization";
import {
  noIndexHeaders,
  safeErrorResponse,
  safeJsonResponse,
} from "@/server/http/responses";
import type {
  CreateWorkflowEventResult,
  PublicRunRecord,
} from "@/server/repositories/run-repository";
import { verifyDeletionToken } from "@/server/security/deletion-token";

function validRunId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

async function parseWorkflowActionRequest(
  request: Request,
): Promise<
  { success: true; data: WorkflowActionRequest } | { success: false }
> {
  try {
    const parsed = workflowActionRequestSchema.safeParse(await request.json());
    return parsed.success
      ? { success: true, data: parsed.data }
      : { success: false };
  } catch {
    return { success: false };
  }
}

function publicEvent(event: WorkflowEvent): WorkflowEvent {
  return workflowEventSchema.parse({
    id: event.id,
    runId: event.runId,
    action: event.action,
    recipientRole: event.recipientRole,
    status: event.status,
    createdAt: event.createdAt,
  });
}

function eventMatchesRequest(
  result: Extract<
    CreateWorkflowEventResult,
    { status: "created" | "already_created" }
  >,
  runId: string,
  request: WorkflowActionRequest,
): boolean {
  return (
    result.event.runId === runId &&
    result.event.action === request.action &&
    result.event.recipientRole === request.recipientRole &&
    result.event.status === workflowStatusForAction(request.action)
  );
}

function emailPreviewForRun(
  run: PublicRunRecord,
  request: WorkflowActionRequest,
): EmailPreview | null {
  if (request.action !== "prepare_email") return null;
  if (
    run.status !== "completed" ||
    run.outcome === null ||
    request.recipientRole === null
  ) {
    return null;
  }
  const serialized = serializePublicRunDetail(run);
  if (!("details" in serialized) || serialized.details?.result === null) {
    return null;
  }
  const serializedFields = serialized.details?.result?.fields;
  if (!Array.isArray(serializedFields)) return null;
  return createEmailPreview({
    runId: run.id,
    outcome: run.outcome,
    recipientRole: request.recipientRole,
    fields: serializedFields,
  });
}

function lifecycleError(
  status: "expired" | "deleted",
  requestId: string,
): Response {
  return safeErrorResponse({
    code: status === "expired" ? "run_expired" : "run_deleted",
    message:
      status === "expired"
        ? "This run has expired and cannot accept workflow actions."
        : "This run was deleted and cannot accept workflow actions.",
    requestId,
    status: 410,
    headers: noIndexHeaders,
  });
}

function workflowUnavailable(requestId: string, status: 409 | 503): Response {
  return safeErrorResponse({
    code: "workflow_unavailable",
    message:
      status === 409
        ? "This run is not available for the requested workflow action."
        : "The workflow action is temporarily unavailable.",
    requestId,
    status,
    headers: noIndexHeaders,
  });
}

export async function handleWorkflowActionPost(
  request: Request,
  parameters: { id: string },
  container: HttpContainer,
): Promise<Response> {
  const requestId = container.requestIdSource();
  if (!validRunId(parameters.id)) {
    return workflowUnavailable(requestId, 409);
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
          code: "workflow_rate_limited",
          message:
            "Workflow actions have been requested too frequently. Retry shortly.",
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
          code: "workflow_not_authorized",
          message:
            "This browser does not hold the capability required for workflow actions.",
          requestId,
          status: 401,
          headers: noIndexHeaders,
        }),
      );
    }

    const parsedRequest = await parseWorkflowActionRequest(request);
    if (!parsedRequest.success) {
      return respond(
        safeErrorResponse({
          code: "workflow_request_invalid",
          message: "The workflow action request is invalid.",
          requestId,
          status: 400,
          headers: noIndexHeaders,
        }),
      );
    }

    const actionRequest = parsedRequest.data;
    const now = container.clock();
    const run = await container.repository.readPublicRun(parameters.id, now);
    if (!run) return respond(workflowUnavailable(requestId, 409));
    if (run.status === "expired" || run.status === "deleted") {
      return respond(lifecycleError(run.status, requestId));
    }
    if (
      (run.status !== "completed" && run.status !== "failed") ||
      run.details === undefined
    ) {
      return respond(workflowUnavailable(requestId, 409));
    }

    const allowedActions = allowedWorkflowActionsForRun({
      status: run.status,
      outcome: run.outcome,
      documentClassification:
        run.details.result?.documentClassification ?? null,
    });
    if (!allowedActions.includes(actionRequest.action)) {
      return respond(
        safeErrorResponse({
          code: "workflow_action_not_allowed",
          message: "This workflow action is not allowed for the run outcome.",
          requestId,
          status: 409,
          headers: noIndexHeaders,
        }),
      );
    }
    if (
      !recipientRoleAllowed(
        actionRequest.action,
        run.documentFamily,
        actionRequest.recipientRole,
      )
    ) {
      return respond(
        safeErrorResponse({
          code: "workflow_recipient_not_allowed",
          message: "Select an allowed recipient role for this action.",
          requestId,
          status: 400,
          headers: noIndexHeaders,
        }),
      );
    }

    const emailPreview = emailPreviewForRun(run, actionRequest);
    if (actionRequest.action === "prepare_email" && emailPreview === null) {
      return respond(workflowUnavailable(requestId, 409));
    }

    const result = await container.repository.createWorkflowEvent({
      runId: parameters.id,
      action: actionRequest.action,
      recipientRole: actionRequest.recipientRole,
      status: workflowStatusForAction(actionRequest.action),
      now,
      eventId: container.requestIdSource(),
    });
    if (result.status === "created" || result.status === "already_created") {
      if (!eventMatchesRequest(result, parameters.id, actionRequest)) {
        return respond(
          safeErrorResponse({
            code: "workflow_event_conflict",
            message: "The workflow event could not be created safely. Retry.",
            requestId,
            status: 503,
            headers: noIndexHeaders,
          }),
        );
      }
      if (result.status === "created") {
        invalidateMetricsCache(container.repository);
      }
      return respond(
        safeJsonResponse(
          {
            workflow: {
              status: result.status,
              event: publicEvent(result.event),
            },
            ...(emailPreview === null ? {} : { emailPreview }),
          },
          { status: 200, headers: noIndexHeaders },
        ),
      );
    }
    if (result.status === "expired" || result.status === "deleted") {
      return respond(lifecycleError(result.status, requestId));
    }
    if (result.status === "id_collision") {
      return respond(
        safeErrorResponse({
          code: "workflow_event_conflict",
          message: "The workflow event could not be created safely. Retry.",
          requestId,
          status: 503,
          headers: noIndexHeaders,
        }),
      );
    }
    return respond(workflowUnavailable(requestId, 409));
  } catch {
    return respond(workflowUnavailable(requestId, 503));
  }
}
