import {
  recordedDocumentRunResults,
  syntheticFixtures,
  type RecordedDocumentRunResult,
} from "@/domain/fixtures";
import { calculateResourceScenario } from "@/domain/resource-model";
import { requiresSourceOriginReview } from "@/domain/action-policy";
import { pricingAsOf } from "@/domain/pricing";
import type {
  DocumentFamily,
  VariantClassification,
  WorkflowActionType,
  WorkflowEvent,
  WorkflowEventStatus,
} from "@/domain/types";
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
import type {
  ConfirmedModelCostAggregate,
  ExpiryBucketCounts,
  PublicRunRecord,
  SourceOriginAggregate,
} from "@/server/repositories/run-repository";

const METRICS_CACHE_TTL_MS = 15_000;
const METRICS_RUN_LIMIT = 100;
const PUBLIC_DETAIL_EXPIRY_HOURS = 24;
const metricsCache = new WeakMap<
  object,
  {
    expiresAt: number;
    cutoffAt: string | null;
    payload?: MetricsPayload;
    pending?: Promise<MetricsPayload>;
  }
>();

export type MetricsPerformance = {
  sampleCount: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  retryCount: number;
  averageStepDurationsMs: Record<string, number>;
};

export type LatestWorkflowEventSummary = {
  action: WorkflowActionType;
  status: WorkflowEventStatus;
  timestamp: string;
};

export type ReferenceQualityMetrics = {
  source: "deterministic_synthetic_observations";
  observationCount: number;
  exactMatchRate: number;
  missingFieldRecall: number;
  evaluatorAgreement: number;
  falseClearCount: number;
  expectedOutcomes: Record<string, number>;
  actionStatuses: Record<string, number>;
  familyCounts: Record<DocumentFamily, number>;
  classificationCounts: Record<VariantClassification, number>;
  unreadableCriticalEvidenceDetected: number;
  unreadableCriticalEvidenceFixtures: number;
  unreadableCriticalEvidenceDetectionRate: number;
};

type LifecycleMetrics = {
  activeDocuments: number;
  activePublicUploads: number;
  expiryBuckets: ExpiryBucketCounts;
  cleanupBacklog: number;
};

type MetricsRunExplorerRow = ReturnType<typeof serializePublicRunListRow> & {
  latestWorkflowEvent: LatestWorkflowEventSummary | null;
};

export type MetricsPayload = {
  generatedAt: string;
  operations: {
    workflowStatus: {
      ready: number;
      needsAttention: number;
      incomplete: number;
      processingErrors: number;
    };
    workflowActivity: Record<WorkflowEventStatus, number>;
    performance: MetricsPerformance;
    lifecycle: LifecycleMetrics;
    origin: SourceOriginAggregate;
  };
  costs: {
    estimated: true;
    currency: "USD";
    pricingAsOf: string;
    settledSpend: {
      todayUsd: number;
      monthToDateUsd: number;
      mayIncludeConservativeSettlements: true;
    };
    completedRunEstimates: {
      todayUsd: number;
      monthToDateUsd: number;
      completedModelRuns: number;
      totalUsd: number;
      averageUsd: number;
    };
    byModel: ConfirmedModelCostAggregate["byModel"];
    byFamily: ConfirmedModelCostAggregate["byFamily"];
    dailyBudget: {
      limitUsd: number;
      settledUsd: number;
      reservedUsd: number;
      remainingUsd: number;
      pendingReservations: number;
    };
  };
  referenceQuality: ReferenceQualityMetrics;
  summary: {
    totalRuns: number;
    completionRate: number;
    reviewRate: number;
    failureRate: number;
  };
  performance: MetricsPerformance;
  usage: {
    inputTokens: number;
    outputTokens: number;
    providerSplit: { openai: number; anthropic: number };
    recordedRuns: number;
    liveRuns: number;
    estimatedApiCostUsd: number;
    estimatedCost: true;
    pricingAsOf: string;
  };
  benchmark: ReferenceQualityMetrics;
  retention: LifecycleMetrics & {
    upcomingExpirations: number;
    sampleCount: number;
  };
  actions: {
    ready: number;
    needsReview: number;
    blocked: number;
    stagedDryRuns: number;
    population: {
      activeRuns: number;
      actionProposals: number;
      maximumRuns: number;
      detailExpiryHours: number;
    };
  };
  runExplorer: MetricsRunExplorerRow[];
  resourceScenario: {
    currency: "SGD";
    inputs: {
      documents: number;
      fields: number;
      manualMinutesPerField: number;
      assistedMinutesPerField: number;
      loadedHourlyCost: number;
      averageModelCostPerRun: number;
    };
    modelCostAssumption: {
      sourceCurrency: "USD";
      targetCurrency: "SGD";
      averageModelCostPerRunUsd: number;
      usdToSgd: number;
      assumptionDate: string;
      illustrative: true;
    };
    result: ReturnType<typeof calculateResourceScenario> & {
      estimatedNetSavings: number;
    };
    illustrative: true;
    label: string;
  };
};

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

function averageDurations(
  records: Array<Record<string, number>>,
): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const durations of records) {
    for (const [stage, duration] of Object.entries(durations)) {
      const current = sums.get(stage) ?? { total: 0, count: 0 };
      sums.set(stage, {
        total: current.total + duration,
        count: current.count + 1,
      });
    }
  }
  return Object.fromEntries(
    [...sums].map(([stage, value]) => [stage, ratio(value.total, value.count)]),
  );
}

function isTerminalActiveRun(run: PublicRunRecord): boolean {
  return run.status === "completed" || run.status === "failed";
}

function compareWorkflowEvents(
  left: WorkflowEvent,
  right: WorkflowEvent,
): number {
  const leftTimestamp = Date.parse(left.createdAt);
  const rightTimestamp = Date.parse(right.createdAt);
  if (
    Number.isFinite(leftTimestamp) &&
    Number.isFinite(rightTimestamp) &&
    leftTimestamp !== rightTimestamp
  ) {
    return leftTimestamp - rightTimestamp;
  }
  if (left.id === right.id) return 0;
  return left.id > right.id ? 1 : -1;
}

function latestWorkflowEvent(run: PublicRunRecord): WorkflowEvent | null {
  if (!isTerminalActiveRun(run)) return null;
  const events = run.details?.workflowEvents ?? [];
  return events.reduce<WorkflowEvent | null>(
    (latest, event) =>
      latest === null || compareWorkflowEvents(event, latest) > 0
        ? event
        : latest,
    null,
  );
}

function summarizeWorkflowEvent(
  event: WorkflowEvent | null,
): LatestWorkflowEventSummary | null {
  return event === null
    ? null
    : {
        action: event.action,
        status: event.status,
        timestamp: event.createdAt,
      };
}

function expectedEvaluatorStatus(
  documentValue: string | null,
  referenceValue: string | null,
): "pass" | "conflict" | "not_found" {
  if (documentValue === null) return "not_found";
  return documentValue === referenceValue ? "pass" : "conflict";
}

export function calculateRecordedFixtureBenchmark(
  observations: readonly RecordedDocumentRunResult[] = recordedDocumentRunResults,
): ReferenceQualityMetrics {
  let exactMatches = 0;
  let totalFields = 0;
  let foundExpectedMissing = 0;
  let expectedMissing = 0;
  let evaluatorAgreements = 0;
  let evaluatorComparisons = 0;
  let falseClearCount = 0;
  let observationCount = 0;
  const expectedOutcomes: Record<string, number> = {};
  const actionStatuses: Record<string, number> = {};
  const familyCounts: Record<DocumentFamily, number> = {
    supplier_invoice: 0,
    warehouse_goods_receipt: 0,
  };
  const classificationCounts: Record<VariantClassification, number> = {
    correct: 0,
    attention: 0,
    incorrect: 0,
  };
  let unreadableCriticalEvidenceDetected = 0;
  let unreadableCriticalEvidenceFixtures = 0;

  for (const observation of observations) {
    const fixture = syntheticFixtures.find(
      (candidate) => candidate.id === observation.fixtureId,
    );
    if (!fixture) continue;
    observationCount += 1;
    familyCounts[fixture.family] += 1;
    classificationCounts[fixture.classification] += 1;
    expectedOutcomes[fixture.expectedOutcome] =
      (expectedOutcomes[fixture.expectedOutcome] ?? 0) + 1;
    actionStatuses[fixture.action.status] =
      (actionStatuses[fixture.action.status] ?? 0) + 1;
    for (const requestedField of fixture.requestedFields) {
      const expectedValue = fixture.documentData[requestedField.key] ?? null;
      const referenceValue = fixture.referenceData[requestedField.key] ?? null;
      const expectedStatus = expectedEvaluatorStatus(
        expectedValue,
        referenceValue,
      );
      const field = observation?.fields.find(
        (candidate) => candidate.key === requestedField.key,
      );
      totalFields += 1;
      evaluatorComparisons += 1;
      if (field?.extractedValue === expectedValue) exactMatches += 1;
      if (field?.evaluatorStatus === expectedStatus) evaluatorAgreements += 1;
      if (expectedValue === null) {
        expectedMissing += 1;
        if (
          field?.extractedValue === null &&
          field.evaluatorStatus === "not_found"
        ) {
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
    if (fixture.attentionReason === "unreadable_critical_evidence") {
      unreadableCriticalEvidenceFixtures += 1;
      const handwrittenFieldKey = fixture.handwrittenEvidence?.fieldKey;
      if (
        observation.outcome === "incomplete" &&
        handwrittenFieldKey !== undefined &&
        observation.fields.some(
          (field) =>
            field.key === handwrittenFieldKey &&
            field.evaluatorStatus === "not_found",
        )
      ) {
        unreadableCriticalEvidenceDetected += 1;
      }
    }
  }

  return {
    source: "deterministic_synthetic_observations" as const,
    observationCount,
    exactMatchRate: ratio(exactMatches, totalFields),
    missingFieldRecall: ratio(foundExpectedMissing, expectedMissing),
    evaluatorAgreement: ratio(evaluatorAgreements, evaluatorComparisons),
    falseClearCount,
    expectedOutcomes,
    actionStatuses,
    familyCounts,
    classificationCounts,
    unreadableCriticalEvidenceDetected,
    unreadableCriticalEvidenceFixtures,
    unreadableCriticalEvidenceDetectionRate: ratio(
      unreadableCriticalEvidenceDetected,
      unreadableCriticalEvidenceFixtures,
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
          message:
            "Operational metrics have been requested too frequently. Retry shortly.",
          requestId,
          status: 429,
          headers: noIndexHeaders,
        }),
      );
    }
    const cached = metricsCache.get(container.repository);
    if (
      cached &&
      cached.cutoffAt === container.publicOperationsCutoffAt &&
      cached.payload !== undefined &&
      cached.expiresAt > now.getTime()
    ) {
      return respond(
        safeJsonResponse(cached.payload, {
          status: 200,
          headers: noIndexHeaders,
        }),
      );
    }
    if (
      cached?.cutoffAt === container.publicOperationsCutoffAt &&
      cached.pending
    ) {
      return respond(
        safeJsonResponse(await cached.pending, {
          status: 200,
          headers: noIndexHeaders,
        }),
      );
    }
    const pending = (async (): Promise<MetricsPayload> => {
      const population = container.publicOperationsCutoffAt
        ? { createdAtOrAfter: container.publicOperationsCutoffAt }
        : undefined;
      const [
        aggregate,
        sourceOrigin,
        confirmedCosts,
        quota,
        runs,
        lifecycle,
        cleanupBacklog,
      ] = await Promise.all([
        container.repository.aggregateAnonymousUsage(population),
        container.repository.aggregateSourceOrigins(population),
        container.repository.aggregateConfirmedModelCosts(now, population),
        container.quotaRepository.snapshot(now),
        container.repository.listPublicRuns(now, {
          limit: METRICS_RUN_LIMIT,
          offset: 0,
          includeDetails: true,
          createdAtOrAfter: container.publicOperationsCutoffAt ?? undefined,
        }),
        container.repository.aggregateActiveDetailLifecycle(now, population),
        container.repository.countCleanupBacklog(now),
      ]);
      const latencies = runs.flatMap((run) =>
        run.latencyMs === null ? [] : [run.latencyMs],
      );
      const recordedRuns = runs.filter(
        (run) => run.executionMode === "recorded",
      ).length;
      const activeRuns = runs.filter(
        (run) => run.status !== "expired" && run.status !== "deleted",
      );
      const actions = activeRuns.flatMap((run) => {
        const action = run.details?.result?.action;
        return action ? [{ action, steps: run.details?.steps ?? [] }] : [];
      });
      const terminalActiveRuns = runs.filter(isTerminalActiveRun);
      const workflowStatus = {
        ready: 0,
        needsAttention: 0,
        incomplete: 0,
        processingErrors: 0,
      };
      for (const run of terminalActiveRuns) {
        if (run.status === "failed") {
          workflowStatus.processingErrors += 1;
          continue;
        }
        if (
          run.outcome !== null &&
          requiresSourceOriginReview(run.outcome, run.sourceOriginStatus)
        ) {
          workflowStatus.needsAttention += 1;
          continue;
        }
        switch (run.outcome) {
          case "clear":
          case "evidence_consistent":
            workflowStatus.ready += 1;
            break;
          case "needs_review":
          case "conflict":
            workflowStatus.needsAttention += 1;
            break;
          case "incomplete":
          case "not_found":
            workflowStatus.incomplete += 1;
            break;
          default:
            break;
        }
      }
      const latestEvents = new Map(
        runs.map((run) => [run.id, latestWorkflowEvent(run)] as const),
      );
      const workflowActivity: Record<WorkflowEventStatus, number> = {
        prepared: 0,
        staged: 0,
        simulated: 0,
      };
      for (const run of terminalActiveRuns) {
        const event = latestEvents.get(run.id);
        if (event) workflowActivity[event.status] += 1;
      }
      const performance: MetricsPerformance = {
        sampleCount: runs.length,
        p50LatencyMs: percentile(latencies, 0.5),
        p95LatencyMs: percentile(latencies, 0.95),
        retryCount: runs.reduce((total, run) => total + run.retryCount, 0),
        averageStepDurationsMs: averageDurations(
          runs.map((run) => run.stepDurations),
        ),
      };
      const operationalLifecycle: LifecycleMetrics = {
        activeDocuments: lifecycle.activeDocuments,
        activePublicUploads: lifecycle.activePublicUploads,
        expiryBuckets: {
          lessThanOneHour: lifecycle.expiryBuckets.lessThanOneHour,
          oneToSixHours: lifecycle.expiryBuckets.oneToSixHours,
          sixToTwentyFourHours: lifecycle.expiryBuckets.sixToTwentyFourHours,
        },
        cleanupBacklog,
      };
      const remainingUsd = Math.max(
        0,
        Number(
          (
            quota.dailyBudgetUsd -
            quota.globalSpendUsd -
            quota.reservedSpendUsd
          ).toFixed(8),
        ),
      );
      const averageModelCostPerRunUsd = confirmedCosts.averageEstimatedCostUsd;
      const illustrativeUsdToSgd = 1.35;
      const resourceInputs = {
        documents: 200,
        fields: 3,
        manualMinutesPerField: 2,
        assistedMinutesPerField: 0.5,
        loadedHourlyCost: 50,
        averageModelCostPerRun:
          averageModelCostPerRunUsd * illustrativeUsdToSgd,
      };
      const resourceResult = calculateResourceScenario(resourceInputs);
      const referenceQuality = calculateRecordedFixtureBenchmark();
      const payload: MetricsPayload = {
        generatedAt: now.toISOString(),
        operations: {
          workflowStatus,
          workflowActivity,
          performance,
          lifecycle: operationalLifecycle,
          origin: sourceOrigin,
        },
        costs: {
          estimated: true,
          currency: "USD",
          pricingAsOf,
          settledSpend: {
            todayUsd: quota.globalSpendUsd,
            monthToDateUsd: quota.monthToDateSpendUsd,
            mayIncludeConservativeSettlements: true,
          },
          completedRunEstimates: {
            todayUsd: confirmedCosts.todayEstimatedCostUsd,
            monthToDateUsd: confirmedCosts.monthToDateEstimatedCostUsd,
            completedModelRuns: confirmedCosts.completedRunCount,
            totalUsd: confirmedCosts.totalEstimatedCostUsd,
            averageUsd: confirmedCosts.averageEstimatedCostUsd,
          },
          byModel: confirmedCosts.byModel.map((row) => ({
            provider: row.provider,
            model: row.model,
            runCount: row.runCount,
            totalEstimatedCostUsd: row.totalEstimatedCostUsd,
            averageEstimatedCostUsd: row.averageEstimatedCostUsd,
          })),
          byFamily: confirmedCosts.byFamily.map((row) => ({
            documentFamily: row.documentFamily,
            runCount: row.runCount,
            totalEstimatedCostUsd: row.totalEstimatedCostUsd,
            averageEstimatedCostUsd: row.averageEstimatedCostUsd,
          })),
          dailyBudget: {
            limitUsd: quota.dailyBudgetUsd,
            settledUsd: quota.globalSpendUsd,
            reservedUsd: quota.reservedSpendUsd,
            remainingUsd,
            pendingReservations: quota.pendingReservationCount,
          },
        },
        referenceQuality,
        summary: {
          totalRuns: aggregate.totalRuns,
          completionRate: ratio(aggregate.completedRuns, aggregate.totalRuns),
          reviewRate: ratio(
            aggregate.reviewRequiredRuns,
            aggregate.completedRuns,
          ),
          failureRate: ratio(aggregate.failedRuns, aggregate.totalRuns),
        },
        performance,
        usage: {
          inputTokens: confirmedCosts.totalInputTokens,
          outputTokens: confirmedCosts.totalOutputTokens,
          providerSplit: {
            openai: confirmedCosts.providerCounts.openai,
            anthropic: confirmedCosts.providerCounts.anthropic,
          },
          recordedRuns,
          liveRuns: confirmedCosts.completedRunCount,
          estimatedApiCostUsd: confirmedCosts.totalEstimatedCostUsd,
          estimatedCost: true,
          pricingAsOf,
        },
        benchmark: referenceQuality,
        retention: {
          ...operationalLifecycle,
          upcomingExpirations: lifecycle.expiryBuckets.lessThanOneHour,
          sampleCount: runs.length,
        },
        actions: {
          ready: actions.filter(({ action }) => action.status === "ready")
            .length,
          needsReview: actions.filter(
            ({ action }) => action.status === "needs_review",
          ).length,
          blocked: actions.filter(({ action }) => action.status === "blocked")
            .length,
          stagedDryRuns: terminalActiveRuns.filter((run) => {
            const event = latestEvents.get(run.id);
            return (
              event?.action === "approve_and_stage" && event.status === "staged"
            );
          }).length,
          population: {
            activeRuns: activeRuns.length,
            actionProposals: actions.length,
            maximumRuns: METRICS_RUN_LIMIT,
            detailExpiryHours: PUBLIC_DETAIL_EXPIRY_HOURS,
          },
        },
        runExplorer: runs.map((run) => ({
          ...serializePublicRunListRow(run),
          latestWorkflowEvent: summarizeWorkflowEvent(
            latestEvents.get(run.id) ?? null,
          ),
        })),
        resourceScenario: {
          currency: "SGD",
          inputs: resourceInputs,
          modelCostAssumption: {
            sourceCurrency: "USD",
            targetCurrency: "SGD",
            averageModelCostPerRunUsd,
            usdToSgd: illustrativeUsdToSgd,
            assumptionDate: pricingAsOf,
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
      return payload;
    })();
    metricsCache.set(container.repository, {
      expiresAt: 0,
      cutoffAt: container.publicOperationsCutoffAt,
      pending,
    });
    let payload: MetricsPayload;
    try {
      payload = await pending;
      if (metricsCache.get(container.repository)?.pending === pending) {
        metricsCache.set(container.repository, {
          expiresAt: now.getTime() + METRICS_CACHE_TTL_MS,
          cutoffAt: container.publicOperationsCutoffAt,
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
