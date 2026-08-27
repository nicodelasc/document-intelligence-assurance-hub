import { expect, test } from "@playwright/test";

test("runs clean, mismatch, other-provider comparison and missing-field replays", async ({ page }) => {
  await page.goto("/workbench");
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByRole("heading", { name: "Clear" })).toBeVisible();

  await page.getByText("Invoice-total mismatch", { exact: true }).click();
  await page.getByRole("radio", { name: /Anthropic Claude Haiku 4.5/ }).check();
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByRole("heading", { name: "Needs review" })).toBeVisible();

  await page.getByLabel("Run A").selectOption({ index: 1 });
  await page.getByLabel("Run B").selectOption({ index: 2 });
  await expect(page.getByRole("table", { name: /comparison of two assurance runs/i })).toBeVisible();

  await page.getByText("Missing purchase-order number", { exact: true }).click();
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByRole("heading", { name: "Incomplete" })).toBeVisible();
});

test("custom upload validation recovers through recorded replay", async ({ page }) => {
  await page.goto("/workbench");
  await page.getByText("Custom upload", { exact: true }).click();
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByText(/Complete the document, field labels and consent/i)).toBeVisible();
  await expect(page.getByLabel("Document file")).toBeFocused();
  await page.getByRole("button", { name: /Use a synthetic recorded replay/i }).click();
  await expect(page.getByText("Clean invoice", { exact: true })).toBeVisible();
});
