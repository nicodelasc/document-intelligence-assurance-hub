import { expect, test } from "@playwright/test";

const connectedRunTimeout = 15_000;

test("browses document families without processing then runs the selected fixture", async ({
  page,
}) => {
  const runPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/runs")) {
      runPosts.push(request.url());
    }
  });
  await page.goto("/workbench");

  await expect(page.getByRole("tab", { name: "Supplier invoices" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("tab", { name: "Warehouse goods receipts" }),
  ).toBeVisible();
  await expect(
    page.locator('[role="tabpanel"]:not([hidden])').getByTestId("fixture-variant"),
  ).toHaveCount(5);
  await expect(page.getByText("Sample results - no AI processing", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Processing model")).toHaveValue("gpt-5.6-luna");
  await expect(page.getByRole("option", { name: "GPT-5.6 Luna - Recommended" })).toBeAttached();
  await expect(page.getByRole("option", { name: "GPT-5.6 Terra" })).toBeAttached();
  await expect(page.getByRole("option", { name: "Claude Haiku 4.5 - Recommended" })).toBeAttached();
  await expect(page.getByRole("option", { name: "Claude Sonnet 5" })).toBeAttached();
  await expect(page.getByText(/live custom|live provider|live-call/i)).toHaveCount(0);

  const invoiceTab = page.getByRole("tab", { name: "Supplier invoices" });
  await invoiceTab.focus();
  await page.keyboard.press("ArrowRight");
  const receiptTab = page.getByRole("tab", { name: "Warehouse goods receipts" });
  await expect(receiptTab).toBeFocused();
  await expect(receiptTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator('[role="tabpanel"]:not([hidden])').getByTestId("fixture-variant"),
  ).toHaveCount(5);

  await page.getByRole("button", { name: /Quantity correction/i }).click();
  await expect(page.getByTitle(/Document preview for Harborline Components goods receipt/i)).toHaveAttribute(
    "src",
    "/samples/warehouse-quantity-correction.pdf",
  );
  await expect(
    page.getByText("Handwritten received quantity differs from the reference.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(runPosts).toHaveLength(0);

  const modelSelect = page.getByLabel("Processing model");
  await modelSelect.selectOption("claude-haiku-4-5");
  await page.getByRole("button", { name: "Process document" }).click();
  await expect(page.getByRole("heading", { name: "Needs review" })).toBeVisible({
    timeout: connectedRunTimeout,
  });
  expect(runPosts).toHaveLength(1);
  for (const stage of [
    "Understand document",
    "Verify evidence",
    "Resolve and prepare action",
  ]) {
    await expect(page.getByText(stage, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Publish telemetry", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Review goods receipt" })).toBeVisible();
});

test("the upload tile directly opens the picker and explains unavailable custom processing", async ({
  page,
}) => {
  await page.goto("/workbench");
  const upload = page.getByRole("button", { name: "+ Add your document" });
  await upload.focus();
  const chooserPromise = page.waitForEvent("filechooser");
  await upload.press("Space");
  const chooser = await chooserPromise;
  await chooser.setFiles([]);

  await expect(page.getByLabel("Document file")).toHaveAttribute(
    "accept",
    "application/pdf,image/png,image/jpeg",
  );
  await expect(
    page.getByText("Processing unavailable for this model", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Process document" })).toBeDisabled();

  await page.getByRole("button", { name: /Clean match/i }).click();
  await expect(page.getByRole("button", { name: /Clean match/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a custom partial result uses incomplete evidence wording", async ({ page }) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          { id: "gpt-5.6-luna", provider: "openai", displayName: "GPT-5.6 Luna", recommended: true },
          { id: "gpt-5.6-terra", provider: "openai", displayName: "GPT-5.6 Terra", recommended: false },
          { id: "claude-haiku-4-5", provider: "anthropic", displayName: "Claude Haiku 4.5", recommended: true },
          { id: "claude-sonnet-5", provider: "anthropic", displayName: "Claude Sonnet 5", recommended: false },
        ],
        defaults: { openai: "gpt-5.6-luna", anthropic: "claude-haiku-4-5" },
        providerAvailability: { openai: true, anthropic: false },
      }),
    });
  });
  await page.route("**/api/runs?limit=12", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runs: [],
        pagination: { limit: 12, offset: 0, returned: 0 },
      }),
    });
  });
  await page.route("**/api/runs/run_custom_partial", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        run: {
          id: "run_custom_partial",
          providerCalled: true,
          provider: "openai",
          model: "gpt-5.6-luna",
          details: {
            result: {
              action: {
                type: "create_document_review_task",
                title: "Review incomplete document",
                summary: "Keep the document in review until evidence is complete.",
                payload: [{ label: "Document", value: "partial.png" }],
                instructionEvidence: null,
                page: null,
                risk: "medium",
                status: "needs_review",
                reason: "A requested field was not found.",
                stagedAt: null,
              },
            },
          },
        },
      }),
    });
  });
  await page.route("**/api/runs", async (route, request) => {
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    const events = [
      {
        type: "field",
        field: {
          key: "vendor",
          label: "Vendor",
          extractedValue: "Northstar",
          normalizedValue: "Northstar",
          evidence: "Vendor: Northstar",
          page: 1,
          evaluatorStatus: "pass",
          referenceMatch: null,
        },
        timestamp: "2026-08-29T00:00:00.000Z",
      },
      {
        type: "field",
        field: {
          key: "total",
          label: "Total",
          extractedValue: null,
          normalizedValue: null,
          evidence: null,
          page: null,
          evaluatorStatus: "not_found",
          referenceMatch: null,
        },
        timestamp: "2026-08-29T00:00:00.100Z",
      },
      {
        type: "completed",
        outcome: "not_found",
        runId: "run_custom_partial",
        executionMode: "live",
        deletionToken: "partial-delete-token",
        timestamp: "2026-08-29T00:00:00.200Z",
      },
    ];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
      body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    });
  });

  await page.goto("/workbench");
  await page.getByRole("button", { name: "+ Add your document" }).click();
  await page.getByLabel("Document file").setInputFiles({
    name: "partial.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  await page.getByLabel("Review field 1").fill("Vendor");
  await page.getByLabel("Review field 2").fill("Total");
  await page.getByRole("checkbox", { name: /publicly visible/i }).check();
  await expect(page.getByText("Sample results - no AI processing")).toHaveCount(0);
  await page.getByRole("button", { name: "Process document" }).click();

  await expect(
    page.getByRole("heading", {
      name: "Incomplete evidence - one or more requested fields were not found",
    }),
  ).toBeVisible();
  await expect(page.getByText("Evidence-consistent", { exact: true })).toHaveCount(0);
});
