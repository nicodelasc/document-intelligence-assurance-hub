import type { HttpContainer } from "@/server/http/container";
import { serializePublicRunDetail } from "@/server/http/public-serialization";
import {
  noIndexHeaders,
  safeErrorResponse,
  safeJsonResponse,
} from "@/server/http/responses";
import { deleteRunNow } from "@/server/security/deletion-token";

function validRunId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

export async function handleRunGet(
  _request: Request,
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
  try {
    const run = await container.repository.readPublicRun(parameters.id, container.clock());
    if (!run) {
      return safeErrorResponse({
        code: "run_not_found",
        message: "The requested run is unavailable.",
        requestId,
        status: 404,
        headers: noIndexHeaders,
      });
    }
    return safeJsonResponse(
      { run: serializePublicRunDetail(run) },
      { status: 200, headers: noIndexHeaders },
    );
  } catch {
    return safeErrorResponse({
      code: "run_unavailable",
      message: "The requested run is temporarily unavailable.",
      requestId,
      status: 503,
      headers: noIndexHeaders,
    });
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
    await deleteRunNow({
      repository: container.repository,
      documentStore: container.documentStore,
      runId: parameters.id,
      token,
      now: container.clock(),
    });
  } catch {
    // The generic accepted response avoids disclosing record or storage state.
  }
  return safeJsonResponse(
    { deletion: { status: "accepted", runId: parameters.id } },
    { status: 202, headers: noIndexHeaders },
  );
}
