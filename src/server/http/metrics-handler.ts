import { recordedRunResults } from "@/domain/fixtures";
import { decideOutcome } from "@/domain/outcomes";
import { calculateResourceScenario } from "@/domain/resource-model";
import type { HttpContainer } from "@/server/http/container";
import { serializePublicRunListRow } from "@/server/http/public-serialization";
import {
  noIndexHeaders,
  safeErrorResponse,
  safeJsonResponse,
} from "@/server/http/responses";

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

function recordedBenchmark() {
  const expectedMissing = new Set(["missing-purchase-order:purchase_order_number"]);
  let exactMatches = 0;
  let totalFields = 0;
  let foundExpectedMissing = 0;
  let evaluatorAgreements = 0;
  let falseClearCount = 0;

  for (const fixture of recordedRunResults) {
    totalFields += fixture.fields.length;
    exactMatches += fixture.fields.filter((field) => field.referenceMatch === true).length;
    foundExpectedMissing += fixture.fields.filter(
      (field) =>
        expectedMissing.has(`${fixture.invoiceId}:${field.key}`) &&
        field.evaluatorStatus === "not_found",
    ).length;
    const decided = decideOutcome({ sourceType: "synthetic", fields: fixture.fields });
    if (decided === fixture.outcome) evaluatorAgreements += 1;
    if (
      decided === "clear" &&
      fixture.fields.some(
        (field) => field.evaluatorStatus !== "pass" || field.referenceMatch === false,
      )
    ) {
      falseClearCount += 1;
    }
  }

  return {
    source: "recorded_fixture_replay" as const,
    liveRuns: 0,
    recordedRuns: recordedRunResults.length * 2,
    providerCoverage: { openai: recordedRunResults.length, anthropic: recordedRunResults.length },
    exactMatchRate: ratio(exactMatches, totalFields),
    missingFieldRecall: ratio(foundExpectedMissing, expectedMissing.size),
    evaluatorAgreement: ratio(evaluatorAgreements, recordedRunResults.length),
    falseClearCount,
  };
}

export async function handleMetricsGet(
  _request: Request,
  container: HttpContainer,
): Promise<Response> {
  const requestId = container.requestIdSource();
  try {
    const now = container.clock();
    const [aggregate, runs] = await Promise.all([
      container.repository.aggregateAnonymousUsage(),
      container.repository.listPublicRuns(now),
    ]);
    const latencies = runs.flatMap((run) =>
      run.latencyMs === null ? [] : [run.latencyMs],
    );
    const reviewRuns =
      (aggregate.outcomeCounts.needs_review ?? 0) +
      (aggregate.outcomeCounts.conflict ?? 0);
    const liveRuns = runs.filter((run) => run.executionMode === "live").length;
    const recordedRuns = runs.filter((run) => run.executionMode === "recorded").length;
    const activeRuns = runs.filter(
      (run) => run.status !== "expired" && run.status !== "deleted",
    );
    const nextHour = now.getTime() + 60 * 60 * 1000;
    const averageModelCostPerRun = ratio(
      aggregate.estimatedCostUsd,
      aggregate.completedRuns,
    );
    const resourceInputs = {
      documents: 200,
      fields: 3,
      manualMinutesPerField: 2,
      assistedMinutesPerField: 0.5,
      loadedHourlyCost: 50,
      averageModelCostPerRun,
    };
    const resourceResult = calculateResourceScenario(resourceInputs);

    return safeJsonResponse(
      {
        generatedAt: now.toISOString(),
        summary: {
          totalRuns: aggregate.totalRuns,
          completionRate: ratio(aggregate.completedRuns, aggregate.totalRuns),
          reviewRate: ratio(reviewRuns, aggregate.completedRuns),
          failureRate: ratio(aggregate.failedRuns, aggregate.totalRuns),
        },
        performance: {
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
        benchmark: recordedBenchmark(),
        retention: {
          activePublicUploads: activeRuns.filter(
            (run) => run.sourceType === "custom",
          ).length,
          upcomingExpirations: activeRuns.filter(
            (run) => Date.parse(run.expiresAt) <= nextHour,
          ).length,
          cleanupBacklog: runs.filter((run) => run.status === "expired").length,
        },
        runExplorer: runs.map(serializePublicRunListRow),
        resourceScenario: {
          currency: "SGD",
          inputs: resourceInputs,
          result: {
            ...resourceResult,
            estimatedNetSavings:
              resourceResult.manualLaborCost - resourceResult.totalAssistedCost,
          },
          illustrative: true,
          label: "Illustrative scenario, not measured savings",
        },
      },
      { status: 200, headers: noIndexHeaders },
    );
  } catch {
    return safeErrorResponse({
      code: "metrics_unavailable",
      message: "Operational metrics are temporarily unavailable.",
      requestId,
      status: 503,
      headers: noIndexHeaders,
    });
  }
}
