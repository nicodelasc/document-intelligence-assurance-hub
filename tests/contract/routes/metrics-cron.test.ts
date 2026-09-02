import { describe, expect, it } from "vitest";
import { syntheticFixtures } from "@/domain/fixtures";
import {
  handleMetricsGet,
  invalidateMetricsCache,
} from "@/server/http/metrics-handler";
import { handlePurgeExpiredGet } from "@/server/http/cron-handler";
import { handleRunsPost } from "@/server/http/runs-handler";
import {
  createTestContainer,
  readLines,
  syntheticRequest,
} from "./test-support";
import type { Outcome } from "@/domain/types";
import { InMemoryRunRepository } from "@/server/repositories/run-repository";

async function seedOutcome(
  container: ReturnType<typeof createTestContainer>,
  id: string,
  outcome: Outcome,
  estimatedCostUsd = 0,
  options: {
    createdAt?: string;
    completedAt?: string;
    expiresAt?: string;
    provider?: "openai" | "anthropic";
    executionMode?: "recorded" | "live";
    sourceType?: "synthetic" | "custom";
    sourceOriginStatus?: "server_original" | "recognized_copy" | "unverified";
  } = {},
): Promise<void> {
  const provider = options.provider ?? "openai";
  const executionMode = options.executionMode ?? "recorded";
  await container.repository.createRun({
    id,
    provider,
    model: "gpt-5-mini",
    promptVersion: "recorded-fixture-2026-08-27.v1",
    executionMode,
    providerDispatched: false,
    sourceType: options.sourceType ?? "synthetic",
    sourceOriginStatus: options.sourceOriginStatus ?? "server_original",
    documentFamily: null,
    fixtureId: null,
    file: {
      filename: `${id}.pdf`,
      mediaType: "application/pdf",
      sizeBytes: 100,
      pageCount: 1,
    },
    documentKey: `runs/${id}/document`,
    requestedFields: [{ key: "invoice_total", label: "Invoice total" }],
    status: "validating",
    outcome: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    estimatedCostUsd: 0,
    consent: false,
    createdAt: options.createdAt ?? "2026-08-27T00:00:00.000Z",
    completedAt: null,
    expiresAt: options.expiresAt ?? "2026-08-27T23:55:00.000Z",
    deletedAt: null,
    deletionTokenHash: `sha256:${"a".repeat(64)}`,
    retryCount: 0,
    latencyMs: null,
    stepDurations: {},
  });
  if (executionMode === "live") {
    await container.repository.markProviderDispatched(id);
  }
  await container.repository.saveResults(id, {
    fields: [],
    outcome,
    documentInstruction: null,
    action: structuredClone(syntheticFixtures[1].action),
    usage: { inputTokens: 10, outputTokens: 2 },
    estimatedCostUsd,
    retryCount: 0,
    latencyMs: 10,
    stepDurations: { extracting: 5 },
    completedAt: options.completedAt ?? "2026-08-27T00:00:01.000Z",
  });
}

function expectFiniteNumbers(value: unknown): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(expectFiniteNumbers);
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(expectFiniteNumbers);
  }
}

describe("GET /api/metrics", () => {
  it("rate limits aggregate reads before any metrics query", async () => {
    const container = createTestContainer();
    let aggregateReads = 0;
    const aggregateAnonymousUsage =
      container.repository.aggregateAnonymousUsage.bind(container.repository);
    container.repository.aggregateAnonymousUsage = async () => {
      aggregateReads += 1;
      return aggregateAnonymousUsage();
    };
    container.abuseControl = {
      allowRunSubmission: async () => true,
      allowDocumentRead: async () => true,
      allowPublicRead: async () => false,
    };

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );

    expect(response.status).toBe(429);
    expect(aggregateReads).toBe(0);
    expect(response.headers.get("set-cookie")).toContain("diah_browser=");
  });

  it("reuses one short-lived aggregate snapshot", async () => {
    const container = createTestContainer();
    let aggregateReads = 0;
    const aggregateAnonymousUsage =
      container.repository.aggregateAnonymousUsage.bind(container.repository);
    container.repository.aggregateAnonymousUsage = async () => {
      aggregateReads += 1;
      return aggregateAnonymousUsage();
    };

    const first = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const second = await handleMetricsGet(
      new Request("http://local.test/api/metrics", {
        headers: {
          cookie:
            "diah_browser=metrics-cache-browser-token-12345678901234567890",
        },
      }),
      container,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(aggregateReads).toBe(1);
    expect(await second.text()).toBe(await first.text());
  });

  it("refreshes cached metrics after a streamed run completes", async () => {
    const container = createTestContainer();
    const before = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as { summary: { totalRuns: number } };

    await (await handleRunsPost(syntheticRequest(), container)).text();

    const after = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics", {
          headers: {
            cookie:
              "diah_browser=metrics-after-run-browser-token-1234567890123456",
          },
        }),
        container,
      )
    ).json()) as { summary: { totalRuns: number } };

    expect(before.summary.totalRuns).toBe(0);
    expect(after.summary.totalRuns).toBe(1);
  });

  it("coalesces concurrent aggregate snapshots", async () => {
    const container = createTestContainer();
    const reads = {
      anonymousUsage: 0,
      confirmedCosts: 0,
      quota: 0,
      publicRuns: 0,
      lifecycle: 0,
      cleanupBacklog: 0,
    };
    let announceStarted: () => void = () => undefined;
    let releaseAggregate: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      announceStarted = () => resolve();
    });
    const released = new Promise<void>((resolve) => {
      releaseAggregate = () => resolve();
    });
    const aggregateAnonymousUsage =
      container.repository.aggregateAnonymousUsage.bind(container.repository);
    container.repository.aggregateAnonymousUsage = async () => {
      reads.anonymousUsage += 1;
      announceStarted();
      await released;
      return aggregateAnonymousUsage();
    };
    const aggregateConfirmedModelCosts =
      container.repository.aggregateConfirmedModelCosts.bind(
        container.repository,
      );
    container.repository.aggregateConfirmedModelCosts = async (now) => {
      reads.confirmedCosts += 1;
      return aggregateConfirmedModelCosts(now);
    };
    const snapshot = container.quotaRepository.snapshot.bind(
      container.quotaRepository,
    );
    container.quotaRepository.snapshot = async (now) => {
      reads.quota += 1;
      return snapshot(now);
    };
    const listPublicRuns = container.repository.listPublicRuns.bind(
      container.repository,
    );
    container.repository.listPublicRuns = async (now, options) => {
      reads.publicRuns += 1;
      return listPublicRuns(now, options);
    };
    const aggregateActiveDetailLifecycle =
      container.repository.aggregateActiveDetailLifecycle.bind(
        container.repository,
      );
    container.repository.aggregateActiveDetailLifecycle = async (now) => {
      reads.lifecycle += 1;
      return aggregateActiveDetailLifecycle(now);
    };
    const countCleanupBacklog = container.repository.countCleanupBacklog.bind(
      container.repository,
    );
    container.repository.countCleanupBacklog = async (now) => {
      reads.cleanupBacklog += 1;
      return countCleanupBacklog(now);
    };

    const first = handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    await started;
    const second = handleMetricsGet(
      new Request("http://local.test/api/metrics", {
        headers: {
          cookie:
            "diah_browser=metrics-concurrent-browser-token-1234567890123456",
        },
      }),
      container,
    );
    releaseAggregate();
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(reads).toEqual({
      anonymousUsage: 1,
      confirmedCosts: 1,
      quota: 1,
      publicRuns: 1,
      lifecycle: 1,
      cleanupBacklog: 1,
    });
  });

  it("does not restore a cache entry invalidated during aggregation", async () => {
    const container = createTestContainer();
    let aggregateReads = 0;
    let announceStarted: () => void = () => undefined;
    let releaseAggregate: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      announceStarted = () => resolve();
    });
    const released = new Promise<void>((resolve) => {
      releaseAggregate = () => resolve();
    });
    const aggregateAnonymousUsage =
      container.repository.aggregateAnonymousUsage.bind(container.repository);
    container.repository.aggregateAnonymousUsage = async () => {
      aggregateReads += 1;
      if (aggregateReads === 1) {
        announceStarted();
        await released;
      }
      return aggregateAnonymousUsage();
    };

    const first = handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    await started;
    invalidateMetricsCache(container.repository);
    releaseAggregate();
    expect((await first).status).toBe(200);
    expect(
      (
        await handleMetricsGet(
          new Request("http://local.test/api/metrics"),
          container,
        )
      ).status,
    ).toBe(200);

    expect(aggregateReads).toBe(2);
  });

  it("returns finite zero-denominator metrics and provider-neutral synthetic observations", async () => {
    const container = createTestContainer();
    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      summary: {
        totalRuns: 0,
        completionRate: 0,
        reviewRate: 0,
        failureRate: 0,
      },
      performance: { sampleCount: 0 },
      usage: {
        liveRuns: 0,
        recordedRuns: 0,
        estimatedCost: true,
      },
      benchmark: {
        source: "deterministic_synthetic_observations",
        observationCount: 10,
        exactMatchRate: 1,
        evaluatorAgreement: 1,
        falseClearCount: 0,
      },
      resourceScenario: {
        illustrative: true,
        modelCostAssumption: {
          sourceCurrency: "USD",
          targetCurrency: "SGD",
          usdToSgd: 1.35,
          assumptionDate: "2026-09-01",
          illustrative: true,
        },
      },
    });
    expectFiniteNumbers(body);
  });

  it("counts every review outcome without treating recorded costs as model costs", async () => {
    const container = createTestContainer();
    await seedOutcome(container, "clear", "clear", 1);
    await seedOutcome(container, "needs-review", "needs_review", 1);
    await seedOutcome(container, "incomplete", "incomplete", 1);
    await seedOutcome(container, "conflict", "conflict", 1);
    await seedOutcome(container, "not-found", "not_found", 1);

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const body = (await response.json()) as {
      summary: { reviewRate: number };
      performance: { sampleCount: number };
      resourceScenario: {
        inputs: { averageModelCostPerRun: number };
        modelCostAssumption: { usdToSgd: number };
      };
    };

    expect(body.summary.reviewRate).toBe(0.8);
    expect(body.performance.sampleCount).toBe(5);
    expect(body.resourceScenario.modelCostAssumption.usdToSgd).toBe(1.35);
    expect(body.resourceScenario.inputs.averageModelCostPerRun).toBe(0);
  });

  it("shows only runs inside the configured public Operations window", async () => {
    const cutoff = "2026-09-02T00:00:00.000Z";
    const now = new Date("2026-09-02T00:30:00.000Z");
    const container = createTestContainer({
      clock: () => now,
      publicOperationsCutoffAt: cutoff,
    });

    await container.repository.createRun({
      id: "old-failed",
      provider: "openai",
      model: "gpt-5-mini",
      promptVersion: "test.v1",
      executionMode: "live",
      providerDispatched: false,
      sourceType: "custom",
      sourceOriginStatus: "unverified",
      documentFamily: "supplier_invoice",
      fixtureId: null,
      file: {
        filename: "old.pdf",
        mediaType: "application/pdf",
        sizeBytes: 100,
        pageCount: 1,
      },
      documentKey: "runs/old-failed/document",
      requestedFields: [{ key: "invoice_total", label: "Invoice total" }],
      status: "validating",
      outcome: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      consent: true,
      createdAt: "2026-09-01T23:59:59.999Z",
      completedAt: null,
      expiresAt: "2026-09-02T22:00:00.000Z",
      deletedAt: null,
      deletionTokenHash: `sha256:${"b".repeat(64)}`,
      retryCount: 0,
      latencyMs: null,
      stepDurations: {},
    });
    await container.repository.markProviderDispatched("old-failed");
    await container.repository.markFailed("old-failed", {
      timestamp: "2026-09-01T23:59:59.999Z",
      safeCode: "provider_unavailable",
      failedStage: "extracting",
      retryCount: 1,
      latencyMs: 900,
      stepDurations: { extracting: 900 },
    });
    await seedOutcome(container, "boundary-clear", "clear", 0.02, {
      createdAt: cutoff,
      completedAt: "2026-09-02T00:00:01.000Z",
      expiresAt: "2026-09-02T22:00:00.000Z",
      executionMode: "live",
    });
    await seedOutcome(container, "new-conflict", "conflict", 0.03, {
      createdAt: "2026-09-02T00:00:01.000Z",
      completedAt: "2026-09-02T00:00:02.000Z",
      expiresAt: "2026-09-02T23:00:00.000Z",
      provider: "anthropic",
      executionMode: "live",
      sourceType: "custom",
      sourceOriginStatus: "unverified",
    });

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const body = (await response.json()) as {
      summary: {
        totalRuns: number;
        completionRate: number;
        reviewRate: number;
        failureRate: number;
      };
      operations: {
        workflowStatus: {
          ready: number;
          needsAttention: number;
          processingErrors: number;
        };
        lifecycle: { activeDocuments: number; activePublicUploads: number };
        origin: {
          serverOriginal: number;
          recognizedCopy: number;
          unverified: number;
        };
      };
      performance: { sampleCount: number };
      usage: {
        liveRuns: number;
        providerSplit: { openai: number; anthropic: number };
        estimatedApiCostUsd: number;
      };
      runExplorer: Array<{ id: string }>;
    };

    expect(body.summary).toEqual({
      totalRuns: 2,
      completionRate: 1,
      reviewRate: 0.5,
      failureRate: 0,
    });
    expect(body.operations.workflowStatus).toMatchObject({
      ready: 1,
      needsAttention: 1,
      processingErrors: 0,
    });
    expect(body.operations.lifecycle).toMatchObject({
      activeDocuments: 2,
      activePublicUploads: 1,
    });
    expect(body.operations.origin).toEqual({
      serverOriginal: 1,
      recognizedCopy: 0,
      unverified: 1,
    });
    expect(body.performance.sampleCount).toBe(2);
    expect(body.usage).toMatchObject({
      liveRuns: 2,
      providerSplit: { openai: 1, anthropic: 1 },
      estimatedApiCostUsd: 0.05,
    });
    expect(body.runExplorer.map((run) => run.id)).toEqual([
      "new-conflict",
      "boundary-clear",
    ]);
  });

  it("never includes uploader tokens or secret-bearing persistence fields", async () => {
    const container = createTestContainer();
    const postResponse = await handleRunsPost(syntheticRequest(), container);
    const events = await readLines(postResponse);
    const token = (events.at(-1) as { deletionToken: string }).deletionToken;

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const text = await response.text();

    expect(text).not.toContain(token);
    expect(text).not.toContain("deletionTokenHash");
    expect(text).not.toContain("documentKey");
    expect(text).not.toContain("systemPrompt");
    expect(text).not.toContain("reasoning");
  });
});

describe("GET /api/cron/purge-expired", () => {
  it("rejects a missing cron configuration before authorization", async () => {
    const container = createTestContainer({ cronSecret: undefined });
    const response = await handlePurgeExpiredGet(
      new Request("http://local.test/api/cron/purge-expired"),
      container,
    );

    expect(response.status).toBe(503);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("cron_not_configured");
  });

  it.each([undefined, "Bearer wrong-secret"])(
    "rejects a missing or wrong full authorization value",
    async (authorization) => {
      const container = createTestContainer();
      const headers = authorization ? { authorization } : undefined;
      const response = await handlePurgeExpiredGet(
        new Request("http://local.test/api/cron/purge-expired", { headers }),
        container,
      );

      expect(response.status).toBe(401);
      expect(
        ((await response.json()) as { error: { code: string } }).error.code,
      ).toBe("cron_not_authorized");
    },
  );

  it("purges expired details idempotently with exact Bearer authorization", async () => {
    let now = new Date("2026-08-27T00:00:00.000Z");
    const container = createTestContainer({ clock: () => now });
    const postResponse = await handleRunsPost(syntheticRequest(), container);
    await postResponse.text();
    now = new Date("2026-08-28T00:00:00.000Z");
    const request = () =>
      new Request("http://local.test/api/cron/purge-expired", {
        headers: { authorization: "Bearer test-cron-secret" },
      });

    const beforeMetrics = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as { retention: { cleanupBacklog: number } };
    const first = await handlePurgeExpiredGet(request(), container);
    const second = await handlePurgeExpiredGet(request(), container);
    const afterMetrics = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as { retention: { cleanupBacklog: number } };

    expect(beforeMetrics.retention.cleanupBacklog).toBe(1);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      purge: { purgedRuns: 1, purgedDocuments: 1, safeFailures: 0 },
    });
    expect(await second.json()).toEqual({
      purge: { purgedRuns: 0, purgedDocuments: 0, safeFailures: 0 },
    });
    expect(afterMetrics.retention.cleanupBacklog).toBe(0);
  });

  it("tombstones expired details before reporting a retryable Blob cleanup failure", async () => {
    let now = new Date("2026-08-27T00:00:00.000Z");
    const container = createTestContainer({ clock: () => now });
    await (await handleRunsPost(syntheticRequest(), container)).text();
    let blobAvailable = false;
    const deleteDocument = container.documentStore.deleteDocument.bind(
      container.documentStore,
    );
    container.documentStore.deleteDocument = async (key) => {
      if (!blobAvailable) throw new Error("simulated_blob_failure");
      return deleteDocument(key);
    };
    now = new Date("2026-08-28T00:00:00.000Z");

    const response = await handlePurgeExpiredGet(
      new Request("http://local.test/api/cron/purge-expired", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
      container,
    );
    const metrics = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as { retention: { cleanupBacklog: number } };
    const listed = await container.repository.listPublicRuns(now, {
      limit: 10,
      offset: 0,
      includeDetails: true,
    });

    expect(await response.json()).toEqual({
      purge: { purgedRuns: 1, purgedDocuments: 0, safeFailures: 1 },
    });
    expect(metrics.retention.cleanupBacklog).toBe(1);
    expect(listed[0]).toMatchObject({ status: "expired", requestedFields: [] });
    expect(listed[0].details).toBeUndefined();

    blobAvailable = true;
    const retry = await handlePurgeExpiredGet(
      new Request("http://local.test/api/cron/purge-expired", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
      container,
    );
    expect(await retry.json()).toEqual({
      purge: { purgedRuns: 0, purgedDocuments: 1, safeFailures: 0 },
    });
    expect(await container.repository.countCleanupBacklog(now)).toBe(0);
  });

  it("returns a safe failure when the whole database purge operation is unavailable", async () => {
    class FailingPurgeRepository extends InMemoryRunRepository {
      override async purgeExpiredData(): Promise<never> {
        throw new Error("database_connection_details");
      }
    }
    const container = createTestContainer({
      repository: new FailingPurgeRepository(),
    });

    const response = await handlePurgeExpiredGet(
      new Request("http://local.test/api/cron/purge-expired", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
      container,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "purge_failed",
        message: "Expiry cleanup could not complete safely.",
        requestId: "request-test-1",
      },
    });
  });
});
