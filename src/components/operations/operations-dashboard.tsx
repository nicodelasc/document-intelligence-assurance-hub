"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import type { DocumentFamily, Provider, VariantClassification, WorkflowEventStatus } from "@/domain/types";
import { CostsWorkspace } from "./costs-workspace";
import { operationsTourTargetIds } from "./guided-tour-config";
import { OperationsWorkspace } from "./operations-workspace";
import type { ExplorerRun } from "./run-explorer";

export type MetricsSummary = {
  totalRuns: number;
  completionRate: number;
  reviewRate: number;
  failureRate: number;
};

export type PerformanceMetrics = {
  sampleCount: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  retryCount: number;
  averageStepDurationsMs: Record<string, number>;
};

export type OperationsMetrics = {
  workflowStatus: {
    ready: number;
    needsAttention: number;
    incomplete: number;
    processingErrors: number;
  };
  workflowActivity: Record<WorkflowEventStatus, number>;
  performance: PerformanceMetrics;
  lifecycle: {
    activeDocuments: number;
    activePublicUploads: number;
    expiryBuckets: {
      lessThanOneHour: number;
      oneToSixHours: number;
      sixToTwentyFourHours: number;
    };
    cleanupBacklog: number;
  };
  origin: {
    serverOriginal: number;
    recognizedCopy: number;
    unverified: number;
  };
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

export type CostMetrics = {
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
  byModel: Array<{
    provider: Provider;
    model: string;
    runCount: number;
    totalEstimatedCostUsd: number;
    averageEstimatedCostUsd: number;
  }>;
  byFamily: Array<{
    documentFamily: DocumentFamily;
    runCount: number;
    totalEstimatedCostUsd: number;
    averageEstimatedCostUsd: number;
  }>;
  dailyBudget: {
    limitUsd: number;
    settledUsd: number;
    reservedUsd: number;
    remainingUsd: number;
    pendingReservations: number;
  };
};

export type ConfirmedUsageMetrics = {
  inputTokens: number;
  outputTokens: number;
  providerSplit: Record<Provider, number>;
  recordedRuns: number;
  liveRuns: number;
  estimatedApiCostUsd: number;
  estimatedCost: true;
  pricingAsOf: string;
};

export type MetricsPayload = {
  generatedAt: string;
  operations: OperationsMetrics;
  costs: CostMetrics;
  referenceQuality: ReferenceQualityMetrics;
  summary: MetricsSummary;
  performance: PerformanceMetrics;
  usage: ConfirmedUsageMetrics;
  benchmark: ReferenceQualityMetrics;
  retention: OperationsMetrics["lifecycle"] & {
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
  runExplorer: ExplorerRun[];
  resourceScenario: {
    modelCostAssumption: {
      sourceCurrency?: "USD";
      targetCurrency?: "SGD";
      averageModelCostPerRunUsd: number;
      usdToSgd: number;
      assumptionDate?: string;
      illustrative?: true;
    };
  };
};

const percent = new Intl.NumberFormat("en-SG", {
  style: "percent",
  maximumFractionDigits: 1,
});

const updateTime = new Intl.DateTimeFormat("en-SG", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Singapore",
});

const OPERATIONS_REFRESH_INTERVAL_MS = 15_000;

export function OperationsDashboard() {
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestInFlight = useRef(false);

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/metrics", {
        signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Operational metrics are temporarily unavailable.");
      }
      setMetrics((await response.json()) as MetricsPayload);
    } catch (reason) {
      if (reason instanceof Error && reason.name !== "AbortError") {
        setError(reason.message);
      }
    } finally {
      requestInFlight.current = false;
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refreshVisibleDashboard = () => {
      if (document.visibilityState !== "hidden") {
        void load(controller.signal, true);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshVisibleDashboard();
    };
    queueMicrotask(() => void load(controller.signal));
    const intervalId = window.setInterval(
      refreshVisibleDashboard,
      OPERATIONS_REFRESH_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [load]);

  if (error && !metrics) {
    return (
      <main id="main-content" className="page">
        <header className="page-intro">
          <div>
            <h1>Procurement review operations</h1>
            <p>Review supplier invoice and goods receipt triage before finance or inventory handoff.</p>
          </div>
        </header>
        <div className="route-error" role="alert">
          <h2>Operations could not load</h2>
          <p>{error}</p>
          <Button type="button" onClick={() => load()}>
            Retry metrics
          </Button>
        </div>
      </main>
    );
  }

  const summary = metrics?.summary ?? {
    totalRuns: 0,
    completionRate: 0,
    reviewRate: 0,
    failureRate: 0,
  };

  return (
    <main id="main-content" className="page operations-page" aria-busy={loading}>
      <header className="page-intro">
        <div>
          <h1>Procurement review operations</h1>
          <p>Monitor supplier invoice and goods receipt triage before finance or inventory handoff.</p>
        </div>
        <div className="operations-refresh-status">
          <span className="status-inline">
            <span className="status-mark status-mark--pass" aria-hidden="true" />
            Auto-refresh on
          </span>
          <small>
            {refreshing
              ? "Checking for completed runs…"
              : metrics
                ? `Updated ${updateTime.format(new Date(metrics.generatedAt))} SGT`
                : "Waiting for the first update"}
          </small>
          {error && metrics ? (
            <small role="status">Refresh delayed. Showing the last update.</small>
          ) : null}
        </div>
      </header>
      {loading ? <div className="loading-band" role="status">Loading operational ledger…</div> : null}
      <section
        id={operationsTourTargetIds.runOverview}
        className="metric-band tour-target"
        aria-label="Procurement triage summary metrics"
      >
        <Metric label="Documents triaged" value={String(summary.totalRuns)} detail="Anonymous procurement reviews" />
        <Metric label="Completion rate" value={percent.format(summary.completionRate)} detail="Completed triage records" />
        <Metric label="Review-required rate" value={percent.format(summary.reviewRate)} detail="Completed records requiring human review" />
        <Metric label="Failure rate" value={percent.format(summary.failureRate)} detail="Safe terminal failures" />
      </section>
      {metrics ? (
        <div className="operations-costs-layout">
          <OperationsWorkspace
            operations={metrics.operations}
            referenceQuality={metrics.referenceQuality}
            runs={metrics.runExplorer}
            summary={metrics.summary}
          />
          <CostsWorkspace
            costs={metrics.costs}
            usage={metrics.usage}
            usdToSgd={metrics.resourceScenario.modelCostAssumption.usdToSgd}
          />
        </div>
      ) : null}
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
