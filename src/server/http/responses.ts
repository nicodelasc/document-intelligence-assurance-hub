import { runEventSchema } from "@/domain/run-schema";
import type { FieldResult, RunEvent } from "@/domain/types";

export const noStoreHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export const noIndexHeaders = {
  ...noStoreHeaders,
  "X-Robots-Tag": "noindex, nofollow",
} as const;

export const documentNoStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function safeJsonResponse(
  value: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  for (const [key, value] of Object.entries(noStoreHeaders)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(safeJsonStringify(value), { ...init, headers });
}

export function safeErrorResponse(input: {
  code: string;
  message: string;
  requestId: string;
  status: number;
  headers?: HeadersInit;
}): Response {
  return safeJsonResponse(
    {
      error: {
        code: input.code,
        message: input.message,
        requestId: input.requestId,
      },
    },
    { status: input.status, headers: input.headers },
  );
}

function fieldEvent(field: FieldResult): FieldResult {
  return {
    key: field.key,
    label: field.label,
    extractedValue: field.extractedValue,
    normalizedValue: field.normalizedValue,
    evidence: field.evidence,
    page: field.page,
    evaluatorStatus: field.evaluatorStatus,
    referenceMatch: field.referenceMatch,
  };
}

function allowListedEvent(event: RunEvent): RunEvent {
  switch (event.type) {
    case "stage":
      return { type: "stage", stage: event.stage, timestamp: event.timestamp };
    case "field":
      return { type: "field", field: fieldEvent(event.field), timestamp: event.timestamp };
    case "completed":
      return {
        type: "completed",
        outcome: event.outcome,
        runId: event.runId,
        executionMode: event.executionMode,
        deletionToken: event.deletionToken,
        timestamp: event.timestamp,
      };
    case "failed":
      return {
        type: "failed",
        code: event.code,
        message: event.message,
        ...(event.runId === undefined ? {} : { runId: event.runId }),
        ...(event.deletionToken === undefined ? {} : { deletionToken: event.deletionToken }),
        timestamp: event.timestamp,
      };
  }
}

export function ndjsonRunResponse(
  events: AsyncIterable<RunEvent>,
  input: { clock: () => Date; headers?: HeadersInit },
): Response {
  const encoder = new TextEncoder();
  const headers = new Headers(input.headers);
  headers.set("content-type", "application/x-ndjson; charset=utf-8");
  for (const [key, value] of Object.entries(noIndexHeaders)) headers.set(key, value);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let terminal = false;
      let deletionReceiptEmitted = false;
      try {
        for await (const candidate of events) {
          if (terminal) break;
          const event = allowListedEvent(candidate);
          const hasDeletionReceipt =
            (event.type === "completed" || event.type === "failed") &&
            "deletionToken" in event &&
            event.deletionToken !== undefined;
          if (hasDeletionReceipt && deletionReceiptEmitted) {
            throw new Error("duplicate_deletion_receipt");
          }
          const parsed = runEventSchema.parse(event);
          controller.enqueue(encoder.encode(`${safeJsonStringify(parsed)}\n`));
          if (hasDeletionReceipt) deletionReceiptEmitted = true;
          terminal = parsed.type === "completed" || parsed.type === "failed";
        }
      } catch {
        if (!terminal) {
          const failure = runEventSchema.parse({
            type: "failed",
            code: "stream_failed",
            message: "The run stream ended safely.",
            timestamp: input.clock().toISOString(),
          });
          controller.enqueue(encoder.encode(`${safeJsonStringify(failure)}\n`));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { status: 200, headers });
}
