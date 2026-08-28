import { describe, expect, it } from "vitest";
import { InMemoryDocumentStore } from "@/server/storage/document-store";
import { InMemoryRunRepository } from "@/server/repositories/run-repository";
import { purgeExpiredRuns } from "@/server/storage/document-store";

describe("InMemoryDocumentStore", () => {
  it("serves private bytes only while the application retention window is active", async () => {
    const store = new InMemoryDocumentStore();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const stored = await store.storePrivateDocument({
      key: "runs/run-1/invoice.pdf",
      bytes,
      contentType: "application/pdf",
    });

    expect(stored).toEqual({ key: "runs/run-1/invoice.pdf", contentType: "application/pdf", sizeBytes: 4 });
    const active = await store.fetchActiveDocument({
      key: stored.key,
      expiresAt: "2026-08-27T23:55:00.000Z",
      now: new Date("2026-08-27T23:54:59.999Z"),
    });
    expect(active?.bytes).toEqual(bytes);

    expect(
      await store.fetchActiveDocument({
        key: stored.key,
        expiresAt: "2026-08-27T23:55:00.000Z",
        now: new Date("2026-08-27T23:55:00.000Z"),
      }),
    ).toBeNull();
  });

  it("deletes a stored object idempotently", async () => {
    const store = new InMemoryDocumentStore();
    await store.storePrivateDocument({
      key: "runs/run-1/invoice.pdf",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
    });

    await expect(store.deleteDocument("runs/run-1/invoice.pdf")).resolves.toBe(true);
    await expect(store.deleteDocument("runs/run-1/invoice.pdf")).resolves.toBe(false);
  });

  it("purges expired document bytes and detailed records together without double counting", async () => {
    const store = new InMemoryDocumentStore();
    const repository = new InMemoryRunRepository();
    const key = "runs/run-1/invoice.pdf";
    await store.storePrivateDocument({
      key,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
    });
    await repository.createRun({
      id: "run-1",
      provider: "openai",
      model: "gpt-5-mini",
      promptVersion: "recorded-fixture-2026-08-27.v1",
      executionMode: "recorded",
      providerDispatched: false,
      sourceType: "synthetic",
      file: { filename: "invoice.pdf", mediaType: "application/pdf", sizeBytes: 3, pageCount: 1 },
      documentKey: key,
      requestedFields: [{ key: "invoice_total", label: "Invoice total" }],
      status: "completed",
      outcome: "clear",
      usage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      consent: false,
      createdAt: "2026-08-27T00:00:00.000Z",
      expiresAt: "2026-08-27T23:55:00.000Z",
      deletedAt: null,
      deletionTokenHash: `sha256:${"c".repeat(64)}`,
      retryCount: 0,
      latencyMs: 0,
      stepDurations: {},
    });

    const first = await purgeExpiredRuns(repository, store, new Date("2026-08-27T23:55:00.000Z"));
    const second = await purgeExpiredRuns(repository, store, new Date("2026-08-28T00:00:00.000Z"));

    expect(first.purgedRunIds).toEqual(["run-1"]);
    expect(first.failedRunIds).toEqual([]);
    expect(second.purgedRunIds).toEqual([]);
    expect(await store.deleteDocument(key)).toBe(false);
    expect((await repository.aggregateAnonymousUsage()).totalRuns).toBe(1);
  });
});
