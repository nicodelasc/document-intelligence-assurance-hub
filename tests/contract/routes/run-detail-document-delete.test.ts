import { describe, expect, it } from "vitest";
import { hashDeletionToken } from "@/server/security/deletion-token";
import type { StoredRunRecord } from "@/server/repositories/run-repository";
import {
  handleRunDelete,
  handleRunGet,
} from "@/server/http/run-detail-handler";
import { handleRunDocumentGet } from "@/server/http/document-handler";
import {
  createTestContainer,
  makePdf,
  readLines,
  syntheticRequest,
} from "./test-support";
import { handleRunsPost } from "@/server/http/runs-handler";
import { InMemoryDocumentStore } from "@/server/storage/document-store";

async function completedRun(container: ReturnType<typeof createTestContainer>) {
  const response = await handleRunsPost(syntheticRequest(), container);
  const events = await readLines(response);
  const completed = events.find(
    (event) => typeof event === "object" && event !== null && (event as { type?: string }).type === "completed",
  ) as { runId: string; deletionToken: string };
  return completed;
}

describe("run detail retention", () => {
  it("returns active trace details without a deletion credential", async () => {
    const container = createTestContainer();
    const completed = await completedRun(container);

    const response = await handleRunGet(
      new Request(`http://local.test/api/runs/${completed.runId}`),
      { id: completed.runId },
      container,
    );
    const text = await response.text();
    const body = JSON.parse(text) as { run: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(body.run).toMatchObject({ status: "completed", documentUrl: `/api/runs/${completed.runId}/document` });
    expect(body.run).toHaveProperty("details");
    expect(text).not.toContain(completed.deletionToken);
    expect(text).not.toContain("deletionTokenHash");
  });

  it("removes detail and document access at read-time expiry", async () => {
    let now = new Date("2026-08-27T00:00:00.000Z");
    const container = createTestContainer({ clock: () => now });
    const completed = await completedRun(container);
    now = new Date("2026-08-28T00:00:00.000Z");

    const detailResponse = await handleRunGet(
      new Request(`http://local.test/api/runs/${completed.runId}`),
      { id: completed.runId },
      container,
    );
    const detailText = await detailResponse.text();
    const documentResponse = await handleRunDocumentGet(
      new Request(`http://local.test/api/runs/${completed.runId}/document`),
      { id: completed.runId },
      container,
    );

    expect(detailResponse.status).toBe(200);
    expect(JSON.parse(detailText)).toEqual({
      run: {
        id: completed.runId,
        status: "expired",
        expiresAt: "2026-08-27T23:55:00.000Z",
        deletedAt: null,
      },
    });
    expect(detailText).not.toContain("filename");
    expect(detailText).not.toContain("requestedFields");
    expect(detailText).not.toContain("documentUrl");
    expect(documentResponse.status).toBe(410);
    expect(documentResponse.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(documentResponse.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});

describe("document streaming", () => {
  it("uses safe headers and an injection-safe inline filename", async () => {
    const container = createTestContainer();
    const id = "document-header-run";
    const deletionToken = "delete-token";
    const bytes = makePdf(1);
    const record: StoredRunRecord = {
      id,
      provider: "openai",
      model: "gpt-5-mini",
      promptVersion: "recorded-fixture-2026-08-27.v1",
      executionMode: "recorded",
      sourceType: "custom",
      file: {
        filename: "invoice\"\r\nX-Injected: true.pdf",
        mediaType: "application/pdf",
        sizeBytes: bytes.byteLength,
        pageCount: 1,
      },
      documentKey: `runs/${id}/document`,
      requestedFields: [
        { key: "vendor_name", label: "Vendor name" },
        { key: "invoice_total", label: "Invoice total" },
      ],
      status: "completed",
      outcome: "evidence_consistent",
      usage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      consent: true,
      createdAt: "2026-08-27T00:00:00.000Z",
      expiresAt: "2026-08-27T23:55:00.000Z",
      deletedAt: null,
      deletionTokenHash: hashDeletionToken(deletionToken),
      retryCount: 0,
      latencyMs: 10,
      stepDurations: { validating: 1 },
    };
    await container.repository.createRun(record);
    await container.documentStore.storePrivateDocument({
      key: `runs/${id}/document`,
      bytes,
      contentType: "application/pdf",
    });

    const response = await handleRunDocumentGet(
      new Request(`http://local.test/api/runs/${id}/document`),
      { id },
      container,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(response.headers.get("content-disposition")).not.toContain("\r");
    expect(response.headers.get("content-disposition")).not.toContain("\n");
    expect(response.headers.get("content-disposition")).not.toContain("X-Injected");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});

describe("DELETE /api/runs/[id]", () => {
  it("uses a generic idempotent response while only a valid token deletes details", async () => {
    const container = createTestContainer();
    const completed = await completedRun(container);
    const requestUrl = `http://local.test/api/runs/${completed.runId}`;

    const wrongResponse = await handleRunDelete(
      new Request(requestUrl, { method: "DELETE", headers: { "x-delete-token": "wrong-token" } }),
      { id: completed.runId },
      container,
    );
    expect((await container.repository.readPublicRun(completed.runId, container.clock()))?.status).toBe("completed");

    const successResponse = await handleRunDelete(
      new Request(requestUrl, { method: "DELETE", headers: { "x-delete-token": completed.deletionToken } }),
      { id: completed.runId },
      container,
    );
    expect((await container.repository.readPublicRun(completed.runId, container.clock()))?.status).toBe("deleted");

    const repeatedResponse = await handleRunDelete(
      new Request(requestUrl, { method: "DELETE", headers: { "x-delete-token": completed.deletionToken } }),
      { id: completed.runId },
      container,
    );

    expect(wrongResponse.status).toBe(202);
    expect(successResponse.status).toBe(202);
    expect(repeatedResponse.status).toBe(202);
    expect(await wrongResponse.text()).toBe(await successResponse.text());
    expect(await repeatedResponse.json()).toEqual({
      deletion: { status: "accepted", runId: completed.runId },
    });
  });

  it("rejects a missing token with a generic safe error", async () => {
    const container = createTestContainer();
    const response = await handleRunDelete(
      new Request("http://local.test/api/runs/unknown", { method: "DELETE" }),
      { id: "unknown" },
      container,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "delete_not_authorized",
        message: "The deletion request could not be authorized.",
        requestId: "request-test-1",
      },
    });
  });

  it("returns a retriable safe error when authorized deletion cannot reach storage", async () => {
    class FailingDeleteStore extends InMemoryDocumentStore {
      override async deleteDocument(): Promise<boolean> {
        throw new Error("private_blob_failure");
      }
    }
    const container = createTestContainer({ documentStore: new FailingDeleteStore() });
    const completed = await completedRun(container);

    const response = await handleRunDelete(
      new Request(`http://local.test/api/runs/${completed.runId}`, {
        method: "DELETE",
        headers: { "x-delete-token": completed.deletionToken },
      }),
      { id: completed.runId },
      container,
    );
    const body = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("delete_temporarily_unavailable");
    expect(body.error.message).not.toContain("private_blob_failure");
    expect((await container.repository.readPublicRun(completed.runId, container.clock()))?.status).toBe("completed");
  });
});
