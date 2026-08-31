import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/models", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      models: [
        { id: "gpt-5.6-luna", provider: "openai", displayName: "GPT-5.6 Luna", recommended: true },
        { id: "claude-haiku-4-5", provider: "anthropic", displayName: "Claude Haiku 4.5", recommended: true },
      ],
      defaults: { openai: "gpt-5.6-luna", anthropic: "claude-haiku-4-5" },
      providerAvailability: { openai: true, anthropic: true },
    }),
  }));
});

test("quota failure offers a demo fallback", async ({ page }) => {
  await page.route("**/api/runs", async (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "recorded_run_limit", message: "The demo run limit is active.", requestId: "safe" } }) }));
  await page.goto("/workbench");
  await page.getByRole("button", { name: "Assess for exceptions" }).click();
  await expect(page.getByText("The demo run limit is active.", { exact: true })).toBeVisible();
});

test("mocked custom completion keeps raw token in uploader context and deletes pessimistically", async ({ page }) => {
  const token = "raw_delete_token_once";
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() === "POST") {
      const body = [
        JSON.stringify({ type: "stage", stage: "validating", timestamp: "2026-08-27T00:00:00.000Z" }),
        JSON.stringify({ type: "completed", outcome: "not_found", runId: "run_mock_delete", executionMode: "live", deletionToken: token, timestamp: "2026-08-27T00:00:01.000Z" }),
      ].join("\n") + "\n";
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
    }
    return route.continue();
  });
  await page.route("**/api/runs/run_mock_delete", async (route) => {
    if (route.request().method() === "DELETE") {
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ deletion: { status: "accepted", runId: "run_mock_delete" } }) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ run: {
        id: "run_mock_delete",
        status: "completed",
        outcome: "not_found",
        documentFamily: "supplier_invoice",
        providerCalled: false,
        provider: null,
        model: null,
        details: {
          result: {
            documentClassification: "supplier_invoice",
            action: {
              type: "stage_inventory_receipt",
              title: "Stage inventory receipt",
              summary: "Stage the verified receipt for internal inventory posting.",
              payload: [
                { label: "Shipment ID", value: "SHIP-4018" },
                { label: "Received quantity", value: "48" },
              ],
              instructionEvidence: "Corrected received quantity: 48.",
              page: 1,
              risk: "low",
              status: "ready",
              reason: "The corrected quantity matches the expected delivery.",
              stagedAt: null,
            },
            fields: [],
          },
          workflowEvents: [],
        },
      } }),
    });
  });
  await page.goto("/workbench");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "+ Add your document" }).click();
  await (await chooserPromise).setFiles({ name: "safe.png", mimeType: "image/png", buffer: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]) });
  await page.getByLabel("Review field 1").fill("Vendor");
  await page.getByLabel("Review field 2").fill("Total");
  await page.getByRole("checkbox", { name: /publicly visible/i }).check();
  await page.getByRole("button", { name: "Validate custom upload" }).click();
  await page.getByRole("button", { name: "Assess for exceptions" }).click();
  await expect(page.getByText(token)).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Incomplete evidence - one or more requested fields were not found",
  })).toBeFocused();
  await expect(page.getByRole("button", { name: "Request clearer evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign manual review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace document" })).toBeVisible();
  await page.getByRole("button", { name: "Delete run run_mock_delete" }).click();
  await expect(page.getByRole("alertdialog")).not.toContainText(token);
  await expect(page.getByRole("alertdialog")).not.toContainText("hash");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete now" }).click();
  await expect(page.getByText(token)).not.toBeVisible();
});

test("operations supports filter state and drill-down", async ({ page }) => {
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await page.getByLabel("Processing model filter").selectOption("openai");
  await expect(page).toHaveURL(/provider=openai/);
  await expect(page.getByText(/Illustrative scenario — not measured savings/)).toBeVisible();
});
