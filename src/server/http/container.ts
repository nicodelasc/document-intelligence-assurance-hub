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
import type { Provider } from "@/domain/types";
import { defaultBucketTokenSource } from "@/server/http/anonymous-bucket";
import type { ExtractionProvider } from "@/server/workflow/provider";
import { createRecordedExtractionProvider } from "@/server/workflow/recorded-provider";
import type { ExecutionMode } from "@/server/repositories/run-repository";
import { syntheticInvoices } from "@/domain/fixtures";

type SyntheticInvoiceId = (typeof syntheticInvoices)[number]["id"];

export type ProviderFactoryInput = {
  provider: Provider;
  executionMode: ExecutionMode;
  sampleId: SyntheticInvoiceId | null;
};

export class HttpContainerConfigurationError extends Error {
  readonly name = "HttpContainerConfigurationError";
}

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
  createProvider: (input: ProviderFactoryInput) => Promise<ExtractionProvider>;
  loadSyntheticDocument: (filename: string) => Promise<Uint8Array>;
};

type Environment = Record<string, string | undefined>;

export function createDefaultHttpContainer(
  environment: Environment = process.env,
): HttpContainer {
  const databaseUrl = environment.DATABASE_URL;
  const blobToken = environment.BLOB_READ_WRITE_TOKEN;
  const hasDatabase = Boolean(databaseUrl);
  const hasBlob = Boolean(blobToken);
  if (hasDatabase !== hasBlob) {
    throw new HttpContainerConfigurationError("connected_persistence_must_be_coherent");
  }
  if (
    environment.NODE_ENV === "production" &&
    !hasDatabase &&
    environment.ALLOW_IN_MEMORY_PERSISTENCE !== "true"
  ) {
    throw new HttpContainerConfigurationError("production_persistence_required");
  }
  const liveModeEnabled = environment.AI_LIVE_ENABLED === "true";
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
    liveModeEnabled,
    cronSecret: environment.CRON_SECRET,
    execute: executeRun,
    async createProvider(input) {
      if (input.executionMode === "recorded") {
        if (!input.sampleId) throw new Error("recorded_fixture_required");
        return createRecordedExtractionProvider({
          provider: input.provider,
          fixtureId: input.sampleId,
        });
      }
      const liveProviders = await import("@/server/workflow/live-provider");
      return input.provider === "openai"
        ? liveProviders.createOpenAIExtractionProvider({
            liveEnabled: liveModeEnabled,
            apiKey: environment.OPENAI_API_KEY,
            model: environment.OPENAI_MODEL,
          })
        : liveProviders.createAnthropicExtractionProvider({
            liveEnabled: liveModeEnabled,
            apiKey: environment.ANTHROPIC_API_KEY,
            model: environment.ANTHROPIC_MODEL,
          });
    },
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
