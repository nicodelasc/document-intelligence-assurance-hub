import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createNeonRunRepository,
  InMemoryRunRepository,
  type RunRepository,
} from "@/server/repositories/run-repository";
import {
  createNeonQuotaRepository,
  InMemoryQuotaRepository,
  type QuotaRepository,
} from "@/server/security/rate-limit";
import {
  createVercelBlobDocumentStore,
  InMemoryDocumentStore,
  type DocumentStore,
} from "@/server/storage/document-store";
import { executeRun, type ExecuteRunInput, type ExecuteRunDependencies } from "@/server/workflow/execute-run";
import type { RunEvent } from "@/domain/types";
import { defaultBucketTokenSource } from "@/server/http/anonymous-bucket";

export type HttpContainer = {
  repository: RunRepository;
  quotaRepository: QuotaRepository;
  documentStore: DocumentStore;
  clock: () => Date;
  requestIdSource: () => string;
  bucketTokenSource: () => string;
  replayStageDelayMs: number;
  liveModeEnabled: boolean;
  cronSecret: string | undefined;
  execute: (
    input: ExecuteRunInput,
    dependencies: ExecuteRunDependencies,
  ) => AsyncGenerator<RunEvent>;
  loadSyntheticDocument: (filename: string) => Promise<Uint8Array>;
};

type Environment = Record<string, string | undefined>;

export function createDefaultHttpContainer(
  environment: Environment = process.env,
): HttpContainer {
  const databaseUrl = environment.DATABASE_URL;
  const blobToken = environment.BLOB_READ_WRITE_TOKEN;
  return {
    repository: databaseUrl
      ? createNeonRunRepository({ databaseUrl })
      : new InMemoryRunRepository(),
    quotaRepository: databaseUrl
      ? createNeonQuotaRepository({ databaseUrl })
      : new InMemoryQuotaRepository(),
    documentStore: blobToken
      ? createVercelBlobDocumentStore({ token: blobToken })
      : new InMemoryDocumentStore(),
    clock: () => new Date(),
    requestIdSource: randomUUID,
    bucketTokenSource: defaultBucketTokenSource,
    replayStageDelayMs: 140,
    liveModeEnabled: false,
    cronSecret: environment.CRON_SECRET,
    execute: executeRun,
    async loadSyntheticDocument(filename) {
      return new Uint8Array(
        await readFile(join(process.cwd(), "public", "samples", filename)),
      );
    },
  };
}

let singleton: HttpContainer | null = null;

export function getHttpContainer(): HttpContainer {
  singleton ??= createDefaultHttpContainer();
  return singleton;
}
