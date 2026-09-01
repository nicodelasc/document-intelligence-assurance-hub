// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { OperationsDashboard } from "@/components/operations/operations-dashboard";
import { ResourceCalculator } from "@/components/operations/resource-calculator";
import { RunExplorer } from "@/components/operations/run-explorer";

const navigationState = vi.hoisted(() => ({ pathname: "/operations" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

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
    sourceOriginStatus: index === 1 ? ("unverified" as const) : index === 2 ? ("recognized_copy" as const) : ("server_original" as const),
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
    expect(screen.queryByRole("radio", { name: "Select fixture-4.pdf" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Select fixture-2.pdf, Evidence-consistent, received 27 Aug 2026, 08:00 SGT" }));
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
    expect(screen.getByLabelText("Search review records")).toHaveValue("fixture");

    window.history.pushState({}, "", "/operations?provider=openai&outcome=not_found&q=run_3&page=1&run=run_3");
    fireEvent(window, new PopStateEvent("popstate"));

    await waitFor(() => expect(screen.getByLabelText("Processing model filter")).toHaveValue("openai"));
    expect(screen.getByLabelText("Outcome filter")).toHaveValue("not_found");
    expect(screen.getByLabelText("Search review records")).toHaveValue("run_3");
    expect(screen.getByRole("radio", { name: "Select fixture-3.pdf, Not found, received 27 Aug 2026, 08:00 SGT" })).toBeChecked();
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

  it("keeps the complete business-first queue sequence ahead of source checks", () => {
    render(<RunExplorer runs={runs} onSelect={() => undefined} />);

    const queue = screen.getByRole("table", { name: "Procurement review queue" });
    expect(within(queue).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Document reference",
      "Document type",
      "Review decision",
      "Exception",
      "Prepared next step",
      "Received time",
      "Source check",
    ]);
  });

  it("uses individual source labels in review queue rows", () => {
    render(<RunExplorer runs={runs.slice(0, 3)} onSelect={() => undefined} />);

    const queue = screen.getByRole("table", { name: "Procurement review queue" });
    for (const [reference, sourceLabel] of [
      ["INV-MP-4101", "Original demo document"],
      ["fixture-2.pdf", "Source unverified"],
      ["fixture-3.pdf", "Exact copy of a demo document"],
    ]) {
      const row = within(queue)
        .getByRole("radio", { name: new RegExp(`^Select ${reference},`) })
        .closest("tr")!;
      expect(within(row).getByText(sourceLabel)).toBeVisible();
    }
    for (const aggregateLabel of [
      "Original demo runs",
      "Exact-copy uploads",
      "Unverified uploads",
    ]) {
      expect(within(queue).queryByText(aggregateLabel)).not.toBeInTheDocument();
    }
  });

  it("keeps custom outcomes evidence-only in the review queue", () => {
    const customRuns = [
      { ...runs[1], id: "custom_evidence", filename: "custom-evidence.pdf", sourceType: "custom" as const, outcome: "evidence_consistent" as const },
      { ...runs[2], id: "custom_conflict", filename: "custom-conflict.pdf", sourceType: "custom" as const, outcome: "conflict" as const },
      { ...runs[3], id: "custom_missing", filename: "custom-missing.pdf", sourceType: "custom" as const, outcome: "not_found" as const },
    ];
    render(<RunExplorer runs={customRuns} onSelect={() => undefined} />);

    const queue = screen.getByRole("table", { name: "Procurement review queue" });
    expect(within(queue).getAllByRole("columnheader")[0]).toHaveTextContent("Document reference");
    for (const [reference, label] of [
      ["custom-evidence.pdf", "Evidence-consistent"],
      ["custom-conflict.pdf", "Conflict"],
      ["custom-missing.pdf", "Not found"],
    ]) {
      const radio = within(queue).getByRole("radio", { name: `Select ${reference}, ${label}, received 27 Aug 2026, 08:00 SGT` });
      const row = radio.closest("tr")!;
      expect(within(row).getByText(label)).toBeVisible();
      expect(within(row).getByText("Evidence only - no business approval")).toBeVisible();
      expect(within(row).queryByText("Ready for posting review")).not.toBeInTheDocument();
    }
    expect(screen.getByLabelText("Search review records")).toBeVisible();
    expect(screen.getByRole("region", { name: "Scrollable procurement review queue" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Review queue pagination" })).toBeVisible();
    expect(screen.getByText("3 matching review records")).toBeVisible();
  });

  it("distinguishes repeated document references without exposing run IDs", async () => {
    const user = userEvent.setup();
    const repeatedRuns = [
      { ...runs[0], id: "repeat_alpha", outcome: "needs_review" as const, createdAt: "2026-08-27T00:00:00.000Z" },
      { ...runs[0], id: "repeat_beta", outcome: "needs_review" as const, createdAt: "2026-08-27T00:00:00.000Z" },
    ];
    render(<RunExplorer runs={repeatedRuns} onSelect={() => undefined} />);

    const first = screen.getByRole("radio", {
      name: "Select INV-MP-4101, Exception review required, received 27 Aug 2026, 08:00 SGT, review record 1 of 2",
    });
    const second = screen.getByRole("radio", {
      name: "Select INV-MP-4101, Exception review required, received 27 Aug 2026, 08:00 SGT, review record 2 of 2",
    });
    const names = screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
    expect(names.join(" ")).not.toMatch(/repeat_alpha|repeat_beta/);
    expect(first.closest("th")).toHaveAttribute("scope", "row");
    expect(second.closest("th")).toHaveAttribute("scope", "row");

    await user.click(second);
    expect(window.location.search).toContain("run=repeat_beta");
  });

  it("distinguishes production-shaped retained records received at the same time", () => {
    const retainedRuns = runs.slice(0, 2).map((run, index) => {
      const serialized = { ...run };
      delete serialized.documentFamily;
      delete serialized.fixtureId;
      delete serialized.filename;
      return {
        ...serialized,
        id: `retained_duplicate_${index + 1}`,
        status: "expired" as const,
        outcome: "clear" as const,
        createdAt: "2026-08-27T00:00:00.000Z",
      };
    });
    render(<RunExplorer runs={retainedRuns} onSelect={() => undefined} />);

    const first = screen.getByRole("radio", {
      name: "Select Expired review record, Evidence expired, received 27 Aug 2026, 08:00 SGT, review record 1 of 2",
    });
    const second = screen.getByRole("radio", {
      name: "Select Expired review record, Evidence expired, received 27 Aug 2026, 08:00 SGT, review record 2 of 2",
    });
    const names = screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
    expect(names.join(" ")).not.toMatch(/retained_duplicate/);
    expect(first.closest("th")).toHaveAttribute("scope", "row");
    expect(second.closest("th")).toHaveAttribute("scope", "row");
  });

  it("uses neutral retention states without active handoffs", () => {
    const retainedCases = [
      { status: "expired" as const, outcome: "clear" as const, createdAt: "2026-08-27T00:00:00.000Z", received: "27 Aug 2026, 08:00 SGT" },
      { status: "expired" as const, outcome: "needs_review" as const, createdAt: "2026-08-27T01:00:00.000Z", received: "27 Aug 2026, 09:00 SGT" },
      { status: "expired" as const, outcome: "incomplete" as const, createdAt: "2026-08-27T02:00:00.000Z", received: "27 Aug 2026, 10:00 SGT" },
      { status: "deleted" as const, outcome: "clear" as const, createdAt: "2026-08-27T03:00:00.000Z", received: "27 Aug 2026, 11:00 SGT" },
      { status: "deleted" as const, outcome: "needs_review" as const, createdAt: "2026-08-27T04:00:00.000Z", received: "27 Aug 2026, 12:00 SGT" },
      { status: "deleted" as const, outcome: "incomplete" as const, createdAt: "2026-08-27T05:00:00.000Z", received: "27 Aug 2026, 13:00 SGT" },
    ];
    const retainedRuns = retainedCases.map((retained, index) => {
      const serialized = { ...runs[index] };
      delete serialized.documentFamily;
      delete serialized.fixtureId;
      delete serialized.filename;
      return {
        ...serialized,
        id: `${retained.status}_${retained.outcome}`,
        status: retained.status,
        outcome: retained.outcome,
        createdAt: retained.createdAt,
        latestWorkflowEvent: {
          action: "approve_and_stage" as const,
          status: "prepared" as const,
          timestamp: "2026-08-27T00:04:00.000Z",
        },
      };
    });
    render(<RunExplorer runs={retainedRuns} onSelect={() => undefined} />);

    const queue = screen.getByRole("table", { name: "Procurement review queue" });
    for (const [index, retained] of retainedRuns.entries()) {
      const reference = retained.status === "expired" ? "Expired review record" : "Deleted review record";
      const decision = retained.status === "expired" ? "Evidence expired" : "Record deleted";
      const radio = within(queue).getByRole("radio", { name: `Select ${reference}, ${decision}, received ${retainedCases[index].received}` });
      const row = radio.closest("tr")!;
      expect(within(row).getByText(reference)).toBeVisible();
      expect(within(row).getByText(decision)).toBeVisible();
      expect(within(row).getByText("No active handoff")).toBeVisible();
      expect(row.querySelector(".status-mark--warning")).toBeInTheDocument();
      expect(within(row).queryByText("Posting handoff prepared")).not.toBeInTheDocument();
      expect(within(row).queryByText("Ready for posting review")).not.toBeInTheDocument();
      expect(within(row).queryByText("Legacy document")).not.toBeInTheDocument();
    }
  });

  it("does not display evidence or preview for an expired run", async () => {
    const user = userEvent.setup();
    render(<RunExplorer runs={runs} onSelect={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /next page/i }));
    await user.click(screen.getByRole("radio", { name: "Select Expired review record, Evidence expired, received 27 Aug 2026, 08:00 SGT" }));
    expect(screen.getByText(/retention metadata only/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /document preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /evidence snippets/i })).not.toBeInTheDocument();
  });

  it("keeps the bounded source check in selected retained records", async () => {
    const user = userEvent.setup();
    const retainedRuns = [
      {
        ...runs[0],
        id: "retained-expired",
        status: "expired" as const,
        sourceOriginStatus: "recognized_copy" as const,
      },
      {
        ...runs[1],
        id: "retained-deleted",
        status: "deleted" as const,
        sourceOriginStatus: "unverified" as const,
      },
    ];
    render(<RunExplorer runs={retainedRuns} onSelect={() => undefined} />);

    await user.click(screen.getByRole("radio", {
      name: "Select Expired review record, Evidence expired, received 27 Aug 2026, 08:00 SGT",
    }));
    const inspector = document.querySelector(".run-inspector")!;
    expect(within(inspector).getByText("Source check")).toBeVisible();
    expect(within(inspector).getByText("Exact copy of a demo document")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Document preview" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", {
      name: "Select Deleted review record, Record deleted, received 27 Aug 2026, 08:00 SGT",
    }));
    expect(within(inspector).getByText("Source check")).toBeVisible();
    expect(within(inspector).getByText("Source unverified")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Document preview" })).not.toBeInTheDocument();
  });

  it("shows an active same-origin preview and honest inspector sections", async () => {
    const user = userEvent.setup();
    const active = { ...runs[0], latencyMs: 100.276, sourceOriginStatus: "unverified" as const };
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

    await user.click(screen.getByRole("radio", { name: "Select INV-MP-4101, Ready for posting review, received 27 Aug 2026, 08:00 SGT" }));

    const runTable = screen.getByRole("table", { name: "Procurement review queue" });
    expect(within(runTable).queryByText("No AI processing")).not.toBeInTheDocument();
    expect(within(runTable).getByText("Supplier invoice")).toBeVisible();
    expect(within(runTable).getByText("INV-MP-4101")).toBeVisible();
    expect(within(runTable).getByText("Total mismatch")).toBeVisible();
    expect(within(runTable).getByText("Invoice total differs from the purchase-order reference.")).toBeVisible();
    expect(within(runTable).getByText("Email copy prepared - not sent")).toBeVisible();
    expect(within(runTable).getByText("Ready for posting review")).toBeVisible();
    for (const technicalColumn of ["Run ID", "Processing model", "Processing time", "Expiry"]) {
      expect(within(runTable).queryByRole("columnheader", { name: technicalColumn })).not.toBeInTheDocument();
    }
    expect(await screen.findByRole("img", { name: "Rendered preview of fixture-1.pdf" })).toHaveAttribute("src", "/samples/invoice-total-mismatch.png");
    expect(screen.getByRole("link", { name: "Open full document" })).toHaveAttribute("href", "/api/runs/run_1/document");
    for (const heading of ["Prepared action", "What differed", "Comments evidence", "Structured extraction", "Reference comparison", "Processing diagnostics", "Safe diagnostics", "Workflow activity", "Metadata"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }
    expect(screen.getByRole("heading", { name: "Review record and technical trace", level: 3 })).toBeVisible();
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
    expect(screen.getAllByText("100.3 ms")).toHaveLength(1);
    expect(screen.getByText("25.3 ms")).toBeVisible();
    expect(screen.getByText("Prompt version ID")).toBeVisible();
    expect(screen.getByText("Input tokens")).toBeVisible();
    expect(screen.getByText("Output tokens")).toBeVisible();
    expect(screen.getByText("Expires")).toBeVisible();
    expect(screen.queryByText(/system prompt/i)).not.toBeInTheDocument();
    const metadata = screen.getByRole("heading", { name: "Metadata" }).closest("section")!;
    expect(within(metadata).getAllByText("No AI processing")).toHaveLength(2);
    expect(within(metadata).queryByText("gpt-5-mini")).not.toBeInTheDocument();
    expect(within(metadata).getByText("Source check")).toBeVisible();
    expect(within(metadata).getByText("Source unverified")).toBeVisible();
    expect(document.querySelector(".run-inspector")).not.toHaveAttribute("aria-live");
  });

  it("keeps a custom PDF in the active iframe when its run carries a known fixture ID", async () => {
    const user = userEvent.setup();
    const custom = { ...runs[1], fixtureId: "invoice-total-mismatch", filename: "customer-upload.pdf" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ run: {
      ...custom,
      promptVersion: "document-extraction-2026-08-27.v1",
      file: { filename: custom.filename, mediaType: "application/pdf", sizeBytes: 1024, pageCount: 1 },
      requestedFields: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      stepDurations: {},
      documentUrl: "/api/runs/run_2/document",
      details: { steps: [], result: null, workflowEvents: [] },
    } }), { status: 200 })));
    render(<RunExplorer runs={[custom]} onSelect={() => undefined} />);

    await user.click(screen.getByRole("radio", { name: "Select customer-upload.pdf, Evidence-consistent, received 27 Aug 2026, 08:00 SGT" }));

    expect(await screen.findByTitle("Active document preview for customer-upload.pdf")).toHaveAttribute("src", "/api/runs/run_2/document");
    expect(screen.getByRole("link", { name: "Open full document" })).toHaveAttribute("href", "/api/runs/run_2/document");
    expect(screen.queryByRole("img", { name: "Rendered preview of customer-upload.pdf" })).not.toBeInTheDocument();
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
      origin: { serverOriginal: 2, recognizedCopy: 1, unverified: 3 },
    },
    costs: {
      estimated: true,
      currency: "USD",
      pricingAsOf: "2026-09-01",
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
    usage: { inputTokens: 300, outputTokens: 60, providerSplit: { openai: 1, anthropic: 1 }, recordedRuns: 7, liveRuns: 2, estimatedApiCostUsd: 0.2, estimatedCost: true, pricingAsOf: "2026-09-01" },
    benchmark: { source: "deterministic_synthetic_observations", observationCount: 10, exactMatchRate: 1, missingFieldRecall: 1, evaluatorAgreement: 1, falseClearCount: 0 },
    retention: { activeDocuments: 8, activePublicUploads: 2, expiryBuckets: { lessThanOneHour: 1, oneToSixHours: 3, sixToTwentyFourHours: 4 }, cleanupBacklog: 1, upcomingExpirations: 1, sampleCount: 9 },
    actions: { ready: 2, needsReview: 4, blocked: 2, stagedDryRuns: 1, population: { activeRuns: 9, actionProposals: 8, maximumRuns: 100, detailExpiryHours: 24 } },
    runExplorer: [],
    resourceScenario: { modelCostAssumption: { averageModelCostPerRunUsd: 0.1, usdToSgd: 1.35 } },
  };

  it("offers an honest Operations overview then the exact five stable tour steps", async () => {
    const user = userEvent.setup();
    let resolveMetrics: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolveMetrics = resolve;
    })));
    render(
      <AppShell>
        <OperationsDashboard />
      </AppShell>,
    );

    const header = document.querySelector<HTMLElement>(".app-header")!;
    const trigger = await within(header).findByRole("button", { name: "How it works" });
    const productName = within(header).getByRole("link", {
      name: "Document Intelligence Assurance Hub",
    });
    const navigation = within(header).getByRole("navigation", { name: "Primary navigation" });
    expect(productName.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trigger.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(trigger);
    const loadingOverview = screen.getByRole("dialog", { name: "What Operations shows" });
    expect(loadingOverview).toHaveTextContent(/procurement document exceptions/i);
    expect(loadingOverview).toHaveTextContent(/triage overview.*review queue.*workflow health/i);
    expect(loadingOverview).toHaveTextContent(/assurance safeguards.*cost governance/i);
    expect(loadingOverview).toHaveTextContent(/synthetic/i);
    expect(loadingOverview).toHaveTextContent(/no ERP, email or payment connector is called/i);
    expect(within(loadingOverview).getByRole("button", { name: "Start guided tour" })).toBeDisabled();
    expect(loadingOverview).toHaveTextContent(/metrics.*loading/i);
    await waitFor(() => expect(
      within(loadingOverview).getByRole("button", { name: "Close" }),
    ).toHaveFocus());

    resolveMetrics!(new Response(JSON.stringify(populatedMetrics), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await waitFor(() => expect(
      within(loadingOverview).getByRole("button", { name: "Start guided tour" }),
    ).toBeEnabled());
    await user.click(within(loadingOverview).getByRole("button", { name: "Start guided tour" }));

    const expectedSteps = [
      ["Triage overview", /procurement documents.*downstream handoff.*not production SLAs/i],
      ["Procurement review queue", /document reference.*review decision.*prepared next step/i],
      ["Workflow health", /human-in-the-loop queues.*simulated events/i],
      ["Assurance safeguards", /provider-neutral synthetic contract baseline.*not model accuracy/i],
      ["Cost governance", /dated cost estimates.*illustrative savings/i],
    ] as const;
    const expectedTargets = [
      "operations-tour-run-overview",
      "operations-tour-evidence-explorer",
      "operations-tour-workflow-health",
      "operations-tour-assurance-safeguards",
      "operations-tour-cost-governance",
    ] as const;
    for (let index = 0; index < expectedSteps.length; index += 1) {
      const dialog = screen.getByRole("dialog", { name: expectedSteps[index][0] });
      expect(dialog).toHaveTextContent(`Step ${index + 1} of 5`);
      expect(dialog).toHaveTextContent(expectedSteps[index][1]);
      expect(document.getElementById(expectedTargets[index])).toBeInTheDocument();
      if (index < expectedSteps.length - 1) {
        await user.click(within(dialog).getByRole("button", { name: "Next" }));
      }
    }

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps the Operations tour unavailable after a route-level metrics error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    render(
      <AppShell>
        <OperationsDashboard />
      </AppShell>,
    );

    await user.click(await screen.findByRole("button", { name: "How it works" }));
    const overview = screen.getByRole("dialog", { name: "What Operations shows" });
    expect(within(overview).getByRole("button", { name: "Start guided tour" })).toBeDisabled();
    expect(overview).toHaveTextContent(/metrics.*unavailable/i);
    expect(screen.queryByRole("dialog", { name: "Triage overview" })).not.toBeInTheDocument();
  });

  it("renders the populated Operations and Costs workspaces", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(populatedMetrics), { status: 200 })));
    render(<OperationsDashboard />);

    for (const heading of [
      "Procurement review operations",
      "Operations workspace",
      "Costs workspace",
      "Procurement review queue",
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
    expect(screen.getByRole("heading", { name: "Triage status", level: 3 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Costs workspace", level: 2 })).toBeVisible();
    for (const label of [
      "Documents triaged",
      "Review-required rate",
      "Prepared case handoffs",
      "Public demo retention",
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    for (const status of [
      "Ready for posting review",
      "Exception review required",
      "Awaiting readable evidence",
      "Processing errors",
    ]) {
      expect(screen.getByText(status)).toBeVisible();
    }
    expect(screen.getByText("Unverified uploads")).toBeVisible();
    const queueHeading = screen.getByRole("heading", { name: "Procurement review queue" });
    const processingHeading = screen.getByRole("heading", { name: "Processing performance" });
    const assuranceHeading = screen.getByRole("heading", { name: "Reference quality suite" });
    expect(queueHeading.compareDocumentPosition(processingHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(queueHeading.compareDocumentPosition(assuranceHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
      pricingAsOf: "2026-09-01",
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
