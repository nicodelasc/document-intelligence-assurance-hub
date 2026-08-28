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
  }));

  it("updates URL state and filters only live provider calls", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/operations");
    render(<RunExplorer runs={runs} onSelect={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /next page/i }));
    expect(window.location.search).toContain("page=2");
    await user.click(screen.getByRole("button", { name: /previous page/i }));
    await user.selectOptions(screen.getByLabelText("Live-call provider filter"), "anthropic");
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

    expect(screen.getByLabelText("Live-call provider filter")).toHaveValue("anthropic");
    expect(screen.getByLabelText("Outcome filter")).toHaveValue("conflict");
    expect(screen.getByLabelText("Search runs")).toHaveValue("fixture");

    window.history.pushState({}, "", "/operations?provider=openai&outcome=not_found&q=run_3&page=1&run=run_3");
    fireEvent(window, new PopStateEvent("popstate"));

    await waitFor(() => expect(screen.getByLabelText("Live-call provider filter")).toHaveValue("openai"));
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
      requestedFields: [{ key: "vendor_name", label: "Vendor name" }],
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
            key: "vendor_name",
            label: "Vendor name",
            extractedValue: "Northstar Paperworks",
            normalizedValue: "northstar paperworks",
            evidence: "Supplier: Northstar Paperworks",
            page: 1,
            evaluatorStatus: "pass",
            referenceMatch: true,
          }],
          outcome: "clear",
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
      },
    } }), { status: 200 })));
    render(<RunExplorer runs={[active]} onSelect={() => undefined} />);

    await user.click(screen.getByRole("radio", { name: "Select run_1" }));

    const runTable = screen.getByRole("table", { name: "Public assurance runs" });
    expect(within(runTable).getByText("Not called (demo)")).toBeVisible();
    expect(await screen.findByTitle("Active document preview for fixture-1.pdf")).toHaveAttribute("src", "/api/runs/run_1/document");
    for (const heading of ["Prepared action", "Structured extraction", "Reference comparison", "Diagnostics", "Safe errors", "Metadata"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }
    const action = screen.getByRole("heading", { name: "Prepared action" }).closest("section")!;
    expect(within(action).getByText("Stage inventory receipt")).toBeVisible();
    expect(within(action).getByText("stage inventory receipt")).toBeVisible();
    expect(within(action).getByText("ready")).toBeVisible();
    expect(within(action).getByText("Staged 27 Aug 2026, 08:03 SGT")).toBeVisible();
    expect(within(action).getByText("Shipment ID")).toBeVisible();
    expect(within(action).getByText("SHIP-2048")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Run detail views" })).not.toBeInTheDocument();
    expect(screen.getByText(/Normalized: northstar paperworks/)).toBeVisible();
    expect(screen.getByText("Match")).toBeVisible();
    expect(screen.getByText("provider_retry")).toBeVisible();
    expect(screen.getAllByText("100.3 ms")).toHaveLength(2);
    expect(screen.getByText("25.3 ms")).toBeVisible();
    expect(screen.queryByText(/system prompt/i)).not.toBeInTheDocument();
    const metadata = screen.getByRole("heading", { name: "Metadata" }).closest("section")!;
    expect(within(metadata).getAllByText("Not called (demo)")).toHaveLength(2);
    expect(within(metadata).queryByText("gpt-5-mini")).not.toBeInTheDocument();
  });
});

describe("Operations metric claims", () => {
  it("shows persisted action readiness with its run population and expiry boundary", async () => {
    const metrics = {
      generatedAt: "2026-08-27T00:00:00.000Z",
      summary: { totalRuns: 4, completionRate: 1, reviewRate: 0.5, failureRate: 0 },
      performance: { sampleCount: 4, p50LatencyMs: 100, p95LatencyMs: 200, retryCount: 0, averageStepDurationsMs: {} },
      usage: { inputTokens: 0, outputTokens: 0, providerSplit: { openai: 0, anthropic: 0 }, recordedRuns: 4, liveRuns: 0, estimatedApiCostUsd: 0, pricingAsOf: "2026-08-28" },
      benchmark: { source: "deterministic_synthetic_observations", observationCount: 3, exactMatchRate: 1, missingFieldRecall: 1, evaluatorAgreement: 1, falseClearCount: 0 },
      retention: { activePublicUploads: 0, upcomingExpirations: 1, cleanupBacklog: 0, sampleCount: 4 },
      actions: {
        ready: 1,
        needsReview: 2,
        blocked: 1,
        stagedDryRuns: 2,
        population: { activeRuns: 4, actionProposals: 4, maximumRuns: 100, detailExpiryHours: 24 },
      },
      runExplorer: [],
      resourceScenario: { modelCostAssumption: { averageModelCostPerRunUsd: 0, usdToSgd: 1.35 } },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(metrics), { status: 200 })));
    render(<OperationsDashboard />);

    const panel = (await screen.findByRole("heading", { name: "Action readiness" })).closest(".rule-panel")!;
    expect(within(panel).getByText("Ready").parentElement).toHaveTextContent("Ready1");
    expect(within(panel).getByText("Needs review").parentElement).toHaveTextContent("Needs review2");
    expect(within(panel).getByText("Blocked").parentElement).toHaveTextContent("Blocked1");
    expect(within(panel).getByText("Staged dry runs").parentElement).toHaveTextContent("Staged dry runs2");
    expect(within(panel).getByText("4 action proposals across 4 active runs.")).toBeVisible();
    expect(within(panel).getByText("Latest 100 runs inspected. Details expire within 24 hours.")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Latency and step duration" })).not.toBeInTheDocument();
  });

  it("separates zero live calls from provider-neutral deterministic coverage", async () => {
    const metrics = {
      generatedAt: "2026-08-27T00:00:00.000Z",
      summary: { totalRuns: 0, completionRate: 0, reviewRate: 0, failureRate: 0 },
      performance: { sampleCount: 0, p50LatencyMs: 0, p95LatencyMs: 0, retryCount: 0, averageStepDurationsMs: {} },
      usage: { inputTokens: 0, outputTokens: 0, providerSplit: { openai: 0, anthropic: 0 }, recordedRuns: 0, liveRuns: 0, estimatedApiCostUsd: 0, pricingAsOf: "2026-08-28" },
      benchmark: { source: "deterministic_synthetic_observations", observationCount: 3, exactMatchRate: 1, missingFieldRecall: 1, evaluatorAgreement: 1, falseClearCount: 0 },
      retention: { activePublicUploads: 0, upcomingExpirations: 0, cleanupBacklog: 0, sampleCount: 0 },
      runExplorer: [],
      resourceScenario: { modelCostAssumption: { averageModelCostPerRunUsd: 0, usdToSgd: 1.35 } },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(metrics), { status: 200 })));
    render(<OperationsDashboard />);

    const panel = (await screen.findByRole("heading", { name: "Provider usage" })).closest(".rule-panel")!;
    expect(within(panel).getByText("OpenAI 0 live runs")).toBeVisible();
    expect(within(panel).getByText("Anthropic 0 live runs")).toBeVisible();
    expect(within(panel).getByText("Deterministic observations: 3 synthetic fixtures")).toBeVisible();
    expect(within(panel).getByText("Text summary: Live-call counts exclude deterministic benchmark scenarios.")).toBeVisible();
    expect(screen.getByText("Deterministic synthetic evidence · provider-neutral observations")).toBeVisible();
    expect(screen.queryByText(/recorded benchmark/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/fixture-provider|Benchmark coverage:|OpenAI 3|Anthropic 3/i)).not.toBeInTheDocument();
  });
});
