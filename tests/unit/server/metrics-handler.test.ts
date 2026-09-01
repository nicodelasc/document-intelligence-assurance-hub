import { describe, expect, it } from "vitest";
import { recordedDocumentRunResults } from "@/domain/fixtures";
import type { Outcome, RunStatus, WorkflowEvent } from "@/domain/types";
import {
  calculateRecordedFixtureBenchmark,
  handleMetricsGet,
} from "@/server/http/metrics-handler";
import type {
  ActiveDetailLifecycleAggregate,
  ConfirmedModelCostAggregate,
  PublicRunRecord,
} from "@/server/repositories/run-repository";
import type { QuotaSnapshot } from "@/server/security/rate-limit";
import {
  createTestContainer,
  readLines,
} from "../../contract/routes/test-support";
import { handleRunsPost } from "@/server/http/runs-handler";
import { handleRunDelete } from "@/server/http/run-detail-handler";
import { handleStageActionPost } from "@/server/http/stage-action-handler";
import { syntheticRequest } from "../../contract/routes/test-support";

function metricsRun({
  id,
  status = "completed",
  outcome = "clear",
  workflowEvents = [],
  latencyMs = 100,
}: {
  id: string;
  status?: RunStatus;
  outcome?: Outcome | null;
  workflowEvents?: WorkflowEvent[];
  latencyMs?: number | null;
}): PublicRunRecord {
  return {
    id,
    provider: "openai",
    model: "gpt-5.6-luna",
    promptVersion: "document-extraction-2026-08-29.v1",
    executionMode: "recorded",
    providerDispatched: false,
    sourceType: "synthetic",
    sourceOriginStatus: "server_original",
    documentFamily: "supplier_invoice",
    fixtureId: "invoice-clean-match",
    file: {
      filename: `${id}.pdf`,
      mediaType: "application/pdf",
      sizeBytes: 100,
      pageCount: 1,
    },
    requestedFields: [],
    status,
    outcome,
    usage: { inputTokens: 91_001, outputTokens: 91_002 },
    estimatedCostUsd: 91_003,
    consent: false,
    createdAt: "2026-08-29T10:00:00.000Z",
    completedAt: status === "completed" ? "2026-08-29T10:00:01.000Z" : null,
    expiresAt: "2026-08-30T09:55:00.000Z",
    deletedAt: null,
    retryCount: 0,
    latencyMs,
    stepDurations: { extracting: 40 },
    details: {
      steps: [],
      result: null,
      workflowEvents,
    },
  };
}

const confirmedCosts: ConfirmedModelCostAggregate = {
  completedRunCount: 2,
  totalInputTokens: 300,
  totalOutputTokens: 60,
  providerCounts: { openai: 1, anthropic: 1 },
  totalEstimatedCostUsd: 0.2,
  averageEstimatedCostUsd: 0.1,
  todayEstimatedCostUsd: 0.08,
  monthToDateEstimatedCostUsd: 0.2,
  byModel: [
    {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      runCount: 1,
      totalEstimatedCostUsd: 0.12,
      averageEstimatedCostUsd: 0.12,
    },
    {
      provider: "openai",
      model: "gpt-5.6-luna",
      runCount: 1,
      totalEstimatedCostUsd: 0.08,
      averageEstimatedCostUsd: 0.08,
    },
  ],
  byFamily: [
    {
      documentFamily: "supplier_invoice",
      runCount: 1,
      totalEstimatedCostUsd: 0.08,
      averageEstimatedCostUsd: 0.08,
    },
    {
      documentFamily: "warehouse_goods_receipt",
      runCount: 1,
      totalEstimatedCostUsd: 0.12,
      averageEstimatedCostUsd: 0.12,
    },
  ],
};

const lifecycle: ActiveDetailLifecycleAggregate = {
  activeDocuments: 3,
  activePublicUploads: 0,
  expiryBuckets: {
    lessThanOneHour: 1,
    oneToSixHours: 1,
    sixToTwentyFourHours: 1,
  },
};

const quotaSnapshot: QuotaSnapshot = {
  dailyBudgetUsd: 5,
  globalSpendUsd: 0.4,
  monthToDateSpendUsd: 0.9,
  reservedSpendUsd: 1,
  pendingReservationCount: 1,
  globalCustomUploads: 77,
  globalRecordedRuns: 88,
  customUploadsByBucket: { private_upload_bucket_sentinel: 3 },
  liveRunsByBucket: { private_live_bucket_sentinel: 6 },
  recordedRunsByBucket: { private_recorded_bucket_sentinel: 24 },
};

describe("recorded benchmark metrics", () => {
  it("builds allow-listed Operations and Costs metrics from distinct populations", async () => {
    const container = createTestContainer({
      clock: () => new Date("2026-08-29T12:00:00.000Z"),
    });
    const readyEvents: WorkflowEvent[] = [
      {
        id: "private_event_id_old",
        runId: "ready",
        action: "prepare_email",
        recipientRole: "private_recipient_role_sentinel",
        status: "prepared",
        createdAt: "2026-08-29T10:01:00.000Z",
      },
      {
        id: "private_event_id_a",
        runId: "ready",
        action: "approve_and_stage",
        recipientRole: "private_recipient_role_sentinel",
        status: "staged",
        createdAt: "2026-08-29T10:02:00.000Z",
      },
      {
        id: "private_event_id_b",
        runId: "ready",
        action: "download_summary",
        recipientRole: "private_recipient_role_sentinel",
        status: "simulated",
        createdAt: "2026-08-29T10:02:00.000Z",
      },
    ];
    const runs = [
      metricsRun({ id: "ready", workflowEvents: readyEvents }),
      metricsRun({
        id: "attention",
        outcome: "conflict",
        workflowEvents: [
          {
            id: "attention_event",
            runId: "attention",
            action: "request_clarification",
            recipientRole: "private_recipient_role_sentinel",
            status: "prepared",
            createdAt: "2026-08-29T10:03:00.000Z",
          },
        ],
      }),
      metricsRun({
        id: "incomplete",
        outcome: "not_found",
        workflowEvents: [
          {
            id: "incomplete_event",
            runId: "incomplete",
            action: "request_clearer_document",
            recipientRole: null,
            status: "staged",
            createdAt: "2026-08-29T10:04:00.000Z",
          },
        ],
      }),
      metricsRun({ id: "failed", status: "failed", outcome: null }),
      metricsRun({
        id: "processing",
        status: "extracting",
        outcome: null,
        workflowEvents: [
          {
            id: "processing_event_must_not_count",
            runId: "processing",
            action: "retry_processing",
            recipientRole: null,
            status: "simulated",
            createdAt: "2026-08-29T10:05:00.000Z",
          },
        ],
      }),
      metricsRun({ id: "expired", status: "expired", outcome: "clear" }),
      metricsRun({ id: "deleted", status: "deleted", outcome: "clear" }),
    ];
    container.repository.aggregateAnonymousUsage = async () => ({
      totalRuns: 91,
      completedRuns: 70,
      failedRuns: 7,
      totalInputTokens: 987_654_321,
      totalOutputTokens: 987_654_322,
      estimatedCostUsd: 987_654_323,
      providerCounts: { openai: 41, anthropic: 29 },
      outcomeCounts: {
        clear: 20,
        evidence_consistent: 10,
        needs_review: 15,
        conflict: 5,
        incomplete: 4,
        not_found: 2,
      },
    });
    container.repository.aggregateConfirmedModelCosts = async () =>
      structuredClone(confirmedCosts);
    container.quotaRepository.snapshot = async () =>
      ({
        ...structuredClone(quotaSnapshot),
        reservationId: "private_reservation_identifier_sentinel",
      }) as QuotaSnapshot;
    container.repository.listPublicRuns = async () => structuredClone(runs);
    container.repository.aggregateActiveDetailLifecycle = async () =>
      structuredClone(lifecycle);
    container.repository.countCleanupBacklog = async () => 4;

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const serialized = await response.text();
    const body = JSON.parse(serialized) as {
      operations: {
        workflowStatus: Record<string, number>;
        workflowActivity: Record<string, number>;
        performance: { sampleCount: number };
        lifecycle: Record<string, unknown>;
      };
      costs: Record<string, unknown>;
      usage: Record<string, unknown>;
      referenceQuality: Record<string, unknown>;
      retention: Record<string, unknown>;
      runExplorer: Array<{
        id: string;
        latestWorkflowEvent: Record<string, unknown> | null;
      }>;
      resourceScenario: {
        modelCostAssumption: { averageModelCostPerRunUsd: number };
      };
    };

    expect(body.operations.workflowStatus).toEqual({
      ready: 1,
      needsAttention: 1,
      incomplete: 1,
      processingErrors: 1,
    });
    expect(body.operations.workflowActivity).toEqual({
      prepared: 1,
      staged: 1,
      simulated: 1,
    });
    expect(body.operations.performance.sampleCount).toBe(7);
    expect(body.operations.lifecycle).toEqual({
      ...lifecycle,
      cleanupBacklog: 4,
    });
    expect(body.costs).toEqual({
      estimated: true,
      currency: "USD",
      pricingAsOf: "2026-09-01",
      settledSpend: {
        todayUsd: 0.4,
        monthToDateUsd: 0.9,
        mayIncludeConservativeSettlements: true,
      },
      completedRunEstimates: {
        todayUsd: 0.08,
        monthToDateUsd: 0.2,
        completedModelRuns: 2,
        totalUsd: 0.2,
        averageUsd: 0.1,
      },
      byModel: confirmedCosts.byModel,
      byFamily: confirmedCosts.byFamily,
      dailyBudget: {
        limitUsd: 5,
        settledUsd: 0.4,
        reservedUsd: 1,
        remainingUsd: 3.6,
        pendingReservations: 1,
      },
    });
    expect(body.usage).toMatchObject({
      inputTokens: 300,
      outputTokens: 60,
      providerSplit: { openai: 1, anthropic: 1 },
      estimatedApiCostUsd: 0.2,
    });
    expect(body.referenceQuality).toMatchObject({
      observationCount: 10,
      familyCounts: {
        supplier_invoice: 5,
        warehouse_goods_receipt: 5,
      },
      classificationCounts: {
        correct: 2,
        attention: 4,
        incorrect: 4,
      },
      unreadableCriticalEvidenceDetected: 2,
      unreadableCriticalEvidenceFixtures: 2,
      unreadableCriticalEvidenceDetectionRate: 1,
      falseClearCount: 0,
    });
    expect(body.retention).toEqual({
      ...lifecycle,
      upcomingExpirations: 1,
      cleanupBacklog: 4,
      sampleCount: 7,
    });
    expect(
      body.runExplorer.find((run) => run.id === "ready")?.latestWorkflowEvent,
    ).toEqual({
      action: "download_summary",
      status: "simulated",
      timestamp: "2026-08-29T10:02:00.000Z",
    });
    expect(
      body.runExplorer.find((run) => run.id === "processing")
        ?.latestWorkflowEvent,
    ).toBeNull();
    expect(
      body.resourceScenario.modelCostAssumption.averageModelCostPerRunUsd,
    ).toBe(0.1);
    for (const privateSentinel of [
      "987654321",
      "987654322",
      "987654323",
      "91001",
      "91002",
      "private_upload_bucket_sentinel",
      "private_live_bucket_sentinel",
      "private_recorded_bucket_sentinel",
      "private_reservation_identifier_sentinel",
      "private_recipient_role_sentinel",
      "private_event_id",
      "recipientRole",
      "reservationId",
      "customUploadsByBucket",
      "liveRunsByBucket",
      "recordedRunsByBucket",
    ]) {
      expect(serialized).not.toContain(privateSentinel);
    }
  });

  it("clamps the remaining daily model budget at zero", async () => {
    const container = createTestContainer();
    container.quotaRepository.snapshot = async () => ({
      ...structuredClone(quotaSnapshot),
      dailyBudgetUsd: 1,
      globalSpendUsd: 0.8,
      reservedSpendUsd: 0.5,
    });

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const body = (await response.json()) as {
      costs: { dailyBudget: { remainingUsd: number } };
    };

    expect(body.costs.dailyBudget.remainingUsd).toBe(0);
  });

  it("counts persisted action readiness and staged dry runs within the active run population", async () => {
    const container = createTestContainer();
    const runIds: string[] = [];

    for (const fixtureId of [
      "warehouse-clean-receipt",
      "invoice-buyer-hold",
      "invoice-unreadable-approval",
    ]) {
      const events = await readLines(
        await handleRunsPost(syntheticRequest(fixtureId), container),
      );
      const completed = events.find(
        (event): event is { type: "completed"; runId: string } =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "completed" &&
          typeof (event as { runId?: unknown }).runId === "string",
      );
      if (!completed) throw new Error("Completed run event is required");
      runIds.push(completed.runId);
    }

    await container.repository.createWorkflowEvent({
      runId: runIds[0],
      action: "approve_and_stage",
      recipientRole: null,
      status: "staged",
      now: container.clock(),
      eventId: "staged-latest",
    });
    await container.repository.createWorkflowEvent({
      runId: runIds[1],
      action: "approve_and_stage",
      recipientRole: null,
      status: "staged",
      now: container.clock(),
      eventId: "staged-older",
    });
    await container.repository.createWorkflowEvent({
      runId: runIds[1],
      action: "download_summary",
      recipientRole: null,
      status: "simulated",
      now: new Date(container.clock().getTime() + 1),
      eventId: "simulated-newer",
    });

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const body = (await response.json()) as {
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
    };

    expect(body.actions).toEqual({
      ready: 1,
      needsReview: 1,
      blocked: 1,
      stagedDryRuns: 1,
      population: {
        activeRuns: 3,
        actionProposals: 3,
        maximumRuns: 100,
        detailExpiryHours: 24,
      },
    });
  });

  it("does not count a prepared handoff as a staged dry run", async () => {
    const container = createTestContainer();
    const events = await readLines(
      await handleRunsPost(
        syntheticRequest("warehouse-clean-receipt"),
        container,
      ),
    );
    const completed = events.find(
      (
        event,
      ): event is { type: "completed"; runId: string; deletionToken: string } =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "completed" &&
        typeof (event as { runId?: unknown }).runId === "string" &&
        typeof (event as { deletionToken?: unknown }).deletionToken ===
          "string",
    );
    if (!completed) throw new Error("Completed run event is required");

    const before = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as { actions: { stagedDryRuns: number } };
    expect(before.actions.stagedDryRuns).toBe(0);

    const prepared = await handleStageActionPost(
      new Request(
        `http://local.test/api/runs/${completed.runId}/stage-action`,
        {
          method: "POST",
          headers: { "x-run-capability": completed.deletionToken },
        },
      ),
      { id: completed.runId },
      container,
    );
    expect(prepared.status).toBe(200);

    const after = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as { actions: { stagedDryRuns: number } };
    expect(after.actions.stagedDryRuns).toBe(0);
  });

  it("removes a deleted action from a warm metrics snapshot", async () => {
    const container = createTestContainer();
    const events = await readLines(
      await handleRunsPost(
        syntheticRequest("warehouse-clean-receipt"),
        container,
      ),
    );
    const completed = events.find(
      (
        event,
      ): event is { type: "completed"; runId: string; deletionToken: string } =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "completed" &&
        typeof (event as { runId?: unknown }).runId === "string" &&
        typeof (event as { deletionToken?: unknown }).deletionToken ===
          "string",
    );
    if (!completed) throw new Error("Completed run event is required");

    const before = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as {
      actions: { ready: number; population: { activeRuns: number } };
    };
    expect(before.actions).toMatchObject({
      ready: 1,
      population: { activeRuns: 1 },
    });

    const deleted = await handleRunDelete(
      new Request(`http://local.test/api/runs/${completed.runId}`, {
        method: "DELETE",
        headers: { "x-delete-token": completed.deletionToken },
      }),
      { id: completed.runId },
      container,
    );
    expect(deleted.status).toBe(202);

    const after = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as {
      actions: { ready: number; population: { activeRuns: number } };
    };
    expect(after.actions).toMatchObject({
      ready: 0,
      population: { activeRuns: 0 },
    });
  });

  it("excludes deterministic demo runs from actual provider usage", async () => {
    const container = createTestContainer();
    await (await handleRunsPost(syntheticRequest(), container)).text();

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const body = (await response.json()) as {
      usage: {
        providerSplit: { openai: number; anthropic: number };
        recordedRuns: number;
        liveRuns: number;
      };
    };

    expect(body.usage.providerSplit).toEqual({ openai: 0, anthropic: 0 });
    expect(body.usage.recordedRuns).toBe(1);
    expect(body.usage.liveRuns).toBe(0);
  });

  it("aggregates each provider-neutral fixture observation exactly once", async () => {
    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      createTestContainer(),
    );
    const body = (await response.json()) as {
      benchmark: {
        source: string;
        observationCount: number;
        expectedOutcomes: Record<string, number>;
        actionStatuses: Record<string, number>;
      };
    };

    expect(body.benchmark.source).toBe("deterministic_synthetic_observations");
    expect(body.benchmark.observationCount).toBe(10);
    expect(body.benchmark.expectedOutcomes).toEqual({
      clear: 2,
      needs_review: 6,
      incomplete: 2,
    });
    expect(body.benchmark.actionStatuses).toEqual({
      ready: 2,
      needs_review: 6,
      blocked: 2,
    });
    expect(body.benchmark).not.toHaveProperty("providerCoverage");
    expect(body.benchmark).not.toHaveProperty("recordedRuns");
    expect(body.benchmark).not.toHaveProperty("liveRuns");
  });

  it("returns zero observations without inventing benchmark coverage", () => {
    expect(calculateRecordedFixtureBenchmark([])).toEqual({
      source: "deterministic_synthetic_observations",
      observationCount: 0,
      exactMatchRate: 0,
      missingFieldRecall: 0,
      evaluatorAgreement: 0,
      falseClearCount: 0,
      expectedOutcomes: {},
      actionStatuses: {},
      familyCounts: {
        supplier_invoice: 0,
        warehouse_goods_receipt: 0,
      },
      classificationCounts: {
        correct: 0,
        attention: 0,
        incorrect: 0,
      },
      unreadableCriticalEvidenceDetected: 0,
      unreadableCriticalEvidenceFixtures: 0,
      unreadableCriticalEvidenceDetectionRate: 0,
    });
  });

  it("lowers extraction and evaluator scores for a corrupted document observation", () => {
    const observations = structuredClone(recordedDocumentRunResults);
    const invoice = observations.find(
      (observation) => observation.fixtureId === "invoice-total-mismatch",
    );
    if (!invoice)
      throw new Error("Invoice exception fixture observation is required");

    invoice.fields[0] = {
      ...invoice.fields[0],
      extractedValue: "Incorrect vendor",
      normalizedValue: "Incorrect vendor",
      evaluatorStatus: "conflict",
      referenceMatch: false,
    };

    const benchmark = calculateRecordedFixtureBenchmark(observations);

    expect(benchmark.exactMatchRate).toBeLessThan(1);
    expect(benchmark.evaluatorAgreement).toBeLessThan(1);
  });

  it("detects unreadable critical evidence only for incomplete declared handwriting", () => {
    const observations = structuredClone(recordedDocumentRunResults);
    const invoice = observations.find(
      (observation) => observation.fixtureId === "invoice-unreadable-approval",
    );
    const warehouse = observations.find(
      (observation) =>
        observation.fixtureId === "warehouse-unreadable-damage-note",
    );
    if (!invoice || !warehouse) {
      throw new Error("Both unreadable fixture observations are required");
    }

    const invoiceComments = invoice.fields.find(
      (field) => field.key === "reviewer_comments",
    );
    if (!invoiceComments) throw new Error("Invoice comments field is required");
    invoiceComments.evaluatorStatus = "conflict";
    invoiceComments.extractedValue = "guessed approval";
    invoiceComments.normalizedValue = "guessed approval";
    warehouse.outcome = "needs_review";

    expect(calculateRecordedFixtureBenchmark(observations)).toMatchObject({
      unreadableCriticalEvidenceDetected: 0,
      unreadableCriticalEvidenceFixtures: 2,
      unreadableCriticalEvidenceDetectionRate: 0,
    });
  });
});
