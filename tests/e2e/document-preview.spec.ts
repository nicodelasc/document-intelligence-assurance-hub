import { expect, test } from "@playwright/test";

// Headed Chromium owns its PDF viewer. Headless mode intentionally downloads PDFs.
test.use({ headless: false });

test("Workbench previews the selected actual PDF with stable geometry", async ({
  page,
}) => {
  const runPosts: string[] = [];
  const failedPdfRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/runs")) {
      runPosts.push(request.url());
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().endsWith(".pdf")) {
      failedPdfRequests.push(
        `${request.url()} ${request.failure()?.errorText ?? "unknown failure"}`,
      );
    }
  });
  await page.goto("/workbench");

  const invoicePreview = page.getByTitle(
    "Document preview for Northstar Office Supply invoice",
  );
  await expect(invoicePreview).toHaveAttribute(
    "src",
    "/samples/invoice-clean-match.pdf",
  );
  await expect(page.getByRole("link", { name: "Open full document" })).toHaveAttribute(
    "href",
    "/samples/invoice-clean-match.pdf",
  );
  const invoiceBox = await invoicePreview.boundingBox();
  expect(invoiceBox).not.toBeNull();
  expect(invoiceBox!.height).toBeGreaterThanOrEqual(600);
  const expectedInvoiceUrl = new URL(
    "/samples/invoice-clean-match.pdf",
    page.url(),
  ).href;
  await expect
    .poll(async () => {
      const element = await invoicePreview.elementHandle();
      return (await element?.contentFrame())?.url() ?? "";
    })
    .toBe(expectedInvoiceUrl);

  await page.getByRole("tab", { name: "Warehouse goods receipts" }).click();
  await page.getByRole("button", { name: /Item and lot mismatch/i }).click();
  const receiptPreview = page.getByTitle(
    "Document preview for Bluepeak Logistics goods receipt",
  );
  await expect(receiptPreview).toHaveAttribute(
    "src",
    "/samples/warehouse-item-lot-mismatch.pdf",
  );
  await expect(page.getByText("Item code differs from reference.", { exact: true })).toBeVisible();
  await expect(page.getByText("Lot number differs from reference.", { exact: true })).toBeVisible();
  const receiptBox = await receiptPreview.boundingBox();
  expect(receiptBox).not.toBeNull();
  expect(receiptBox!.height).toBe(invoiceBox!.height);
  expect(runPosts).toHaveLength(0);

  const expectedReceiptUrl = new URL(
    "/samples/warehouse-item-lot-mismatch.pdf",
    page.url(),
  ).href;
  await expect
    .poll(async () => {
      const element = await receiptPreview.elementHandle();
      return (await element?.contentFrame())?.url() ?? "";
    })
    .toBe(expectedReceiptUrl);
  await expect.poll(() => failedPdfRequests).toEqual([]);
  await expect
    .poll(() =>
      page.frames().some((frame) =>
        frame.url().startsWith("chrome-extension://") &&
        frame.url().endsWith("/index.html"),
      ),
    )
    .toBe(true);
});

test("the mobile PDF preview and differences panel stack without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/workbench");

  const preview = page.getByTitle(
    "Document preview for Northstar Office Supply invoice",
  );
  const differencePanel = page.getByRole("complementary", { name: "What changed" });
  const previewBox = await preview.boundingBox();
  const differenceBox = await differencePanel.boundingBox();
  expect(previewBox).not.toBeNull();
  expect(differenceBox).not.toBeNull();
  expect(differenceBox!.y).toBeGreaterThanOrEqual(previewBox!.y + previewBox!.height);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
