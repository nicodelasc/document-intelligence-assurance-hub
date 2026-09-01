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
  await expect(page.getByRole("img", { name: /Rendered preview of Harborline Components goods receipt/i })).toHaveAttribute(
    "src",
    "/samples/warehouse-quantity-correction.png",
  );
  await expect(
    page.getByText("Handwritten received quantity differs from the reference.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(runPosts).toHaveLength(0);

  const modelSelect = page.getByLabel("Processing model");
  await modelSelect.selectOption("claude-haiku-4-5");
  await page.getByRole("button", { name: /^(Run live document review|Assess sample without AI processing)$/ }).click();
  await expect(page.getByRole("heading", { name: "Exception review required" })).toBeVisible({
    timeout: connectedRunTimeout,
  });
  expect(runPosts).toHaveLength(1);
  const traceToggle = page.getByRole("button", { name: "View review steps" });
  await expect(traceToggle).toHaveAttribute("aria-expanded", "false");
  await traceToggle.click();
  for (const stage of [
    "Understand document",
    "Verify evidence",
    "Triage exception and prepare handoff",
  ]) {
    await expect(page.getByText(stage, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Publish telemetry", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Review goods receipt" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Assign exception review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Draft clarification request" }),
  ).toBeVisible();

  const sectionHeadings = await page
    .locator(".assurance-rail")
    .getByRole("heading", { level: 2 })
    .allTextContents();
  expect(sectionHeadings).toEqual([
    "Review progress",
    "Review result",
    "Evidence ledger",
    "Activity timeline",
  ]);
});

test("prepares a role-scoped email without sending and records the workflow activity", async ({
  page,
}) => {
  const capability = "workflow-capability-e2e";
  const event = {
    id: "workflow_event_private_identifier",
    runId: "run_workflow_e2e",
    action: "prepare_email",
    recipientRole: "Buyer",
    status: "prepared",
    createdAt: "2026-08-29T03:04:05.000Z",
  };
  let workflowRequests = 0;

  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          { id: "gpt-5.6-luna", provider: "openai", displayName: "GPT-5.6 Luna", recommended: true },
          { id: "claude-haiku-4-5", provider: "anthropic", displayName: "Claude Haiku 4.5", recommended: true },
        ],
        defaults: { openai: "gpt-5.6-luna", anthropic: "claude-haiku-4-5" },
        providerAvailability: { openai: false, anthropic: false },
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
  await page.route("**/api/runs/run_workflow_e2e", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        run: {
          id: "run_workflow_e2e",
          status: "completed",
          outcome: "needs_review",
          documentFamily: "supplier_invoice",
          providerCalled: false,
          provider: null,
          model: null,
          details: {
            steps: [],
            workflowEvents: [],
            result: {
              documentClassification: "supplier_invoice",
              fields: [{
                key: "invoice_total",
                label: "Invoice total",
                extractedValue: "S$1,250.00",
                normalizedValue: "1250.00",
                evidence: "Invoice total S$1,250.00",
                page: 1,
                evaluatorStatus: "fail",
                referenceMatch: false,
              }],
              action: {
                type: "create_ap_exception_case",
                title: "Review invoice mismatch",
                summary: "Keep the invoice in review until the discrepancy is resolved.",
                payload: [{ label: "Invoice total", value: "S$1,250.00" }],
                instructionEvidence: null,
                page: null,
                risk: "medium",
                status: "needs_review",
                reason: "The invoice total differs from the purchase order.",
                stagedAt: null,
              },
            },
          },
        },
      }),
    });
  });
  await page.route("**/api/runs/run_workflow_e2e/workflow-actions", async (route) => {
    const request = route.request();
    workflowRequests += 1;
    expect(request.headers()["x-run-capability"]).toBe(capability);
    expect(request.url()).not.toContain(capability);
    expect(request.postDataJSON()).toEqual({
      action: "prepare_email",
      recipientRole: "Buyer",
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        workflow: { status: "created", event },
        emailPreview: {
          recipientRole: "Buyer",
          subject: "Prepared only - not sent | Invoice exception",
          body: "Buyer review requested for the synthetic invoice mismatch.",
          deliveryStatus: "prepared_only_not_sent",
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
        type: "completed",
        outcome: "needs_review",
        runId: "run_workflow_e2e",
        executionMode: "recorded",
        deletionToken: capability,
        timestamp: "2026-08-29T03:04:00.000Z",
      },
    ];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
      body: `${events.map((item) => JSON.stringify(item)).join("\n")}\n`,
    });
  });

  await page.goto("/workbench");
  await page.getByRole("button", { name: /^(Run live document review|Assess sample without AI processing)$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Exception review required" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Draft clarification request" }).click();

  const dialog = page.getByRole("dialog", { name: "Draft clarification request" });
  const role = dialog.getByLabel("Recipient role");
  await expect(role).toHaveValue("");
  await expect(role.getByRole("option", { name: "Accounts Payable Analyst" })).toBeAttached();
  await expect(role.getByRole("option", { name: "Buyer" })).toBeAttached();
  await expect(role.getByRole("option", { name: "Supplier Contact" })).toBeAttached();
  await expect(dialog.getByRole("button", { name: "Prepare request" })).toBeDisabled();
  await role.selectOption("Buyer");
  await dialog.getByRole("button", { name: "Prepare request" }).click();

  const previewDialog = page.getByRole("dialog", { name: "Prepared email copy" });
  await expect(previewDialog.getByText("Prepared only - not sent", { exact: true })).toBeVisible();
  await expect(previewDialog.getByLabel("Subject")).toHaveAttribute("readonly", "");
  await expect(previewDialog.getByLabel("Prepared message")).toHaveAttribute("readonly", "");
  await expect(previewDialog.getByRole("button", { name: "Copy prepared message" })).toBeVisible();
  await expect(previewDialog.getByRole("button", { name: /send/i })).toHaveCount(0);
  await expect(previewDialog.locator('input[type="email"]')).toHaveCount(0);
  await previewDialog.getByRole("button", { name: "Close preview" }).click();

  await expect(page.getByText("Email copy prepared - not sent", { exact: true })).toBeVisible();
  await expect(page.locator("time[datetime='2026-08-29T03:04:05.000Z']")).toBeVisible();
  await expect(page.getByText(event.id, { exact: true })).toHaveCount(0);
  expect(workflowRequests).toBe(1);
});

test("retries a failed run after delayed diagnostics establish safe controls", async ({ page }) => {
  const order: string[] = [];
  let runPosts = 0;
  let detailReleased = false;
  let releaseDetail!: () => void;
  const detailGate = new Promise<void>((resolve) => {
    releaseDetail = () => {
      detailReleased = true;
      resolve();
    };
  });

  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          { id: "gpt-5.6-luna", provider: "openai", displayName: "GPT-5.6 Luna", recommended: true },
          { id: "claude-haiku-4-5", provider: "anthropic", displayName: "Claude Haiku 4.5", recommended: true },
        ],
        defaults: { openai: "gpt-5.6-luna", anthropic: "claude-haiku-4-5" },
        providerAvailability: { openai: false, anthropic: false },
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
  await page.route("**/api/runs/run_failed_delayed_e2e", async (route) => {
    await detailGate;
    try {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          run: {
            id: "run_failed_delayed_e2e",
            status: "failed",
            outcome: null,
            documentFamily: "supplier_invoice",
            providerCalled: false,
            provider: null,
            model: null,
            details: {
              steps: [],
              workflowEvents: [],
              result: { documentClassification: "supplier_invoice", fields: [] },
            },
          },
        }),
      });
    } catch {
      // The retry intentionally aborts this stale diagnostics request.
    }
  });
  await page.route("**/api/runs/run_failed_delayed_e2e/workflow-actions", async (route) => {
    order.push("workflow persisted");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        workflow: {
          status: "created",
          event: {
            id: "event_failed_retry_e2e",
            runId: "run_failed_delayed_e2e",
            action: "retry_processing",
            recipientRole: null,
            status: "simulated",
            createdAt: "2026-08-29T03:10:00.000Z",
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
    runPosts += 1;
    if (runPosts === 2) order.push("second run posted");
    const events = runPosts === 1
      ? [{
          type: "failed",
          code: "provider_unavailable",
          message: "The first run stopped safely.",
          runId: "run_failed_delayed_e2e",
          deletionToken: "failed_delayed_capability",
          timestamp: "2026-08-29T03:09:00.000Z",
        }]
      : [{
          type: "failed",
          code: "provider_unavailable",
          message: "The retry stopped safely.",
          timestamp: "2026-08-29T03:11:00.000Z",
        }];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
      body: `${events.map((item) => JSON.stringify(item)).join("\n")}\n`,
    });
  });

  await page.goto("/workbench");
  await page.getByRole("button", { name: /^(Run live document review|Assess sample without AI processing)$/ }).click();
  await expect(page.getByRole("heading", { name: "Processing failed" })).toBeVisible();
  expect(detailReleased).toBe(false);
  releaseDetail();
  await expect(page.getByRole("button", { name: "Retry processing" })).toBeVisible();
  await page.getByRole("button", { name: "Retry processing" }).click();

  await expect.poll(() => runPosts).toBe(2);
  expect(order).toEqual(["workflow persisted", "second run posted"]);
  expect(detailReleased).toBe(true);
  await expect(page.getByText("The retry stopped safely.", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("note")).toHaveText("Processing unavailable for this model");
  await expect(
    page.getByRole("button", { name: "Processing unavailable for this model" }),
  ).toBeDisabled();

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
  await page.getByRole("button", { name: /^(Run live document review|Assess sample without AI processing)$/ }).click();

  await expect(
    page.getByRole("heading", {
      name: "Incomplete evidence - one or more requested fields were not found",
    }),
  ).toBeVisible();
  await expect(page.getByText("Evidence-consistent", { exact: true })).toHaveCount(0);
});
