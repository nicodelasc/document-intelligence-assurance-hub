import { expect, test } from "@playwright/test";

const connectedRunTimeout = 15_000;

test("runs operational fixtures with a grouped model select and action-first results", async ({
  page,
}) => {
  await page.goto("/workbench");

  await expect(page.locator('optgroup[label="OpenAI"]')).toHaveCount(1);
  await expect(page.locator('optgroup[label="Anthropic"]')).toHaveCount(1);
  await expect(page.getByText("Demo data — no provider call", { exact: true })).toHaveCount(1);
  for (const stage of [
    "Understand document",
    "Verify evidence",
    "Resolve and prepare action",
  ]) {
    await expect(page.getByText(stage, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Publish telemetry", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Warehouse receiving sheet/i }).click();
  const modelSelect = page.getByLabel("Live custom-run model");
  await modelSelect.focus();
  await page.keyboard.press("ArrowDown");
  await expect(modelSelect).toHaveValue("gpt-5.6-terra");
  await modelSelect.selectOption("claude-haiku-4-5");
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByRole("heading", { name: "Clear" })).toBeVisible({
    timeout: connectedRunTimeout,
  });
  await expect(page.getByRole("heading", { name: "Stage inventory receipt" })).toBeVisible();
  await expect(page.locator(".assurance-rail")).not.toContainText("Claude Haiku 4.5");
  const preparedAction = page.getByRole("heading", { name: "Prepared action" });
  const evidenceLedger = page.getByRole("heading", { name: "Evidence ledger" });
  expect(
    await preparedAction.evaluate(
      (action, evidence) =>
        Boolean(action.compareDocumentPosition(evidence as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
      await evidenceLedger.elementHandle(),
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Stage action" }).click();
  await expect(page.getByText("Action staged", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Invoice exception packet/i }).click();
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByRole("heading", { name: "Needs review" })).toBeVisible({
    timeout: connectedRunTimeout,
  });
  await expect(page.getByRole("heading", { name: "Create accounts-payable exception review" })).toBeVisible();
  await expect(page.getByText("Review required", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stage action" })).toBeEnabled();
  await page.getByRole("button", { name: "Stage action" }).click();
  await expect(page.getByText("Action staged", { exact: true })).toBeVisible();

  await page.getByLabel("Run A").selectOption({ index: 1 });
  await page.getByLabel("Run B").selectOption({ index: 2 });
  await expect(
    page.getByRole("table", { name: /comparison of two assurance runs/i }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Visitor access request/i }).click();
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByRole("heading", { name: "Incomplete" })).toBeVisible({
    timeout: connectedRunTimeout,
  });
  await expect(page.getByRole("button", { name: "Action blocked" })).toBeDisabled();
});

test("the upload tile opens the native picker then validation recovers to a fixture", async ({
  page,
}) => {
  await page.goto("/workbench");
  const upload = page.getByRole("button", { name: "+ Add your document" });
  await upload.focus();
  const chooserPromise = page.waitForEvent("filechooser");
  await upload.press("Space");
  const chooser = await chooserPromise;
  await chooser.setFiles([]);

  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(
    page.getByText(/Complete the document, field labels and consent/i),
  ).toBeVisible();
  await expect(page.getByLabel("Document file")).toBeFocused();
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await expect(page.getByRole("button", { name: /Invoice exception packet/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
