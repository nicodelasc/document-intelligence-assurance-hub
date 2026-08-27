import type {
  PurgeExpiredResult,
  RunRepository,
} from "@/server/repositories/run-repository";

export type StoreDocumentInput = {
  key: string;
  bytes: Uint8Array;
  contentType: string;
};

export type StoredDocument = {
  key: string;
  contentType: string;
  sizeBytes: number;
};

export type ActiveDocument = StoredDocument & {
  bytes: Uint8Array;
};

export interface DocumentStore {
  storePrivateDocument(input: StoreDocumentInput): Promise<StoredDocument>;
  fetchActiveDocument(input: { key: string; expiresAt: string; now: Date }): Promise<ActiveDocument | null>;
  deleteDocument(key: string): Promise<boolean>;
}

export class StorageConfigurationError extends Error {
  readonly name = "StorageConfigurationError";
}

type BlobAccessOptions = {
  access: "private";
  token: string;
  useCache?: false;
  contentType?: string;
  addRandomSuffix?: false;
  allowOverwrite?: true;
};

export interface BlobDriver {
  put(key: string, bytes: Uint8Array, options: BlobAccessOptions): Promise<void>;
  get(
    key: string,
    options: BlobAccessOptions,
  ): Promise<{ bytes: Uint8Array; contentType: string; sizeBytes: number } | null>;
  del(key: string, options: { token: string }): Promise<void>;
}

const vercelBlobDriver: BlobDriver = {
  async put(key, bytes, options) {
    const { put } = await import("@vercel/blob");
    await put(key, Buffer.from(bytes), {
      access: options.access,
      token: options.token,
      contentType: options.contentType,
      addRandomSuffix: options.addRandomSuffix,
      allowOverwrite: options.allowOverwrite,
    });
  },
  async get(key, options) {
    const { get } = await import("@vercel/blob");
    const result = await get(key, {
      access: options.access,
      token: options.token,
      useCache: options.useCache,
    });
    if (!result || result.statusCode !== 200) return null;
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    return {
      bytes,
      contentType: result.blob.contentType,
      sizeBytes: result.blob.size,
    };
  },
  async del(key, options) {
    const { del } = await import("@vercel/blob");
    await del(key, { token: options.token });
  },
};

export function createVercelBlobDocumentStore(options: {
  token: string | undefined;
  driver?: BlobDriver;
}): DocumentStore {
  const driver = options.driver ?? vercelBlobDriver;
  const requireToken = (): string => {
    if (!options.token) throw new StorageConfigurationError("blob_storage_not_configured");
    return options.token;
  };

  return {
    async storePrivateDocument(input) {
      const token = requireToken();
      await driver.put(input.key, input.bytes, {
        access: "private",
        token,
        contentType: input.contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return {
        key: input.key,
        contentType: input.contentType,
        sizeBytes: input.bytes.byteLength,
      };
    },
    async fetchActiveDocument(input) {
      if (Date.parse(input.expiresAt) <= input.now.getTime()) return null;
      const token = requireToken();
      const result = await driver.get(input.key, {
        access: "private",
        token,
        useCache: false,
      });
      return result ? { key: input.key, ...result } : null;
    },
    async deleteDocument(key) {
      const token = requireToken();
      await driver.del(key, { token });
      return true;
    },
  };
}

export class InMemoryDocumentStore implements DocumentStore {
  private readonly documents = new Map<string, ActiveDocument>();

  async storePrivateDocument(input: StoreDocumentInput): Promise<StoredDocument> {
    const stored: ActiveDocument = {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      bytes: input.bytes.slice(),
    };
    this.documents.set(input.key, stored);
    return { key: stored.key, contentType: stored.contentType, sizeBytes: stored.sizeBytes };
  }

  async fetchActiveDocument(input: {
    key: string;
    expiresAt: string;
    now: Date;
  }): Promise<ActiveDocument | null> {
    if (Date.parse(input.expiresAt) <= input.now.getTime()) return null;
    const document = this.documents.get(input.key);
    if (!document) return null;
    return { ...document, bytes: document.bytes.slice() };
  }

  async deleteDocument(key: string): Promise<boolean> {
    return this.documents.delete(key);
  }
}

export async function purgeExpiredRuns(
  repository: RunRepository,
  documentStore: DocumentStore,
  now: Date,
): Promise<PurgeExpiredResult> {
  return repository.purgeExpiredData(now, async (documentKey) => {
    await documentStore.deleteDocument(documentKey);
  });
}
