import { expect, test } from "@playwright/test";

test("quota failure offers recorded fallback", async ({ page }) => {
  await page.route("**/api/runs", async (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "recorded_run_limit", message: "The recorded replay limit is active.", requestId: "safe" } }) }));
  await page.goto("/workbench");
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByText("The recorded replay limit is active.", { exact: true })).toBeVisible();
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
  await page.route("**/api/runs/run_mock_delete", async (route) => route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ deletion: { status: "accepted", runId: "run_mock_delete" } }) }));
  await page.goto("/workbench");
  await page.getByText("Custom upload", { exact: true }).click();
  await page.getByLabel("Document file").setInputFiles({ name: "safe.png", mimeType: "image/png", buffer: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]) });
  await page.getByLabel("Review field 1").fill("Vendor");
  await page.getByLabel("Review field 2").fill("Total");
  await page.getByRole("checkbox", { name: /publicly visible/i }).check();
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByText(token)).toBeVisible();
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
  await page.getByLabel("Provider filter").selectOption("openai");
  await expect(page).toHaveURL(/provider=openai/);
  await expect(page.getByText(/Illustrative scenario — not measured savings/)).toBeVisible();
});
