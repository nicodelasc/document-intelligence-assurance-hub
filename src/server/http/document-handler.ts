import type { HttpContainer } from "@/server/http/container";
import {
  documentNoStoreHeaders,
  safeErrorResponse,
} from "@/server/http/responses";

function validRunId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function safeHeaderFilename(filename: string, mediaType: string): string {
  const beforeLineBreak = filename.split(/[\r\n]/, 1)[0];
  const basename = beforeLineBreak.split(/[\\/]/).at(-1) ?? "document";
  const cleaned = basename
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  if (cleaned) return cleaned;
  return mediaType === "application/pdf"
    ? "document.pdf"
    : mediaType === "image/png"
      ? "document.png"
      : "document.jpg";
}

function unavailableDocument(
  requestId: string,
  status: 404 | 410 | 503,
): Response {
  return safeErrorResponse({
    code: status === 503 ? "document_temporarily_unavailable" : "document_unavailable",
    message:
      status === 503
        ? "The document is temporarily unavailable."
        : "The document is no longer available.",
    requestId,
    status,
    headers: documentNoStoreHeaders,
  });
}

export async function handleRunDocumentGet(
  _request: Request,
  parameters: { id: string },
  container: HttpContainer,
): Promise<Response> {
  const requestId = container.requestIdSource();
  if (!validRunId(parameters.id)) return unavailableDocument(requestId, 404);
  try {
    const run = await container.repository.readPublicRun(parameters.id, container.clock());
    if (!run) return unavailableDocument(requestId, 404);
    if (run.status === "expired" || run.status === "deleted") {
      return unavailableDocument(requestId, 410);
    }
    const mediaType = run.file.mediaType;
    if (
      mediaType !== "application/pdf" &&
      mediaType !== "image/png" &&
      mediaType !== "image/jpeg"
    ) {
      return unavailableDocument(requestId, 404);
    }
    const recheckNow = container.clock();
    if (Date.parse(run.expiresAt) <= recheckNow.getTime()) {
      return unavailableDocument(requestId, 410);
    }
    const document = await container.documentStore.fetchActiveDocument({
      key: `runs/${run.id}/document`,
      expiresAt: run.expiresAt,
      now: recheckNow,
    });
    if (!document) return unavailableDocument(requestId, 404);
    const headers = new Headers(documentNoStoreHeaders);
    headers.set("content-type", mediaType);
    headers.set("content-length", String(document.sizeBytes));
    headers.set(
      "content-disposition",
      `inline; filename="${safeHeaderFilename(run.file.filename, mediaType)}"`,
    );
    return new Response(Buffer.from(document.bytes), { status: 200, headers });
  } catch {
    return unavailableDocument(requestId, 503);
  }
}
