import { expect, test } from "@playwright/test";

const responsiveWidths = [1536, 1700, 1720, 1760, 1800, 1920] as const;
const sideBySideMinimumOperationsWidth = 74 * 16;

test("splits Operations and Costs then opens a complete workflow detail", async ({ page }) => {
  const run = {
    id: "run_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    providerCalled: false,
    provider: null,
    model: null,
    configuredProvider: "openai",
    configuredModel: "gpt-5.6-luna",
    executionMode: "recorded",
    sourceType: "synthetic",
    sourceOriginStatus: "unverified",
    documentFamily: "supplier_invoice",
    fixtureId: "invoice-total-mismatch",
    status: "completed",
    outcome: "needs_review",
    createdAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2099-08-28T00:00:00.000Z",
    deletedAt: null,
    retryCount: 0,
    latencyMs: 100,
    estimatedCostUsd: 0,
    filename: "invoice-total-mismatch.pdf",
    latestWorkflowEvent: { action: "prepare_email", status: "prepared", timestamp: "2026-08-27T00:04:00.000Z" },
  };
  const referenceQuality = {
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
  };
  const performance = { sampleCount: 1, p50LatencyMs: 100, p95LatencyMs: 100, retryCount: 0, averageStepDurationsMs: { validating: 20 } };
  const lifecycle = {
    activeDocuments: 1,
    activePublicUploads: 0,
    expiryBuckets: { lessThanOneHour: 0, oneToSixHours: 0, sixToTwentyFourHours: 1 },
    cleanupBacklog: 0,
  };
  const metrics = {
    generatedAt: "2026-08-27T00:00:00.000Z",
    operations: {
      workflowStatus: { ready: 0, needsAttention: 1, incomplete: 0, processingErrors: 0 },
      workflowActivity: { prepared: 1, staged: 0, simulated: 0 },
      performance,
      lifecycle,
      origin: { serverOriginal: 2, recognizedCopy: 1, unverified: 3 },
    },
    costs: {
      estimated: true,
      currency: "USD",
      pricingAsOf: "2026-09-01",
      settledSpend: { todayUsd: 0, monthToDateUsd: 0, mayIncludeConservativeSettlements: true },
      completedRunEstimates: { todayUsd: 0, monthToDateUsd: 0, completedModelRuns: 0, totalUsd: 0, averageUsd: 0 },
      byModel: [],
      byFamily: [],
      dailyBudget: { limitUsd: 5, settledUsd: 0, reservedUsd: 0, remainingUsd: 5, pendingReservations: 0 },
    },
    referenceQuality,
    summary: { totalRuns: 1, completionRate: 1, reviewRate: 1, failureRate: 0 },
    performance,
    usage: { inputTokens: 0, outputTokens: 0, providerSplit: { openai: 0, anthropic: 0 }, recordedRuns: 1, liveRuns: 0, estimatedApiCostUsd: 0, estimatedCost: true, pricingAsOf: "2026-09-01" },
    benchmark: referenceQuality,
    retention: { ...lifecycle, upcomingExpirations: 1, sampleCount: 1 },
    actions: { ready: 0, needsReview: 1, blocked: 0, stagedDryRuns: 0, population: { activeRuns: 1, actionProposals: 1, maximumRuns: 100, detailExpiryHours: 24 } },
    runExplorer: [run],
    resourceScenario: { modelCostAssumption: { averageModelCostPerRunUsd: 0, usdToSgd: 1.35 } },
  };
  const action = {
    type: "create_ap_exception_case",
    title: "Review supplier invoice",
    summary: "Prepare an internal accounts-payable exception review.",
    payload: [{ label: "Invoice number", value: "INV-MP-4101" }],
    instructionEvidence: "Verify total against PO before release.",
    page: 1,
    risk: "medium",
    status: "needs_review",
    reason: "The invoice total conflicts with the purchase-order reference.",
    stagedAt: "2026-08-27T00:03:00.000Z",
  };

  await page.route("**/api/metrics", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(metrics) }));
  await page.route(`**/api/runs/${run.id}`, async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ run: {
      ...run,
      promptVersion: "document-extraction-2026-08-28.v2",
      file: { filename: run.filename, mediaType: "application/pdf", sizeBytes: 1024, pageCount: 1 },
      requestedFields: [{ key: "invoice_total", label: "Invoice total" }, { key: "reviewer_comments", label: "Reviewer comments" }],
      usage: { inputTokens: 0, outputTokens: 0 },
      stepDurations: { validating: 20 },
      documentUrl: `/api/runs/${run.id}/document`,
      details: {
        steps: [
          { kind: "stage", stage: "validating", timestamp: "2026-08-27T00:00:00.000Z", durationMs: 20 },
          { kind: "error", stage: "verifying", timestamp: "2026-08-27T00:00:00.500Z", durationMs: null, safeCode: "reference_conflict" },
        ],
        workflowEvents: [{ id: "event_public_1", action: "prepare_email", status: "prepared", createdAt: "2026-08-27T00:04:00.000Z", recipientRole: "AP reviewer" }],
        result: {
          fields: [
            { key: "invoice_total", label: "Invoice total", extractedValue: "1890.00 SGD", normalizedValue: "1890.00 sgd", evidence: "Total SGD 1890.00", page: 1, evaluatorStatus: "conflict", referenceMatch: false },
            { key: "reviewer_comments", label: "Reviewer comments", extractedValue: "Verify total against PO before release.", normalizedValue: "verify total against po before release", evidence: "Handwritten: Verify total against PO before release.", page: 1, evaluatorStatus: "pass", referenceMatch: true },
          ],
          outcome: "needs_review",
          documentInstruction: action.instructionEvidence,
          action,
          estimatedCostUsd: 0,
          retryCount: 0,
          latencyMs: 100,
        },
      },
    } }),
  }));
  await page.route(`**/api/runs/${run.id}/document`, async (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" }));

  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/operations");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("heading", { name: "Procurement review operations", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations workspace", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Costs workspace", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reference quality suite", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Settled API spend estimate", level: 3 })).toBeVisible();
  await expect(page.getByText("No confirmed model runs").first()).toBeVisible();
  await expect(page.getByText("Email copy prepared - not sent")).toBeVisible();
  await expect(page.getByText("Supplier invoice", { exact: true })).toBeVisible();
  await expect(page.getByText("Total mismatch")).toBeVisible();
  await expect(page.getByText("INV-MP-4101")).toBeVisible();
  await expect(page.getByText("Invoice total differs from the purchase-order reference.")).toBeVisible();
  await expect(page.getByRole("table", { name: "Procurement review queue" }).getByText("Exception review required")).toBeVisible();
  await expect(page.getByRole("table", { name: "Procurement review queue" }).getByText("Unverified uploads")).toBeVisible();
  await expect(page.getByText(/live-call|live provider|public prototype|recorded replay/i)).toHaveCount(0);
  const operationsHeadings = await page.locator(".operations-column h3").allTextContents();
  expect(operationsHeadings.indexOf("Procurement review queue")).toBeLessThan(
    operationsHeadings.indexOf("Processing performance"),
  );
  expect(operationsHeadings.indexOf("Procurement review queue")).toBeLessThan(
    operationsHeadings.indexOf("Reference quality suite"),
  );
  const widths = await page.locator(".operations-costs-layout").evaluate((layout) => {
    const [operations, costs] = Array.from(layout.children).map((child) => child.getBoundingClientRect().width);
    return { operations, costs };
  });
  expect(widths.operations / widths.costs).toBeGreaterThan(1.8);
  expect(widths.operations / widths.costs).toBeLessThan(2.2);

  await page.getByRole("radio", { name: "Select INV-MP-4101, Exception review required, received 27 Aug 2026, 08:00 SGT" }).check();
  await expect(page.getByRole("heading", { name: "Review record and technical trace", level: 3 })).toBeVisible();
  for (const width of responsiveWidths) {
    await test.step(`keeps the queue and inspector separate at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1024 });
      const containerGeometry = await page.locator(".explorer-layout").evaluate((layout) => {
        const operations = layout.closest(".operations-column")!;
        const explorer = layout.querySelector(".run-explorer")!;
        const inspector = layout.querySelector(".run-inspector")!;
        const toolbarItems = Array.from(layout.querySelectorAll(".explorer-toolbar label, .explorer-toolbar input, .explorer-toolbar select"));
        const inspectorItems = Array.from(layout.querySelectorAll(".run-inspector .inspector-title, .run-inspector .inspector-sections"));
        const overlaps = toolbarItems.flatMap((toolbarItem) => {
          const toolbarBox = toolbarItem.getBoundingClientRect();
          return inspectorItems.flatMap((inspectorItem) => {
            const inspectorBox = inspectorItem.getBoundingClientRect();
            const intersects = toolbarBox.left < inspectorBox.right
              && toolbarBox.right > inspectorBox.left
              && toolbarBox.top < inspectorBox.bottom
              && toolbarBox.bottom > inspectorBox.top;
            return intersects ? [{
              toolbar: `${toolbarItem.tagName.toLowerCase()}:${toolbarItem.textContent?.trim() ?? ""}`,
              inspector: `${inspectorItem.tagName.toLowerCase()}:${inspectorItem.textContent?.trim().slice(0, 80) ?? ""}`,
            }] : [];
          });
        });
        return {
          operationsWidth: operations.getBoundingClientRect().width,
          inspectorStartsAfterQueue: inspector.getBoundingClientRect().top >= explorer.getBoundingClientRect().bottom,
          overlaps,
        };
      });
      const shouldStack = containerGeometry.operationsWidth <= sideBySideMinimumOperationsWidth;
      expect(containerGeometry.inspectorStartsAfterQueue).toBe(shouldStack);
      expect(containerGeometry.overlaps).toEqual([]);
    });
  }
  const renderedPreview = page.getByRole("img", { name: `Rendered preview of ${run.filename}` });
  await expect(renderedPreview).toHaveAttribute("src", "/samples/invoice-total-mismatch.png");
  await expect.poll(() => renderedPreview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "Open full document" })).toHaveAttribute("href", `/api/runs/${run.id}/document`);
  await expect(page.getByRole("heading", { name: "What differed", level: 4 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comments evidence", level: 4 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workflow activity", level: 4 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Safe diagnostics", level: 4 })).toBeVisible();
  const comments = page.getByRole("heading", { name: "Comments evidence" }).locator("..");
  await expect(comments.getByText("Handwritten: Verify total against PO before release.", { exact: true })).toBeVisible();
  await expect(page.getByText("reference_conflict")).toBeVisible();
  const metadata = page.getByRole("heading", { name: "Metadata" }).locator("..");
  await expect(metadata.getByText("No AI processing")).toHaveCount(2);
  await expect(metadata).not.toContainText("gpt-5.6-luna");
  await expect(metadata.getByText("Source check")).toBeVisible();
  await expect(metadata.getByText("Source unverified")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const order = await page.locator(".operations-costs-layout").evaluate((layout) => {
    const [operations, costs] = Array.from(layout.children).map((child) => child.getBoundingClientRect().top);
    return { operations, costs };
  });
  expect(order.operations).toBeLessThan(order.costs);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
