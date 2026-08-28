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
    provider: index % 2 === 0 ? ("openai" as const) : ("anthropic" as const),
    model: index % 2 === 0 ? "gpt-5-mini" : "claude-haiku-4.5",
    executionMode: "recorded" as const,
    sourceType: "synthetic" as const,
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

  it("updates URL state for selection, filters and pagination", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/operations");
    render(<RunExplorer runs={runs} onSelect={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /next page/i }));
    expect(window.location.search).toContain("page=2");
    await user.click(screen.getByRole("button", { name: /previous page/i }));
    await user.selectOptions(screen.getByLabelText(/provider filter/i), "anthropic");
    expect(window.location.search).toContain("provider=anthropic");
    await user.click(screen.getByRole("radio", { name: /select run_2/i }));
    expect(window.location.search).toContain("run=run_2");
  });

  it("restores filters, selection and page on popstate", async () => {
    window.history.replaceState({}, "", "/operations?provider=anthropic&q=fixture&page=2&run=run_12&outcome=conflict");
    const popRuns = runs.map((run, index) => ({
      ...run,
      outcome: index === 0 ? "not_found" as const : index === 11 ? "conflict" as const : run.outcome,
    }));
    render(<RunExplorer runs={popRuns} onSelect={() => undefined} />);

    expect(screen.getByLabelText("Provider filter")).toHaveValue("anthropic");
    expect(screen.getByLabelText("Outcome filter")).toHaveValue("conflict");
    expect(screen.getByLabelText("Search runs")).toHaveValue("fixture");

    window.history.pushState({}, "", "/operations?provider=openai&outcome=not_found&q=run_1&page=1&run=run_1");
    fireEvent(window, new PopStateEvent("popstate"));

    await waitFor(() => expect(screen.getByLabelText("Provider filter")).toHaveValue("openai"));
    expect(screen.getByLabelText("Outcome filter")).toHaveValue("not_found");
    expect(screen.getByLabelText("Search runs")).toHaveValue("run_1");
    expect(screen.getByRole("radio", { name: "Select run_1" })).toBeChecked();
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
    for (const heading of ["Structured extraction", "Reference comparison", "Telemetry and steps", "Safe errors", "Metadata"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }
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
  it("separates zero public provider counts from benchmark coverage", async () => {
    const metrics = {
      generatedAt: "2026-08-27T00:00:00.000Z",
      summary: { totalRuns: 0, completionRate: 0, reviewRate: 0, failureRate: 0 },
      performance: { sampleCount: 0, p50LatencyMs: 0, p95LatencyMs: 0, retryCount: 0, averageStepDurationsMs: {} },
      usage: { inputTokens: 0, outputTokens: 0, providerSplit: { openai: 0, anthropic: 0 }, recordedRuns: 0, liveRuns: 0, estimatedApiCostUsd: 0, pricingAsOf: "2026-08-27" },
      benchmark: { source: "recorded_fixture_replay", liveRuns: 0, recordedRuns: 6, providerCoverage: { openai: 3, anthropic: 3 }, exactMatchRate: 1, missingFieldRecall: 1, evaluatorAgreement: 1, falseClearCount: 0 },
      retention: { activePublicUploads: 0, upcomingExpirations: 0, cleanupBacklog: 0, sampleCount: 0 },
      runExplorer: [],
      resourceScenario: { modelCostAssumption: { averageModelCostPerRunUsd: 0, usdToSgd: 1.35 } },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(metrics), { status: 200 })));
    render(<OperationsDashboard />);

    const panel = (await screen.findByRole("heading", { name: "Provider usage" })).closest(".rule-panel")!;
    expect(within(panel).getByText("OpenAI 0 live runs")).toBeVisible();
    expect(within(panel).getByText("Anthropic 0 live runs")).toBeVisible();
    expect(within(panel).getByText("Benchmark coverage: OpenAI 3 · Anthropic 3")).toBeVisible();
    expect(within(panel).queryByText(/3 recorded references/i)).not.toBeInTheDocument();
  });
});
