import {
  recordedDocumentRunResults,
  syntheticFixtures,
  type RecordedDocumentRunResult,
} from "@/domain/fixtures";
import { calculateResourceScenario } from "@/domain/resource-model";
import type { HttpContainer } from "@/server/http/container";
import { serializePublicRunListRow } from "@/server/http/public-serialization";
import {
  noIndexHeaders,
  safeErrorResponse,
  safeJsonResponse,
} from "@/server/http/responses";
import {
  attachBucketCookie,
  resolveAnonymousBucket,
} from "@/server/http/anonymous-bucket";

const METRICS_CACHE_TTL_MS = 15_000;
const metricsCache = new WeakMap<
  object,
  { expiresAt: number; payload?: unknown; pending?: Promise<unknown> }
>();

export function invalidateMetricsCache(repository: object): void {
  metricsCache.delete(repository);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1),
  );
  return sorted[index];
}

function averageDurations(records: Array<Record<string, number>>): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const durations of records) {
    for (const [stage, duration] of Object.entries(durations)) {
      const current = sums.get(stage) ?? { total: 0, count: 0 };
      sums.set(stage, { total: current.total + duration, count: current.count + 1 });
    }
  }
  return Object.fromEntries(
    [...sums].map(([stage, value]) => [stage, ratio(value.total, value.count)]),
  );
}

function countReplayValues(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>(
    (counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 2 }),
    {},
  );
}

function expectedEvaluatorStatus(value: string | null): "pass" | "not_found" {
  return value === null ? "not_found" : "pass";
}

export function calculateRecordedFixtureBenchmark(
  observations: readonly RecordedDocumentRunResult[] = recordedDocumentRunResults,
) {
  let exactMatches = 0;
  let totalFields = 0;
  let foundExpectedMissing = 0;
  let expectedMissing = 0;
  let evaluatorAgreements = 0;
  let evaluatorComparisons = 0;
  let falseClearCount = 0;

  for (const fixture of syntheticFixtures) {
    const observation = observations.find(
      (candidate) => candidate.fixtureId === fixture.id,
    );
    for (const requestedField of fixture.requestedFields) {
      const expectedValue = fixture.referenceData[requestedField.key] ?? null;
      const expectedStatus = expectedEvaluatorStatus(expectedValue);
      const field = observation?.fields.find(
        (candidate) => candidate.key === requestedField.key,
      );
      totalFields += 1;
      evaluatorComparisons += 1;
      if (field?.extractedValue === expectedValue) exactMatches += 1;
      if (field?.evaluatorStatus === expectedStatus) evaluatorAgreements += 1;
      if (expectedValue === null) {
        expectedMissing += 1;
        if (field?.extractedValue === null && field.evaluatorStatus === "not_found") {
          foundExpectedMissing += 1;
        }
      }
    }
    if (
      observation?.outcome === "clear" &&
      fixture.expectedOutcome !== "clear"
    ) {
      falseClearCount += 1;
    }
  }

  return {
    source: "recorded_fixture_replay" as const,
    liveRuns: 0,
    recordedRuns: syntheticFixtures.length * 2,
    providerCoverage: { openai: syntheticFixtures.length, anthropic: syntheticFixtures.length },
    exactMatchRate: ratio(exactMatches, totalFields),
    missingFieldRecall: ratio(foundExpectedMissing, expectedMissing),
    evaluatorAgreement: ratio(evaluatorAgreements, evaluatorComparisons),
    falseClearCount,
    expectedOutcomes: countReplayValues(
      syntheticFixtures.map((fixture) => fixture.expectedOutcome),
    ),
    actionStatuses: countReplayValues(
      syntheticFixtures.map((fixture) => fixture.action.status),
    ),
  };
}

export async function handleMetricsGet(
  request: Request,
  container: HttpContainer,
): Promise<Response> {
  const requestId = container.requestIdSource();
  const bucket = resolveAnonymousBucket(request, {
    tokenSource: container.bucketTokenSource,
    secure: process.env.NODE_ENV === "production",
  });
  const respond = (response: Response) => attachBucketCookie(response, bucket);
  try {
    const now = container.clock();
    if (
      !(await container.abuseControl.allowPublicRead({
        bucket: bucket.protectedBucket,
        resource: "metrics",
        now,
      }))
    ) {
      return respond(
        safeErrorResponse({
          code: "metrics_rate_limited",
          message: "Operational metrics have been requested too frequently. Retry shortly.",
          requestId,
          status: 429,
          headers: noIndexHeaders,
        }),
      );
    }
    const cached = metricsCache.get(container.repository);
    if (
      cached &&
      cached.payload !== undefined &&
      cached.expiresAt > now.getTime()
    ) {
      return respond(
        safeJsonResponse(cached.payload, { status: 200, headers: noIndexHeaders }),
      );
    }
    if (cached?.pending) {
      return respond(
        safeJsonResponse(await cached.pending, {
          status: 200,
          headers: noIndexHeaders,
        }),
      );
    }
    const pending = (async () => {
      const [aggregate, runs, cleanupBacklog] = await Promise.all([
      container.repository.aggregateAnonymousUsage(),
      container.repository.listPublicRuns(now, {
        limit: 100,
        offset: 0,
        includeDetails: false,
      }),
      container.repository.countCleanupBacklog(now),
    ]);
      const latencies = runs.flatMap((run) =>
        run.latencyMs === null ? [] : [run.latencyMs],
      );
      const reviewRuns =
        (aggregate.outcomeCounts.needs_review ?? 0) +
        (aggregate.outcomeCounts.incomplete ?? 0) +
        (aggregate.outcomeCounts.conflict ?? 0) +
        (aggregate.outcomeCounts.not_found ?? 0);
      const liveRuns = runs.filter((run) => run.executionMode === "live").length;
      const recordedRuns = runs.filter(
        (run) => run.executionMode === "recorded",
      ).length;
      const activeRuns = runs.filter(
        (run) => run.status !== "expired" && run.status !== "deleted",
      );
      const nextHour = now.getTime() + 60 * 60 * 1000;
      const averageModelCostPerRunUsd = ratio(
        aggregate.estimatedCostUsd,
        aggregate.completedRuns,
      );
      const illustrativeUsdToSgd = 1.35;
      const resourceInputs = {
        documents: 200,
        fields: 3,
        manualMinutesPerField: 2,
        assistedMinutesPerField: 0.5,
        loadedHourlyCost: 50,
        averageModelCostPerRun: averageModelCostPerRunUsd * illustrativeUsdToSgd,
      };
      const resourceResult = calculateResourceScenario(resourceInputs);

      return {
        generatedAt: now.toISOString(),
        summary: {
          totalRuns: aggregate.totalRuns,
          completionRate: ratio(aggregate.completedRuns, aggregate.totalRuns),
          reviewRate: ratio(reviewRuns, aggregate.completedRuns),
          failureRate: ratio(aggregate.failedRuns, aggregate.totalRuns),
        },
        performance: {
          sampleCount: runs.length,
          p50LatencyMs: percentile(latencies, 0.5),
          p95LatencyMs: percentile(latencies, 0.95),
          retryCount: runs.reduce((total, run) => total + run.retryCount, 0),
          averageStepDurationsMs: averageDurations(
            runs.map((run) => run.stepDurations),
          ),
        },
        usage: {
          inputTokens: aggregate.totalInputTokens,
          outputTokens: aggregate.totalOutputTokens,
          providerSplit: {
            openai: aggregate.providerCounts.openai,
            anthropic: aggregate.providerCounts.anthropic,
          },
          recordedRuns,
          liveRuns,
          estimatedApiCostUsd: aggregate.estimatedCostUsd,
          estimatedCost: true,
          pricingAsOf: "2026-08-27",
        },
        benchmark: calculateRecordedFixtureBenchmark(),
        retention: {
          activePublicUploads: activeRuns.filter(
            (run) => run.sourceType === "custom",
          ).length,
          upcomingExpirations: activeRuns.filter(
            (run) => Date.parse(run.expiresAt) <= nextHour,
          ).length,
          cleanupBacklog,
          sampleCount: runs.length,
        },
        runExplorer: runs.map(serializePublicRunListRow),
        resourceScenario: {
          currency: "SGD",
          inputs: resourceInputs,
          modelCostAssumption: {
            sourceCurrency: "USD",
            targetCurrency: "SGD",
            averageModelCostPerRunUsd,
            usdToSgd: illustrativeUsdToSgd,
            assumptionDate: "2026-08-27",
            illustrative: true,
          },
          result: {
            ...resourceResult,
            estimatedNetSavings:
              resourceResult.manualLaborCost - resourceResult.totalAssistedCost,
          },
          illustrative: true,
          label: "Illustrative scenario, not measured savings",
        },
      };
    })();
    metricsCache.set(container.repository, { expiresAt: 0, pending });
    let payload: unknown;
    try {
      payload = await pending;
      if (metricsCache.get(container.repository)?.pending === pending) {
        metricsCache.set(container.repository, {
          expiresAt: now.getTime() + METRICS_CACHE_TTL_MS,
          payload,
        });
      }
    } catch (error) {
      if (metricsCache.get(container.repository)?.pending === pending) {
        metricsCache.delete(container.repository);
      }
      throw error;
    }
    return respond(
      safeJsonResponse(payload, { status: 200, headers: noIndexHeaders }),
    );
  } catch {
    return respond(
      safeErrorResponse({
        code: "metrics_unavailable",
        message: "Operational metrics are temporarily unavailable.",
        requestId,
        status: 503,
        headers: noIndexHeaders,
      }),
    );
  }
}
