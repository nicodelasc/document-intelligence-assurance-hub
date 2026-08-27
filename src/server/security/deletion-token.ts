import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RunRepository } from "@/server/repositories/run-repository";
import type { DocumentStore } from "@/server/storage/document-store";

const HASH_PREFIX = "sha256:";

export type DeletionCredential = {
  token: string;
  hash: string;
};

export function hashDeletionToken(token: string): string {
  return `${HASH_PREFIX}${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

export function createDeletionCredential(): DeletionCredential {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashDeletionToken(token) };
}

export function verifyDeletionToken(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashDeletionToken(token), "utf8");
  const stored = Buffer.from(storedHash, "utf8");

  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export async function deleteRunNow(input: {
  repository: RunRepository;
  documentStore: DocumentStore;
  runId: string;
  token: string;
  now: Date;
}): Promise<"deleted" | "unauthorized" | "not_found"> {
  const storedHash = await input.repository.getDeletionTokenHash(input.runId);
  if (!storedHash) return "not_found";
  if (!verifyDeletionToken(input.token, storedHash)) return "unauthorized";
  const deleted = await input.repository.deleteDetailedData(
    input.runId,
    input.now.toISOString(),
    async (documentKey) => {
      await input.documentStore.deleteDocument(documentKey);
    },
  );
  return deleted ? "deleted" : "not_found";
}
