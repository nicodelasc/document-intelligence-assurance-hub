import { describe, expect, it } from "vitest";
import { syntheticFixtures } from "@/domain/fixtures";
import type { PublicRunRecord } from "@/server/repositories/run-repository";
import {
  serializePublicRunDetail,
  serializePublicRunListRow,
} from "@/server/http/public-serialization";
import { ndjsonRunResponse } from "@/server/http/responses";
import type { RunEvent } from "@/domain/types";

function poisonedRun(): PublicRunRecord {
  return {
    id: "run-safe-1",
    provider: "openai",
    model: "gpt-5-mini",
    promptVersion: "prompt-public-v1",
    executionMode: "recorded",
    sourceType: "custom",
    file: {
      filename: "invoice.pdf",
      mediaType: "application/pdf",
      sizeBytes: 120,
      pageCount: 1,
    },
    requestedFields: [{ key: "vendor_name", label: "Vendor name" }],
    status: "completed",
    outcome: "evidence_consistent",
    usage: { inputTokens: 0, outputTokens: 0 },
    estimatedCostUsd: 0,
    consent: true,
    createdAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2026-08-27T23:55:00.000Z",
    deletedAt: null,
    retryCount: 0,
    latencyMs: 12,
    stepDurations: { validating: 1 },
    details: {
      steps: [
        {
          kind: "stage",
          stage: "validating",
          timestamp: "2026-08-27T00:00:00.000Z",
          durationMs: 1,
        },
      ],
      result: {
        fields: [
          {
            key: "vendor_name",
            label: "Vendor name",
            extractedValue: "Example Supplier",
            normalizedValue: "Example Supplier",
            evidence: "Supplier: Example Supplier",
            page: 1,
            evaluatorStatus: "pass",
            referenceMatch: null,
          },
        ],
        outcome: "evidence_consistent",
        documentInstruction: null,
        action: structuredClone(syntheticFixtures[1].action),
        usage: { inputTokens: 0, outputTokens: 0 },
        estimatedCostUsd: 0,
        retryCount: 0,
        latencyMs: 12,
        stepDurations: { validating: 1 },
        completedAt: "2026-08-27T00:00:00.012Z",
      },
    },
    deletionTokenHash: "sha256:must-not-leak",
    documentKey: "secret-storage-key",
    systemPrompt: "hidden full system prompt",
    reasoning: "hidden chain of thought",
    apiKey: "must-not-leak",
  } as PublicRunRecord;
}

describe("public serializers", () => {
  it("allow-lists active detail fields even when the source object is poisoned", () => {
    const serialized = JSON.stringify(serializePublicRunDetail(poisonedRun()));

    expect(serialized).toContain("prompt-public-v1");
    expect(serialized).toContain("Example Supplier");
    expect(serialized).not.toContain("deletionTokenHash");
    expect(serialized).not.toContain("documentKey");
    expect(serialized).not.toContain("systemPrompt");
    expect(serialized).not.toContain("reasoning");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("must-not-leak");
  });

  it("keeps a legacy result readable when it predates action persistence", () => {
    const run = poisonedRun();
    const legacyResult = run.details?.result as
      | (Record<string, unknown> & { action?: unknown })
      | null
      | undefined;
    delete legacyResult?.action;

    expect(() => serializePublicRunDetail(run)).not.toThrow();
    expect(serializePublicRunDetail(run)).toMatchObject({
      details: { result: { outcome: "evidence_consistent" } },
    });
  });

  it("keeps list rows anonymous while exposing only the active safe filename", () => {
    const serialized = JSON.stringify(serializePublicRunListRow(poisonedRun()));

    expect(serialized).toContain("run-safe-1");
    expect(serialized).toContain("recorded");
    expect(serialized).toContain("invoice.pdf");
    expect(serialized).not.toContain("Example Supplier");
    expect(serialized).not.toContain("requestedFields");
    expect(serialized).not.toContain("details");
  });

  it("omits filenames from expired and deleted list rows", () => {
    const run = poisonedRun();
    run.status = "expired";

    expect(serializePublicRunListRow(run)).not.toHaveProperty("filename");
    run.status = "deleted";
    expect(serializePublicRunListRow(run)).not.toHaveProperty("filename");
  });

  it("returns only minimal metadata for expired records", () => {
    const run = poisonedRun();
    run.status = "expired";
    const serialized = serializePublicRunDetail(run);

    expect(serialized).toEqual({
      id: "run-safe-1",
      status: "expired",
      expiresAt: "2026-08-27T23:55:00.000Z",
      deletedAt: null,
    });
  });

  it("aborts the workflow iterator when the response stream is cancelled", async () => {
    const abortController = new AbortController();
    let iteratorFinalized = false;
    async function* events(): AsyncGenerator<RunEvent> {
      try {
        yield {
          type: "stage",
          stage: "validating",
          timestamp: "2026-08-27T00:00:00.000Z",
        };
        await new Promise<never>((_resolve, reject) => {
          abortController.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      } finally {
        iteratorFinalized = true;
      }
    }
    const response = ndjsonRunResponse(events(), {
      clock: () => new Date("2026-08-27T00:00:00.000Z"),
      abortController,
    });
    const reader = response.body!.getReader();

    await reader.read();
    await reader.cancel("client disconnected");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(abortController.signal.aborted).toBe(true);
    expect(iteratorFinalized).toBe(true);
  });
});
