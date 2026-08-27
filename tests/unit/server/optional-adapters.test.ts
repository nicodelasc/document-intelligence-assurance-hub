import { describe, expect, it, vi } from "vitest";
import {
  StorageConfigurationError,
  createVercelBlobDocumentStore,
  type BlobDriver,
} from "@/server/storage/document-store";
import {
  PersistenceConfigurationError,
  createNeonRunRepository,
} from "@/server/repositories/run-repository";

describe("optional connected storage adapters", () => {
  it("constructs without environment credentials then fails closed only when Blob work is requested", async () => {
    const store = createVercelBlobDocumentStore({ token: undefined });

    await expect(
      store.storePrivateDocument({
        key: "runs/run-1/document",
        bytes: new Uint8Array([1]),
        contentType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(StorageConfigurationError);
  });

  it("forces private Blob reads and writes and enforces expiry before calling the remote store", async () => {
    const put = vi.fn(async () => undefined);
    const get = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
      sizeBytes: 3,
    }));
    const del = vi.fn(async () => undefined);
    const driver: BlobDriver = { put, get, del };
    const store = createVercelBlobDocumentStore({ token: "unit-test-placeholder", driver });

    await store.storePrivateDocument({
      key: "runs/run-1/document",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
    });
    const active = await store.fetchActiveDocument({
      key: "runs/run-1/document",
      expiresAt: "2026-08-27T23:55:00.000Z",
      now: new Date("2026-08-27T23:54:59.999Z"),
    });
    const expired = await store.fetchActiveDocument({
      key: "runs/run-1/document",
      expiresAt: "2026-08-27T23:55:00.000Z",
      now: new Date("2026-08-27T23:55:00.000Z"),
    });

    expect(active?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(expired).toBeNull();
    expect(put).toHaveBeenCalledWith(
      "runs/run-1/document",
      new Uint8Array([1, 2, 3]),
      expect.objectContaining({ access: "private", token: "unit-test-placeholder" }),
    );
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(
      "runs/run-1/document",
      expect.objectContaining({ access: "private", token: "unit-test-placeholder", useCache: false }),
    );
  });

  it("constructs the Neon repository without a database URL then fails closed on first query", async () => {
    const repository = createNeonRunRepository({ databaseUrl: undefined });

    await expect(repository.aggregateAnonymousUsage()).rejects.toBeInstanceOf(
      PersistenceConfigurationError,
    );
  });
});
