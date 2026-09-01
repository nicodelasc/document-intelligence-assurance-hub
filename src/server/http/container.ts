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
  DEFAULT_DAILY_MODEL_BUDGET_USD,
  InMemoryQuotaRepository,
  type QuotaRepository,
} from "@/server/security/rate-limit";
import {
  createVercelBlobDocumentStore,
  InMemoryDocumentStore,
  type DocumentStore,
} from "@/server/storage/document-store";
import {
  executeRun,
  type ExecuteRunInput,
  type ExecuteRunDependencies,
} from "@/server/workflow/execute-run";
import type { RunEvent } from "@/domain/types";
import type { Provider } from "@/domain/types";
import { defaultBucketTokenSource } from "@/server/http/anonymous-bucket";
import type { ExtractionProvider } from "@/server/workflow/provider";
import { createRecordedExtractionProvider } from "@/server/workflow/recorded-provider";
import type { ExecutionMode } from "@/server/repositories/run-repository";
import { syntheticFixtures } from "@/domain/fixtures";
import {
  createNeonAbuseControl,
  InMemoryAbuseControl,
  type AbuseControl,
} from "@/server/security/abuse-control";
import { classifyCustomSourceOrigin } from "@/server/security/source-origin";

type SyntheticFixtureId = (typeof syntheticFixtures)[number]["id"];

export type ProviderAvailability = Record<Provider, boolean>;

export type ProviderFactoryInput = {
  provider: Provider;
  model: string;
  executionMode: ExecutionMode;
  sampleId: SyntheticFixtureId | null;
};

export class HttpContainerConfigurationError extends Error {
  readonly name = "HttpContainerConfigurationError";
}

export type HttpContainer = {
  repository: RunRepository;
  quotaRepository: QuotaRepository;
  documentStore: DocumentStore;
  abuseControl: AbuseControl;
  clock: () => Date;
  requestIdSource: () => string;
  bucketTokenSource: () => string;
  replayStageDelayMs: number;
  liveModeEnabled: boolean;
  providerAvailability: ProviderAvailability;
  cronSecret: string | undefined;
  execute: (
    input: ExecuteRunInput,
    dependencies: ExecuteRunDependencies,
  ) => AsyncGenerator<RunEvent>;
  createProvider: (input: ProviderFactoryInput) => Promise<ExtractionProvider>;
  classifyCustomSourceOrigin: (
    bytes: Uint8Array,
  ) => "recognized_copy" | "unverified";
  loadSyntheticDocument: (filename: string) => Promise<Uint8Array>;
};

type Environment = Record<string, string | undefined>;

function parseDailyModelBudget(value: string | undefined): number {
  if (value === undefined) return DEFAULT_DAILY_MODEL_BUDGET_USD;
  if (!value.trim()) {
    throw new HttpContainerConfigurationError(
      "invalid_global_daily_model_budget_usd",
    );
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpContainerConfigurationError(
      "invalid_global_daily_model_budget_usd",
    );
  }
  return parsed;
}

function hasStrongCronSecret(value: string | undefined): value is string {
  return Boolean(value && value.length >= 32 && !/\s/.test(value));
}

export function createDefaultHttpContainer(
  environment: Environment = process.env,
): HttpContainer {
  const databaseUrl = environment.DATABASE_URL;
  const blobToken = environment.BLOB_READ_WRITE_TOKEN;
  const hasDatabase = Boolean(databaseUrl);
  const hasBlob = Boolean(blobToken);
  const liveModeEnabled = environment.AI_LIVE_ENABLED === "true";
  const dailyBudgetUsd = parseDailyModelBudget(
    environment.GLOBAL_DAILY_MODEL_BUDGET_USD,
  );
  if (hasDatabase !== hasBlob) {
    throw new HttpContainerConfigurationError(
      "connected_persistence_must_be_coherent",
    );
  }
  if (
    environment.NODE_ENV === "production" &&
    !hasDatabase &&
    environment.ALLOW_IN_MEMORY_PERSISTENCE !== "true"
  ) {
    throw new HttpContainerConfigurationError(
      "production_persistence_required",
    );
  }
  if (
    environment.NODE_ENV === "production" &&
    liveModeEnabled &&
    !hasDatabase
  ) {
    throw new HttpContainerConfigurationError(
      "production_live_mode_requires_database",
    );
  }
  if (
    environment.NODE_ENV === "production" &&
    hasDatabase &&
    !hasStrongCronSecret(environment.CRON_SECRET)
  ) {
    throw new HttpContainerConfigurationError(
      "production_cron_secret_required",
    );
  }
  return {
    repository: databaseUrl
      ? createNeonRunRepository({ databaseUrl })
      : new InMemoryRunRepository(),
    quotaRepository: databaseUrl
      ? createNeonQuotaRepository({ databaseUrl, dailyBudgetUsd })
      : new InMemoryQuotaRepository(dailyBudgetUsd),
    documentStore: blobToken
      ? createVercelBlobDocumentStore({ token: blobToken })
      : new InMemoryDocumentStore(),
    abuseControl: databaseUrl
      ? createNeonAbuseControl({ databaseUrl })
      : new InMemoryAbuseControl(),
    clock: () => new Date(),
    requestIdSource: randomUUID,
    bucketTokenSource: defaultBucketTokenSource,
    replayStageDelayMs: 140,
    liveModeEnabled,
    providerAvailability: {
      openai: liveModeEnabled && Boolean(environment.OPENAI_API_KEY),
      anthropic: liveModeEnabled && Boolean(environment.ANTHROPIC_API_KEY),
    },
    cronSecret: environment.CRON_SECRET,
    execute: executeRun,
    classifyCustomSourceOrigin,
    async createProvider(input) {
      if (input.executionMode === "recorded") {
        if (!input.sampleId) throw new Error("recorded_fixture_required");
        return createRecordedExtractionProvider({
          provider: input.provider,
          fixtureId: input.sampleId,
          model: input.model,
        });
      }
      const liveProviders = await import("@/server/workflow/live-provider");
      return input.provider === "openai"
        ? liveProviders.createOpenAIExtractionProvider({
            liveEnabled: liveModeEnabled,
            apiKey: environment.OPENAI_API_KEY,
            model: input.model,
          })
        : liveProviders.createAnthropicExtractionProvider({
            liveEnabled: liveModeEnabled,
            apiKey: environment.ANTHROPIC_API_KEY,
            model: input.model,
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
