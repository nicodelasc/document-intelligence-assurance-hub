import { describe, expect, it } from "vitest";
import { InMemoryRunRepository } from "@/server/repositories/run-repository";

const createdAt = "2026-08-27T00:00:00.000Z";
const expiresAt = "2026-08-27T23:55:00.000Z";

function runRecord(id = "run-1") {
  return {
    id,
    provider: "openai" as const,
    model: "gpt-5-mini",
    promptVersion: "recorded-fixture-2026-08-27.v1",
    executionMode: "recorded" as const,
    sourceType: "synthetic" as const,
    file: {
      filename: "clean-match-invoice.pdf",
      mediaType: "application/pdf",
      sizeBytes: 2048,
      pageCount: 1,
    },
    documentKey: `runs/${id}/clean-match-invoice.pdf`,
    requestedFields: [
      { key: "vendor_name", label: "Vendor name" },
      { key: "purchase_order_number", label: "Purchase-order number" },
      { key: "invoice_total", label: "Invoice total" },
    ],
    status: "validating" as const,
    outcome: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    estimatedCostUsd: 0,
    consent: false,
    createdAt,
    expiresAt,
    deletedAt: null,
    deletionTokenHash: `sha256:${"a".repeat(64)}`,
    retryCount: 0,
    latencyMs: null,
    stepDurations: {},
  };
}

const fields = [
  {
    key: "vendor_name",
    label: "Vendor name",
    extractedValue: "Northstar Paperworks",
    normalizedValue: "Northstar Paperworks",
    evidence: "Supplier: Northstar Paperworks",
    page: 1,
    evaluatorStatus: "pass" as const,
    referenceMatch: true,
  },
];

describe("InMemoryRunRepository", () => {
  it("returns details while active then only safe expired metadata before physical purge", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun(runRecord());
    await repository.appendStep("run-1", {
      kind: "stage",
      stage: "extracting",
      timestamp: "2026-08-27T00:00:01.000Z",
      durationMs: 25,
    });
    await repository.saveResults("run-1", {
      fields,
      outcome: "clear",
      usage: { inputTokens: 100, outputTokens: 25 },
      estimatedCostUsd: 0.000075,
      retryCount: 0,
      latencyMs: 420,
      stepDurations: { extracting: 220 },
      completedAt: "2026-08-27T00:00:02.000Z",
    });

    const active = await repository.readPublicRun("run-1", new Date("2026-08-27T23:54:59.999Z"));
    expect(active?.status).toBe("completed");
    expect(active?.details?.result.fields).toEqual(fields);
    expect(active?.details?.steps).toHaveLength(1);

    const serialized = JSON.stringify(active);
    expect(serialized).not.toContain("deletionTokenHash");
    expect(serialized).not.toContain("sha256:");
    expect(serialized).not.toMatch(/systemPrompt|reasoning|apiKey/i);

    const expired = await repository.readPublicRun("run-1", new Date(expiresAt));
    expect(expired?.status).toBe("expired");
    expect(expired?.details).toBeUndefined();
    expect(expired?.outcome).toBe("clear");
    expect(expired?.file.filename).toBe("expired-document");
    expect(expired?.requestedFields).toEqual([]);
  });

  it("purges detailed data idempotently while anonymous aggregates survive", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun(runRecord());
    await repository.saveResults("run-1", {
      fields,
      outcome: "clear",
      usage: { inputTokens: 100, outputTokens: 25 },
      estimatedCostUsd: 0.000075,
      retryCount: 0,
      latencyMs: 420,
      stepDurations: { extracting: 220 },
      completedAt: "2026-08-27T00:00:02.000Z",
    });

    const first = await repository.purgeExpiredData(new Date(expiresAt));
    const second = await repository.purgeExpiredData(new Date("2026-08-28T00:00:00.000Z"));

    expect(first).toEqual({
      purgedRunIds: ["run-1"],
      documentKeys: ["runs/run-1/clean-match-invoice.pdf"],
    });
    expect(second).toEqual({ purgedRunIds: [], documentKeys: [] });
    expect(await repository.getDeletionTokenHash("run-1")).toBeNull();
    expect(await repository.aggregateAnonymousUsage()).toMatchObject({
      totalRuns: 1,
      completedRuns: 1,
      failedRuns: 0,
      totalInputTokens: 100,
      totalOutputTokens: 25,
      providerCounts: { openai: 1, anthropic: 0 },
      outcomeCounts: { clear: 1 },
    });
  });
});
