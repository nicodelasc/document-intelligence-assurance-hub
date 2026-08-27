import { timingSafeEqual } from "node:crypto";
import type { HttpContainer } from "@/server/http/container";
import {
  noIndexHeaders,
  safeErrorResponse,
  safeJsonResponse,
} from "@/server/http/responses";
import { purgeExpiredRuns } from "@/server/storage/document-store";
import { invalidateMetricsCache } from "@/server/http/metrics-handler";

function exactSecretMatch(candidate: string | null, expected: string): boolean {
  if (candidate === null) return false;
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (candidateBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(candidateBytes, expectedBytes);
}

export async function handlePurgeExpiredGet(
  request: Request,
  container: HttpContainer,
): Promise<Response> {
  const requestId = container.requestIdSource();
  if (!container.cronSecret) {
    return safeErrorResponse({
      code: "cron_not_configured",
      message: "Expiry cleanup is not configured.",
      requestId,
      status: 503,
      headers: noIndexHeaders,
    });
  }
  if (
    !exactSecretMatch(
      request.headers.get("authorization"),
      `Bearer ${container.cronSecret}`,
    )
  ) {
    return safeErrorResponse({
      code: "cron_not_authorized",
      message: "The cleanup request could not be authorized.",
      requestId,
      status: 401,
      headers: noIndexHeaders,
    });
  }
  try {
    const purged = await purgeExpiredRuns(
      container.repository,
      container.documentStore,
      container.clock(),
    );
    invalidateMetricsCache(container.repository);
    return safeJsonResponse(
      {
        purge: {
          purgedRuns: purged.purgedRunIds.length,
          purgedDocuments: purged.documentKeys.length,
          safeFailures: purged.failedRunIds.length,
        },
      },
      { status: 200, headers: noIndexHeaders },
    );
  } catch {
    return safeErrorResponse({
      code: "purge_failed",
      message: "Expiry cleanup could not complete safely.",
      requestId,
      status: 500,
      headers: noIndexHeaders,
    });
  }
}
