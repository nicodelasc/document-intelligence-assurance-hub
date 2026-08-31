import { expect, test, type Page } from "@playwright/test";

function operationsMetrics() {
  const performance = {
    sampleCount: 1,
    p50LatencyMs: 100,
    p95LatencyMs: 100,
    retryCount: 0,
    averageStepDurationsMs: { validating: 20 },
  };
  const lifecycle = {
    activeDocuments: 1,
    activePublicUploads: 0,
    expiryBuckets: { lessThanOneHour: 0, oneToSixHours: 0, sixToTwentyFourHours: 1 },
    cleanupBacklog: 0,
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
  return {
    generatedAt: "2026-08-30T00:00:00.000Z",
    operations: {
      workflowStatus: { ready: 0, needsAttention: 1, incomplete: 0, processingErrors: 0 },
      workflowActivity: { prepared: 1, staged: 0, simulated: 0 },
      performance,
      lifecycle,
    },
    costs: {
      estimated: true,
      currency: "USD",
      pricingAsOf: "2026-08-28",
      settledSpend: { todayUsd: 0, monthToDateUsd: 0, mayIncludeConservativeSettlements: true },
      completedRunEstimates: {
        todayUsd: 0,
        monthToDateUsd: 0,
        completedModelRuns: 0,
        totalUsd: 0,
        averageUsd: 0,
      },
      byModel: [],
      byFamily: [],
      dailyBudget: {
        limitUsd: 5,
        settledUsd: 0,
        reservedUsd: 0,
        remainingUsd: 5,
        pendingReservations: 0,
      },
    },
    referenceQuality,
    summary: { totalRuns: 1, completionRate: 1, reviewRate: 1, failureRate: 0 },
    performance,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      providerSplit: { openai: 0, anthropic: 0 },
      recordedRuns: 1,
      liveRuns: 0,
      estimatedApiCostUsd: 0,
      estimatedCost: true,
      pricingAsOf: "2026-08-28",
    },
    benchmark: referenceQuality,
    retention: { ...lifecycle, upcomingExpirations: 1, sampleCount: 1 },
    actions: {
      ready: 0,
      needsReview: 1,
      blocked: 0,
      stagedDryRuns: 0,
      population: { activeRuns: 1, actionProposals: 1, maximumRuns: 100, detailExpiryHours: 24 },
    },
    runExplorer: [],
    resourceScenario: {
      modelCostAssumption: {
        averageModelCostPerRunUsd: 0,
        usdToSgd: 1.35,
        assumptionDate: "2026-08-28",
        illustrative: true,
      },
    },
  };
}

async function interceptOperationsMetrics(page: Page) {
  await page.route("**/api/metrics", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(operationsMetrics()),
  }));
}

const operationsTourSteps = [
  ["Triage overview", "operations-tour-run-overview"],
  ["Procurement review queue", "operations-tour-evidence-explorer"],
  ["Workflow health", "operations-tour-workflow-health"],
  ["Assurance safeguards", "operations-tour-assurance-safeguards"],
  ["Cost governance", "operations-tour-cost-governance"],
] as const;

async function expectAlignedNonOverlappingGeometry(
  page: Page,
  title: string,
  targetId: string,
  viewport: { width: number; height: number },
) {
  await expect.poll(async () => {
    const [callout, spotlight, target] = await Promise.all([
      page.getByRole("dialog", { name: title }).boundingBox(),
      page.locator(".guided-tour__spotlight").boundingBox(),
      page.locator(`#${targetId}`).boundingBox(),
    ]);
    if (!callout || !spotlight || !target) return { aligned: false, overlaps: true };
    const expectedLeft = Math.max(16, target.x - 6);
    const expectedTop = Math.max(16, target.y - 6);
    const expectedRight = Math.min(viewport.width - 16, target.x + target.width + 6);
    const expectedBottom = Math.min(viewport.height - 16, target.y + target.height + 6);
    const aligned = Math.abs(spotlight.x - expectedLeft) <= 2
      && Math.abs(spotlight.y - expectedTop) <= 2
      && Math.abs(spotlight.x + spotlight.width - expectedRight) <= 2
      && Math.abs(spotlight.y + spotlight.height - expectedBottom) <= 2;
    const overlaps = callout.x < spotlight.x + spotlight.width
      && callout.x + callout.width > spotlight.x
      && callout.y < spotlight.y + spotlight.height
      && callout.y + callout.height > spotlight.y;
    return { aligned, overlaps };
  }).toEqual({ aligned: true, overlaps: false });
}

async function openOperationsTour(page: Page) {
  await page.goto("/operations");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "How it works" }).click();
  await page.getByRole("button", { name: "Start guided tour" }).click();
}

test("places route guidance before navigation and walks the Operations tour", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await interceptOperationsMetrics(page);
  await page.goto("/operations");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");

  const headerChildren = await page.locator(".app-header").evaluate((header) =>
    Array.from(header.children).map((child) => child.textContent?.trim()),
  );
  expect(headerChildren).toEqual([
    "Document Intelligence Assurance Hub",
    "How it works",
    "WorkbenchOperations",
  ]);

  const trigger = page.getByRole("button", { name: "How it works" });
  await trigger.click();
  const overview = page.getByRole("dialog", { name: "What Operations shows" });
  await expect(overview).toContainText("procurement document exceptions");
  await expect(overview).toContainText("Built-in benchmark documents and reference records are synthetic");
  await expect(overview).toContainText("no ERP, email or payment connector is called");
  await overview.getByRole("button", { name: "Start guided tour" }).click();

  for (let index = 0; index < operationsTourSteps.length; index += 1) {
    const dialog = page.getByRole("dialog", { name: operationsTourSteps[index][0] });
    await expect(dialog).toContainText(`Step ${index + 1} of 5`);
    await expect(page.locator(`#${operationsTourSteps[index][1]}`)).toBeVisible();
    await expectAlignedNonOverlappingGeometry(
      page,
      operationsTourSteps[index][0],
      operationsTourSteps[index][1],
      { width: 1440, height: 1000 },
    );
    if (index < operationsTourSteps.length - 1) {
      await dialog.getByRole("button", { name: "Next" }).click();
    }
  }

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await trigger.click();
  await page.getByRole("button", { name: "Start guided tour" }).click();
  const mobileCallout = page.getByRole("dialog", { name: "Triage overview" });
  await expect(mobileCallout).toHaveClass(/guided-tour__callout--mobile/);
  const mobileBox = await mobileCallout.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.x).toBeGreaterThanOrEqual(16);
  expect(mobileBox!.x + mobileBox!.width).toBeLessThanOrEqual(374);
});

for (const viewport of [
  { width: 721, height: 480 },
  { width: 720, height: 480 },
] as const) {
  test(`keeps every Operations spotlight aligned and separate at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await interceptOperationsMetrics(page);
    await openOperationsTour(page);

    for (let index = 0; index < operationsTourSteps.length; index += 1) {
      const [title, targetId] = operationsTourSteps[index];
      await expectAlignedNonOverlappingGeometry(page, title, targetId, viewport);
      if (index < operationsTourSteps.length - 1) {
        await page.getByRole("dialog", { name: title }).getByRole("button", { name: "Next" }).click();
      }
    }
  });
}

test("does not fetch Workbench tour code on cold Operations", async ({ page }) => {
  await interceptOperationsMetrics(page);
  const operationsScripts: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    operationsScripts.push(await response.text().catch(() => ""));
  });
  await page.goto("/operations");
  await expect(page.getByRole("button", { name: "How it works" })).toBeVisible();
  await page.waitForTimeout(250);
  expect(operationsScripts.join("\n")).not.toContain("What this workbench does");
});

test("does not fetch Operations tour code on cold Workbench", async ({ page }) => {
  const workbenchScripts: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    workbenchScripts.push(await response.text().catch(() => ""));
  });
  await page.goto("/workbench");
  await expect(page.getByRole("button", { name: "How it works" })).toBeVisible();
  await page.waitForTimeout(250);
  expect(workbenchScripts.join("\n")).not.toContain("What Operations shows");
});
