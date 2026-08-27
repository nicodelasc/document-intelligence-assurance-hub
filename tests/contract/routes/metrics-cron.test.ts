import { describe, expect, it } from "vitest";
import { handleMetricsGet } from "@/server/http/metrics-handler";
import { handlePurgeExpiredGet } from "@/server/http/cron-handler";
import { handleRunsPost } from "@/server/http/runs-handler";
import { createTestContainer, readLines, syntheticRequest } from "./test-support";
import type { Outcome } from "@/domain/types";

async function seedOutcome(
  container: ReturnType<typeof createTestContainer>,
  id: string,
  outcome: Outcome,
  estimatedCostUsd = 0,
): Promise<void> {
  await container.repository.createRun({
    id,
    provider: "openai",
    model: "gpt-5-mini",
    promptVersion: "recorded-fixture-2026-08-27.v1",
    executionMode: "recorded",
    sourceType: "synthetic",
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
    createdAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2026-08-27T23:55:00.000Z",
    deletedAt: null,
    deletionTokenHash: `sha256:${"a".repeat(64)}`,
    retryCount: 0,
    latencyMs: null,
    stepDurations: {},
  });
  await container.repository.saveResults(id, {
    fields: [],
    outcome,
    usage: { inputTokens: 10, outputTokens: 2 },
    estimatedCostUsd,
    retryCount: 0,
    latencyMs: 10,
    stepDurations: { extracting: 5 },
    completedAt: "2026-08-27T00:00:01.000Z",
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
  it("returns finite zero-denominator metrics and labeled recorded benchmarks", async () => {
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
        source: "recorded_fixture_replay",
        liveRuns: 0,
        recordedRuns: 6,
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
          assumptionDate: "2026-08-27",
          illustrative: true,
        },
      },
    });
    expectFiniteNumbers(body);
  });

  it("counts every review outcome and converts estimated model cost into illustrative SGD", async () => {
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
    expect(body.resourceScenario.inputs.averageModelCostPerRun).toBe(1.35);
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
    expect((await response.json() as { error: { code: string } }).error.code).toBe(
      "cron_not_configured",
    );
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
      expect((await response.json() as { error: { code: string } }).error.code).toBe(
        "cron_not_authorized",
      );
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
      await handleMetricsGet(new Request("http://local.test/api/metrics"), container)
    ).json()) as { retention: { cleanupBacklog: number } };
    const first = await handlePurgeExpiredGet(request(), container);
    const second = await handlePurgeExpiredGet(request(), container);
    const afterMetrics = (await (
      await handleMetricsGet(new Request("http://local.test/api/metrics"), container)
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

  it("reports truthful per-item purge failures and leaves them in the backlog", async () => {
    let now = new Date("2026-08-27T00:00:00.000Z");
    const container = createTestContainer({ clock: () => now });
    await (await handleRunsPost(syntheticRequest(), container)).text();
    container.documentStore.deleteDocument = async () => {
      throw new Error("simulated_blob_failure");
    };
    now = new Date("2026-08-28T00:00:00.000Z");

    const response = await handlePurgeExpiredGet(
      new Request("http://local.test/api/cron/purge-expired", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
      container,
    );
    const metrics = (await (
      await handleMetricsGet(new Request("http://local.test/api/metrics"), container)
    ).json()) as { retention: { cleanupBacklog: number } };

    expect(await response.json()).toEqual({
      purge: { purgedRuns: 0, purgedDocuments: 0, safeFailures: 1 },
    });
    expect(metrics.retention.cleanupBacklog).toBe(1);
  });
});
