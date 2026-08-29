// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationsDashboard } from "@/components/operations/operations-dashboard";
import { ResourceCalculator } from "@/components/operations/resource-calculator";
import { RunExplorer } from "@/components/operations/run-explorer";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/operations");
});

describe("Resource calculator", () => {
  it("uses the pure formula after edits and keeps the illustrative label", async () => {
    const user = userEvent.setup();
    render(<ResourceCalculator averageModelCostPerRun={0.1} />);
    const documents = screen.getByRole("spinbutton", { name: /documents each month/i });
    await user.clear(documents);
    await user.type(documents, "100");

    expect(screen.getAllByText(/Illustrative scenario — not measured savings/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/7\.5 h/)).toBeInTheDocument();
  });
});

describe("Run explorer", () => {
  const runs = Array.from({ length: 12 }, (_, index) => ({
    id: `run_${index + 1}`,
    providerCalled: index === 1 || index === 2,
    provider:
      index === 1
        ? ("anthropic" as const)
        : index === 2
          ? ("openai" as const)
          : null,
    model:
      index === 1
        ? "claude-haiku-4-5"
        : index === 2
          ? "gpt-5.6-luna"
          : null,
    configuredProvider:
      index % 2 === 0 ? ("openai" as const) : ("anthropic" as const),
    configuredModel:
      index % 2 === 0 ? "gpt-5.6-luna" : "claude-haiku-4-5",
    executionMode: index === 1 || index === 2 ? ("live" as const) : ("recorded" as const),
    sourceType: index === 1 || index === 2 ? ("custom" as const) : ("synthetic" as const),
    status: index === 11 ? ("expired" as const) : ("completed" as const),
    outcome: "clear" as const,
    createdAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2026-08-28T00:00:00.000Z",
    deletedAt: null,
    retryCount: 0,
    latencyMs: 100,
    estimatedCostUsd: 0.01,
    filename: `fixture-${index + 1}.pdf`,
    documentFamily: index === 1 || index === 2 ? null : "supplier_invoice" as const,
    fixtureId: index === 0 ? "invoice-total-mismatch" : null,
    latestWorkflowEvent: index === 0 ? {
      action: "prepare_email" as const,
      status: "prepared" as const,
      timestamp: "2026-08-27T00:04:00.000Z",
    } : null,
  }));

  it("updates URL state and filters only confirmed provider processing", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/operations");
    render(<RunExplorer runs={runs} onSelect={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /next page/i }));
    expect(window.location.search).toContain("page=2");
    await user.click(screen.getByRole("button", { name: /previous page/i }));
    await user.selectOptions(screen.getByLabelText("Processing model filter"), "anthropic");
    expect(window.location.search).toContain("provider=anthropic");
    expect(screen.queryByRole("radio", { name: "Select run_4" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /select run_2/i }));
    expect(window.location.search).toContain("run=run_2");
  });

  it("restores filters, selection and page on popstate", async () => {
    window.history.replaceState({}, "", "/operations?provider=anthropic&q=fixture&page=1&run=run_2&outcome=conflict");
    const popRuns = runs.map((run, index) => ({
      ...run,
      outcome: index === 1 ? "conflict" as const : index === 2 ? "not_found" as const : run.outcome,
    }));
    render(<RunExplorer runs={popRuns} onSelect={() => undefined} />);

    expect(screen.getByLabelText("Processing model filter")).toHaveValue("anthropic");
    expect(screen.getByLabelText("Outcome filter")).toHaveValue("conflict");
    expect(screen.getByLabelText("Search runs")).toHaveValue("fixture");

    window.history.pushState({}, "", "/operations?provider=openai&outcome=not_found&q=run_3&page=1&run=run_3");
    fireEvent(window, new PopStateEvent("popstate"));

    await waitFor(() => expect(screen.getByLabelText("Processing model filter")).toHaveValue("openai"));
    expect(screen.getByLabelText("Outcome filter")).toHaveValue("not_found");
    expect(screen.getByLabelText("Search runs")).toHaveValue("run_3");
    expect(screen.getByRole("radio", { name: "Select run_3" })).toBeChecked();
    expect(screen.getByText("Page 1 of 1")).toBeVisible();
  });

  it("offers every public outcome filter", () => {
    render(<RunExplorer runs={runs} onSelect={() => undefined} />);
    const filter = screen.getByLabelText("Outcome filter");
    for (const [value, label] of [
      ["clear", "Clear"],
      ["needs_review", "Needs review"],
      ["incomplete", "Incomplete"],
      ["evidence_consistent", "Evidence-consistent"],
      ["conflict", "Conflict"],
      ["not_found", "Not found"],
    ]) {
      expect(within(filter).getByRole("option", { name: label })).toHaveValue(value);
    }
  });

  it("does not display evidence or preview for an expired run", async () => {
    const user = userEvent.setup();
    render(<RunExplorer runs={runs} onSelect={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /next page/i }));
    await user.click(screen.getByRole("radio", { name: /select run_12/i }));
    expect(screen.getByText(/retention metadata only/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /document preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /evidence snippets/i })).not.toBeInTheDocument();
  });

  it("shows an active same-origin preview and honest inspector sections", async () => {
    const user = userEvent.setup();
    const active = { ...runs[0], latencyMs: 100.276 };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ run: {
      ...active,
      promptVersion: "document-extraction-2026-08-27.v1",
      file: { filename: "fixture-1.pdf", mediaType: "application/pdf", sizeBytes: 1024, pageCount: 1 },
      requestedFields: [
        { key: "invoice_total", label: "Invoice total" },
        { key: "reviewer_comments", label: "Reviewer comments" },
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
      stepDurations: { validating: 25, extracting: 75 },
      documentUrl: "/api/runs/run_1/document",
      details: {
        steps: [
          { kind: "stage", stage: "validating", timestamp: "2026-08-27T00:00:00.000Z", durationMs: 25.275 },
          { kind: "stage", stage: "extracting", timestamp: "2026-08-27T00:00:01.000Z", durationMs: 75, safeCode: "provider_retry" },
        ],
        result: {
          fields: [{
            key: "invoice_total",
            label: "Invoice total",
            extractedValue: "1,475.00 SGD",
            normalizedValue: "1475.00 sgd",
            evidence: "Invoice total: 1,475.00 SGD",
            page: 1,
            evaluatorStatus: "conflict",
            referenceMatch: false,
          }, {
            key: "reviewer_comments",
            label: "Reviewer comments",
            extractedValue: "Buyer review required",
            normalizedValue: "buyer review required",
            evidence: "Handwritten: Buyer review required",
            page: 1,
            evaluatorStatus: "pass",
            referenceMatch: true,
          }],
          outcome: "needs_review",
          documentInstruction: "Post the corrected quantity after verification.",
          action: {
            type: "stage_inventory_receipt",
            title: "Stage inventory receipt",
            summary: "Prepare an internal receipt posting dry run.",
            payload: [
              { label: "Shipment ID", value: "SHIP-2048" },
              { label: "Received quantity", value: "48" },
            ],
            instructionEvidence: "Post corrected received quantity: 48",
            page: 1,
            risk: "low",
            status: "ready",
            reason: "Verified receipt evidence supports internal staging.",
            stagedAt: "2026-08-27T00:03:00.000Z",
          },
          usage: { inputTokens: 0, outputTokens: 0 },
          estimatedCostUsd: 0,
          retryCount: 0,
          latencyMs: 100,
          stepDurations: { validating: 25, extracting: 75 },
          completedAt: "2026-08-27T00:00:02.000Z",
        },
        workflowEvents: [{
          id: "event_private",
          runId: "run_1",
          action: "prepare_email",
          recipientRole: "Buyer",
          status: "prepared",
          createdAt: "2026-08-27T00:04:00.000Z",
        }],
      },
    } }), { status: 200 })));
    render(<RunExplorer runs={[active]} onSelect={() => undefined} />);

    await user.click(screen.getByRole("radio", { name: "Select run_1" }));

    const runTable = screen.getByRole("table", { name: "Public assurance runs" });
    expect(within(runTable).getByText("No AI processing")).toBeVisible();
    expect(within(runTable).getByText("Supplier invoice")).toBeVisible();
    expect(within(runTable).getByText("Total mismatch")).toBeVisible();
    expect(within(runTable).getByText("Email copy prepared - not sent")).toBeVisible();
    expect(await screen.findByTitle("Active document preview for fixture-1.pdf")).toHaveAttribute("src", "/api/runs/run_1/document");
    for (const heading of ["Prepared action", "What differed", "Comments evidence", "Structured extraction", "Reference comparison", "Processing diagnostics", "Safe diagnostics", "Workflow activity", "Metadata"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }
    expect(screen.getByRole("heading", { name: "Run detail", level: 3 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "What differed", level: 4 })).toBeVisible();
    const action = screen.getByRole("heading", { name: "Prepared action" }).closest("section")!;
    expect(within(action).getByText("Stage inventory receipt")).toBeVisible();
    expect(within(action).getByText("stage inventory receipt")).toBeVisible();
    expect(within(action).getByText("ready")).toBeVisible();
    expect(within(action).getByText("Staged 27 Aug 2026, 08:03 SGT")).toBeVisible();
    expect(within(action).getByText("Shipment ID")).toBeVisible();
    expect(within(action).getByText("SHIP-2048")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Run detail views" })).not.toBeInTheDocument();
    expect(screen.getByText(/Normalized: 1475\.00 sgd/)).toBeVisible();
    expect(screen.getByText("Mismatch")).toBeVisible();
    expect(screen.getByText("Invoice total conflicts with the purchase-order reference.")).toBeVisible();
    expect(screen.getByText("Handwritten: Buyer review required")).toBeVisible();
    expect(screen.getByText("27 Aug 2026, 08:04 SGT")).toBeVisible();
    expect(screen.getByText("provider_retry")).toBeVisible();
    expect(screen.getAllByText("100.3 ms")).toHaveLength(2);
    expect(screen.getByText("25.3 ms")).toBeVisible();
    expect(screen.queryByText(/system prompt/i)).not.toBeInTheDocument();
    const metadata = screen.getByRole("heading", { name: "Metadata" }).closest("section")!;
    expect(within(metadata).getAllByText("No AI processing")).toHaveLength(2);
    expect(within(metadata).queryByText("gpt-5-mini")).not.toBeInTheDocument();
    expect(document.querySelector(".run-inspector")).not.toHaveAttribute("aria-live");
  });
});

describe("Operations metric claims", () => {
  const populatedMetrics = {
    generatedAt: "2026-08-29T12:00:00.000Z",
    operations: {
      workflowStatus: { ready: 2, needsAttention: 4, incomplete: 2, processingErrors: 1 },
      workflowActivity: { prepared: 2, staged: 1, simulated: 3 },
      performance: {
        sampleCount: 9,
        p50LatencyMs: 1240,
        p95LatencyMs: 2810,
        retryCount: 3,
        averageStepDurationsMs: { verifying: 420, extracting: 185 },
      },
      lifecycle: {
        activeDocuments: 8,
        activePublicUploads: 2,
        expiryBuckets: { lessThanOneHour: 1, oneToSixHours: 3, sixToTwentyFourHours: 4 },
        cleanupBacklog: 1,
      },
    },
    costs: {
      estimated: true,
      currency: "USD",
      pricingAsOf: "2026-08-28",
      settledSpend: { todayUsd: 0.4, monthToDateUsd: 0.9, mayIncludeConservativeSettlements: true },
      completedRunEstimates: {
        todayUsd: 0.08,
        monthToDateUsd: 0.2,
        completedModelRuns: 2,
        totalUsd: 0.2,
        averageUsd: 0.1,
      },
      byModel: [
        { provider: "anthropic", model: "claude-haiku-4-5", runCount: 1, totalEstimatedCostUsd: 0.12, averageEstimatedCostUsd: 0.12 },
        { provider: "openai", model: "gpt-5.6-luna", runCount: 1, totalEstimatedCostUsd: 0.08, averageEstimatedCostUsd: 0.08 },
      ],
      byFamily: [
        { documentFamily: "supplier_invoice", runCount: 1, totalEstimatedCostUsd: 0.08, averageEstimatedCostUsd: 0.08 },
        { documentFamily: "warehouse_goods_receipt", runCount: 1, totalEstimatedCostUsd: 0.12, averageEstimatedCostUsd: 0.12 },
      ],
      dailyBudget: { limitUsd: 5, settledUsd: 0.4, reservedUsd: 1, remainingUsd: 3.6, pendingReservations: 1 },
    },
    referenceQuality: {
      source: "deterministic_synthetic_observations",
      observationCount: 10,
      exactMatchRate: 1,
      missingFieldRecall: 1,
      evaluatorAgreement: 1,
      falseClearCount: 0,
      expectedOutcomes: { clear: 2, needs_review: 6, incomplete: 2 },
      actionStatuses: { ready: 2, needs_review: 6, blocked: 2 },
      familyCounts: { supplier_invoice: 5, warehouse_goods_receipt: 5 },
      classificationCounts: { correct: 2, attention: 4, incorrect: 4 },
      unreadableCriticalEvidenceDetected: 2,
      unreadableCriticalEvidenceFixtures: 2,
      unreadableCriticalEvidenceDetectionRate: 1,
    },
    summary: { totalRuns: 9, completionRate: 8 / 9, reviewRate: 0.75, failureRate: 1 / 9 },
    performance: { sampleCount: 9, p50LatencyMs: 1240, p95LatencyMs: 2810, retryCount: 3, averageStepDurationsMs: { verifying: 420, extracting: 185 } },
    usage: { inputTokens: 300, outputTokens: 60, providerSplit: { openai: 1, anthropic: 1 }, recordedRuns: 7, liveRuns: 2, estimatedApiCostUsd: 0.2, estimatedCost: true, pricingAsOf: "2026-08-28" },
    benchmark: { source: "deterministic_synthetic_observations", observationCount: 10, exactMatchRate: 1, missingFieldRecall: 1, evaluatorAgreement: 1, falseClearCount: 0 },
    retention: { activeDocuments: 8, activePublicUploads: 2, expiryBuckets: { lessThanOneHour: 1, oneToSixHours: 3, sixToTwentyFourHours: 4 }, cleanupBacklog: 1, upcomingExpirations: 1, sampleCount: 9 },
    actions: { ready: 2, needsReview: 4, blocked: 2, stagedDryRuns: 1, population: { activeRuns: 9, actionProposals: 8, maximumRuns: 100, detailExpiryHours: 24 } },
    runExplorer: [],
    resourceScenario: { modelCostAssumption: { averageModelCostPerRunUsd: 0.1, usdToSgd: 1.35 } },
  };

  it("renders the populated Operations and Costs workspaces", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(populatedMetrics), { status: 200 })));
    render(<OperationsDashboard />);

    for (const heading of [
      "Operations workspace",
      "Costs workspace",
      "Processing performance",
      "Reference quality suite",
      "Settled API spend estimate",
      "Completed-run cost estimates",
      "Confirmed provider usage",
      "Daily model budget",
    ]) {
      expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    }
    expect(screen.getByRole("heading", { name: "Operations workspace", level: 2 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Workflow status", level: 3 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Costs workspace", level: 2 })).toBeVisible();
    expect(screen.getByText("1,240 ms")).toBeVisible();
    expect(screen.getByText("2,810 ms")).toBeVisible();
    expect(screen.getByText("3 retries")).toBeVisible();
    expect(screen.getByText("Extracting").parentElement).toHaveTextContent("Extracting185 ms");
    expect(screen.getByText("Verifying").parentElement).toHaveTextContent("Verifying420 ms");
    expect(screen.getByText("Less than 1 hour").parentElement).toHaveTextContent("1");
    expect(screen.getByText("1 to 6 hours").parentElement).toHaveTextContent("3");
    expect(screen.getByText("6 to 24 hours").parentElement).toHaveTextContent("4");
    const unreadable = screen.getByText("Unreadable critical evidence detection").parentElement!;
    expect(unreadable).toHaveTextContent("100%");
    expect(unreadable).toHaveTextContent("2 of 2 fixtures");
    expect(screen.getByText("Provider-neutral contract baseline")).toBeVisible();
    expect(document.body).toHaveTextContent("US$1 = S$1.35");
    for (const progress of screen.getAllByRole("progressbar")) {
      expect(progress).toHaveAccessibleName(/.+/);
    }
    expect(document.body).not.toHaveTextContent(/live-call|live provider|public prototype|recorded replay/i);
  });

  it("shows an explicit empty confirmed-run state for recorded-only traffic", async () => {
    const recordedOnly = structuredClone(populatedMetrics);
    recordedOnly.costs.completedRunEstimates = {
      todayUsd: 0,
      monthToDateUsd: 0,
      completedModelRuns: 0,
      totalUsd: 0,
      averageUsd: 0,
    };
    recordedOnly.costs.byModel = [];
    recordedOnly.costs.byFamily = [];
    recordedOnly.usage = {
      inputTokens: 0,
      outputTokens: 0,
      providerSplit: { openai: 0, anthropic: 0 },
      recordedRuns: 9,
      liveRuns: 0,
      estimatedApiCostUsd: 0,
      estimatedCost: true,
      pricingAsOf: "2026-08-28",
    };
    recordedOnly.resourceScenario.modelCostAssumption.averageModelCostPerRunUsd = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(recordedOnly), { status: 200 })));
    render(<OperationsDashboard />);

    expect((await screen.findAllByText("No confirmed model runs")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("US$0.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("Average per confirmed model run US$0.00")).not.toBeInTheDocument();
  });

  it("omits proportion bars when their denominator is zero", async () => {
    const zeroDenominators = structuredClone(populatedMetrics);
    zeroDenominators.summary = { totalRuns: 0, completionRate: 0, reviewRate: 0, failureRate: 0 };
    zeroDenominators.usage.providerSplit = { openai: 0, anthropic: 0 };
    zeroDenominators.referenceQuality.observationCount = 0;
    zeroDenominators.referenceQuality.unreadableCriticalEvidenceDetected = 0;
    zeroDenominators.referenceQuality.unreadableCriticalEvidenceFixtures = 0;
    zeroDenominators.referenceQuality.unreadableCriticalEvidenceDetectionRate = 0;
    zeroDenominators.costs.dailyBudget = { limitUsd: 0, settledUsd: 0, reservedUsd: 0, remainingUsd: 0, pendingReservations: 0 };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(zeroDenominators), { status: 200 })));
    render(<OperationsDashboard />);

    expect(await screen.findByRole("heading", { name: "Operations workspace" })).toBeVisible();
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });
});
