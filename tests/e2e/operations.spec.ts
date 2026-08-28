import { expect, test } from "@playwright/test";

test("monitors persisted action readiness and opens dry-run action details", async ({ page }) => {
  const run = {
    id: "run_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    providerCalled: false,
    provider: null,
    model: null,
    configuredProvider: "openai",
    configuredModel: "gpt-5.6-luna",
    executionMode: "recorded",
    sourceType: "synthetic",
    status: "completed",
    outcome: "clear",
    createdAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2099-08-28T00:00:00.000Z",
    deletedAt: null,
    retryCount: 0,
    latencyMs: 100,
    estimatedCostUsd: 0,
    filename: "warehouse-receiving-sheet.pdf",
  };
  const metrics = {
    generatedAt: "2026-08-27T00:00:00.000Z",
    summary: { totalRuns: 1, completionRate: 1, reviewRate: 0, failureRate: 0 },
    performance: { sampleCount: 1, p50LatencyMs: 100, p95LatencyMs: 100, retryCount: 0, averageStepDurationsMs: { validating: 20 } },
    usage: { inputTokens: 0, outputTokens: 0, providerSplit: { openai: 0, anthropic: 0 }, recordedRuns: 1, liveRuns: 0, estimatedApiCostUsd: 0, pricingAsOf: "2026-08-28" },
    benchmark: { source: "deterministic_synthetic_observations", observationCount: 3, exactMatchRate: 1, missingFieldRecall: 1, evaluatorAgreement: 1, falseClearCount: 0 },
    retention: { activePublicUploads: 0, upcomingExpirations: 0, cleanupBacklog: 0, sampleCount: 1 },
    actions: { ready: 1, needsReview: 0, blocked: 0, stagedDryRuns: 1, population: { activeRuns: 1, actionProposals: 1, maximumRuns: 100, detailExpiryHours: 24 } },
    runExplorer: [run],
    resourceScenario: { modelCostAssumption: { averageModelCostPerRunUsd: 0, usdToSgd: 1.35 } },
  };
  const action = {
    type: "stage_inventory_receipt",
    title: "Stage inventory receipt",
    summary: "Prepare an internal receipt posting dry run.",
    payload: [{ label: "Shipment ID", value: "SHIP-2048" }],
    instructionEvidence: "Post corrected received quantity: 48",
    page: 1,
    risk: "low",
    status: "ready",
    reason: "Verified receipt evidence supports internal staging.",
    stagedAt: "2026-08-27T00:03:00.000Z",
  };

  await page.route("**/api/metrics", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(metrics),
  }));
  await page.route("**/api/runs/run_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ run: {
      ...run,
      promptVersion: "document-extraction-2026-08-28.v2",
      file: { filename: run.filename, mediaType: "application/pdf", sizeBytes: 1024, pageCount: 1 },
      requestedFields: [{ key: "shipment_id", label: "Shipment ID" }],
      usage: { inputTokens: 0, outputTokens: 0 },
      stepDurations: { validating: 20 },
      documentUrl: "/api/runs/run_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/document",
      details: {
        steps: [{ kind: "stage", stage: "validating", timestamp: "2026-08-27T00:00:00.000Z", durationMs: 20 }],
        result: {
          fields: [{ key: "shipment_id", label: "Shipment ID", extractedValue: "SHIP-2048", normalizedValue: "ship-2048", evidence: "Shipment SHIP-2048", page: 1, evaluatorStatus: "pass", referenceMatch: true }],
          outcome: "clear",
          documentInstruction: action.instructionEvidence,
          action,
          usage: { inputTokens: 0, outputTokens: 0 },
          estimatedCostUsd: 0,
          retryCount: 0,
          latencyMs: 100,
          stepDurations: { validating: 20 },
          completedAt: "2026-08-27T00:00:01.000Z",
        },
      },
    } }),
  }));

  await page.goto("/operations");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  const readiness = page.getByRole("heading", { name: "Action readiness" }).locator("..").locator("..");
  await expect(readiness).toContainText("Ready1");
  await expect(readiness).toContainText("Staged dry runs1");
  await expect(readiness).toContainText("1 action proposal across 1 active run.");
  await expect(readiness).toContainText("Latest 100 runs inspected. Details expire within 24 hours.");
  await expect(page.getByRole("heading", { name: "Latency and step duration" })).toHaveCount(0);
  await expect(page.getByText(/Public prototype|replay/i)).toHaveCount(0);

  await page.getByRole("radio", { name: "Select run_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }).check();
  const prepared = page.getByRole("heading", { name: "Prepared action" }).locator("..");
  await expect(prepared).toContainText("Stage inventory receipt");
  await expect(prepared).toContainText("stage inventory receipt");
  await expect(prepared).toContainText("Staged 27 Aug 2026, 08:03 SGT");
  await expect(prepared).toContainText("No external connector was called.");
  await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
  const metadata = page.getByRole("heading", { name: "Metadata" }).locator("..");
  await expect(metadata.getByText("Not called (demo)")).toHaveCount(2);
  await expect(metadata).not.toContainText("gpt-5.6-luna");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
