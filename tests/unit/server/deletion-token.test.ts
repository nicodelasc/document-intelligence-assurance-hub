import { describe, expect, it } from "vitest";
import {
  createDeletionCredential,
  deleteRunNow,
  verifyDeletionToken,
} from "@/server/security/deletion-token";
import { InMemoryRunRepository } from "@/server/repositories/run-repository";
import { InMemoryDocumentStore } from "@/server/storage/document-store";

describe("deletion credentials", () => {
  it("issues a different opaque token each time and stores only a fixed-length hash", () => {
    const first = createDeletionCredential();
    const second = createDeletionCredential();

    expect(first.token).not.toBe(second.token);
    expect(first.hash).not.toBe(second.hash);
    expect(first.hash).not.toContain(first.token);
    expect(first.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("accepts only the original token without throwing on malformed stored hashes", () => {
    const credential = createDeletionCredential();

    expect(verifyDeletionToken(credential.token, credential.hash)).toBe(true);
    expect(verifyDeletionToken(`${credential.token}x`, credential.hash)).toBe(false);
    expect(verifyDeletionToken(credential.token, "sha256:short")).toBe(false);
  });

  it("deletes the document and detailed trace only for the one-time uploader token", async () => {
    const credential = createDeletionCredential();
    const repository = new InMemoryRunRepository();
    const documentStore = new InMemoryDocumentStore();
    const documentKey = "runs/run-1/document";
    await documentStore.storePrivateDocument({
      key: documentKey,
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
      sourceType: "custom",
      file: { filename: "invoice.pdf", mediaType: "application/pdf", sizeBytes: 3, pageCount: 1 },
      documentKey,
      requestedFields: [{ key: "invoice_total", label: "Invoice total" }],
      status: "completed",
      outcome: "evidence_consistent",
      usage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      consent: true,
      createdAt: "2026-08-27T00:00:00.000Z",
      expiresAt: "2026-08-27T23:55:00.000Z",
      deletedAt: null,
      deletionTokenHash: credential.hash,
      retryCount: 0,
      latencyMs: 0,
      stepDurations: {},
    });

    await expect(
      deleteRunNow({
        repository,
        documentStore,
        runId: "run-1",
        token: "wrong-token",
        now: new Date("2026-08-27T01:00:00.000Z"),
      }),
    ).resolves.toBe("unauthorized");
    await expect(
      deleteRunNow({
        repository,
        documentStore,
        runId: "run-1",
        token: credential.token,
        now: new Date("2026-08-27T01:00:00.000Z"),
      }),
    ).resolves.toBe("deleted");
    expect(await repository.getDeletionTokenHash("run-1")).toBeNull();
    expect(await documentStore.deleteDocument(documentKey)).toBe(false);
  });
});
