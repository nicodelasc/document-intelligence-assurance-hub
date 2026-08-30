import { expect, test } from "@playwright/test";

test("Workbench previews the selected rendered document with stable geometry", async ({
  page,
}) => {
  const runPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/runs")) {
      runPosts.push(request.url());
    }
  });
  await page.goto("/workbench");

  const invoicePreview = page.getByRole("img", {
    name: "Rendered preview of Northstar Office Supply invoice",
  });
  await expect(invoicePreview).toHaveAttribute(
    "src",
    "/samples/invoice-clean-match.png",
  );
  await expect(page.getByRole("link", { name: "Open full document" })).toHaveAttribute(
    "href",
    "/samples/invoice-clean-match.pdf",
  );
  const invoiceBox = await invoicePreview.boundingBox();
  expect(invoiceBox).not.toBeNull();
  expect(invoiceBox!.height).toBeGreaterThanOrEqual(600);
  await expect
    .poll(() => invoicePreview.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Warehouse goods receipts" }).click();
  await page.getByRole("button", { name: /Item and lot mismatch/i }).click();
  const receiptPreview = page.getByRole("img", {
    name: "Rendered preview of Bluepeak Logistics goods receipt",
  });
  await expect(receiptPreview).toHaveAttribute(
    "src",
    "/samples/warehouse-item-lot-mismatch.png",
  );
  await expect(page.getByText("Item code differs from reference.", { exact: true })).toBeVisible();
  await expect(page.getByText("Lot number differs from reference.", { exact: true })).toBeVisible();
  const receiptBox = await receiptPreview.boundingBox();
  expect(receiptBox).not.toBeNull();
  expect(receiptBox!.height).toBe(invoiceBox!.height);
  expect(runPosts).toHaveLength(0);

  await expect
    .poll(() => receiptPreview.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});

test("the mobile PDF preview and differences panel stack without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/workbench");

  const preview = page.getByRole("img", {
    name: "Rendered preview of Northstar Office Supply invoice",
  });
  const differencePanel = page.getByRole("complementary", { name: "What changed" });
  const previewBox = await preview.boundingBox();
  const differenceBox = await differencePanel.boundingBox();
  expect(previewBox).not.toBeNull();
  expect(differenceBox).not.toBeNull();
  expect(differenceBox!.y).toBeGreaterThanOrEqual(previewBox!.y + previewBox!.height);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await page.getByRole("button", { name: "Process document" }).click();
  await expect(page.getByRole("heading", { name: "Clear" })).toBeVisible();
  const evidenceLedger = page.getByRole("region", {
    name: "Scrollable extracted field ledger",
  });
  await expect(evidenceLedger).toBeVisible();
  expect(
    await evidenceLedger.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  const fieldColumn = await evidenceLedger
    .getByRole("columnheader", { name: "Field" })
    .boundingBox();
  expect(fieldColumn).not.toBeNull();
  expect(fieldColumn!.width).toBeGreaterThanOrEqual(110);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
