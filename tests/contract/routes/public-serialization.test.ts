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
    providerDispatched: false,
    sourceType: "synthetic",
    documentFamily: "supplier_invoice",
    fixtureId: "invoice-clean-match",
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
      workflowEvents: [],
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
  it("returns not-called actual attribution plus explicit recorded configuration", () => {
    const listRow = serializePublicRunListRow(poisonedRun());
    const detail = serializePublicRunDetail(poisonedRun());

    for (const serialized of [listRow, detail]) {
      expect(serialized).toMatchObject({
        providerCalled: false,
        provider: null,
        model: null,
        configuredProvider: "openai",
        configuredModel: "gpt-5-mini",
      });
    }
  });

  it("returns actual attribution for a live provider call", () => {
    const run = poisonedRun();
    run.executionMode = "live";
    run.providerDispatched = true;
    run.provider = "anthropic";
    run.model = "claude-sonnet-5";

    expect(serializePublicRunListRow(run)).toMatchObject({
      providerCalled: true,
      provider: "anthropic",
      model: "claude-sonnet-5",
      configuredProvider: "anthropic",
      configuredModel: "claude-sonnet-5",
    });
    expect(serializePublicRunDetail(run)).toMatchObject({
      providerCalled: true,
      provider: "anthropic",
      model: "claude-sonnet-5",
      configuredProvider: "anthropic",
      configuredModel: "claude-sonnet-5",
    });
  });

  it("does not attribute a configured live run before confirmed dispatch", () => {
    const run = poisonedRun();
    run.executionMode = "live";
    run.provider = "anthropic";
    run.model = "claude-sonnet-5";

    expect(serializePublicRunDetail(run)).toMatchObject({
      providerCalled: false,
      provider: null,
      model: null,
      configuredProvider: "anthropic",
      configuredModel: "claude-sonnet-5",
    });
  });

  it("serializes active fixture identity in detail and list rows", () => {
    const active = serializePublicRunDetail(poisonedRun());
    expect(active).toMatchObject({
      documentFamily: "supplier_invoice",
      fixtureId: "invoice-clean-match",
    });

    const listRun = poisonedRun();
    const poisonedIdentity = listRun as unknown as {
      documentFamily: string;
      fixtureId: string;
    };
    poisonedIdentity.documentFamily = "supplier_invoice\r\n";
    poisonedIdentity.fixtureId = "invoice-clean-match\u0000";
    expect(serializePublicRunListRow(listRun)).toMatchObject({
      documentFamily: "supplier_invoice",
      fixtureId: "invoice-clean-match",
      providerCalled: false,
      provider: null,
      model: null,
    });
  });

  it.each(["expired", "deleted"] as const)(
    "returns only minimal metadata for %s records",
    (status) => {
      const run = poisonedRun();
      run.status = status;

      expect(serializePublicRunDetail(run)).toEqual({
        id: "run-safe-1",
        status,
        expiresAt: "2026-08-27T23:55:00.000Z",
        deletedAt: null,
      });
    },
  );

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

  it("allow-lists bounded workflow event fields and strips role controls", () => {
    const run = poisonedRun();
    run.details!.workflowEvents = [
      {
        id: "event-safe\u0000",
        runId: "run-safe-1\r\n",
        action: "prepare_email",
        recipientRole: `Buyer\r\n${"x".repeat(100)}`,
        status: "prepared",
        createdAt: "2026-08-27T00:05:00.000Z",
        emailAddress: "must-not-leak@example.com",
        subject: "must-not-leak",
        body: "must-not-leak",
        systemPrompt: "must-not-leak",
      } as never,
    ];

    const serialized = serializePublicRunDetail(run) as unknown as {
      details: { workflowEvents: Array<Record<string, unknown>> };
    };
    const event = serialized.details.workflowEvents[0]!;

    expect(event).toEqual({
      id: "event-safe",
      runId: "run-safe-1",
      action: "prepare_email",
      recipientRole: `Buyer${"x".repeat(75)}`,
      status: "prepared",
      createdAt: "2026-08-27T00:05:00.000Z",
    });
    expect(String(event.recipientRole)).toHaveLength(80);
    expect(JSON.stringify(serialized)).not.toMatch(
      /emailAddress|must-not-leak|systemPrompt/,
    );
    expect(serializePublicRunListRow(run)).not.toHaveProperty("workflowEvents");
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
