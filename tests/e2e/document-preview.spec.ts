import { expect, test } from "@playwright/test";

test("active document preview avoids the browser error document", async ({
  page,
  request,
}) => {
  const creation = await request.post("/api/runs", {
    headers: {
      "Idempotency-Key": `preview-${Date.now()}`,
      "X-Run-Source-Type": "synthetic",
      "X-Run-Execution-Mode": "recorded",
    },
    multipart: {
      sourceType: "synthetic",
      provider: "openai",
      sampleId: "clean-match",
      executionMode: "recorded",
    },
  });
  expect(creation.status()).toBe(200);
  const events = (await creation.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const completed = events.find((event) => event.type === "completed");
  const runId = completed?.runId;
  expect(typeof runId).toBe("string");

  await page.goto("/operations");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("radio", { name: `Select ${String(runId)}` }).check();
  const iframe = page.getByTitle(/Active document preview for/);
  await expect(iframe).toBeVisible();

  await expect
    .poll(async () => {
      const element = await iframe.elementHandle();
      const frame = await element?.contentFrame();
      return frame?.url() ?? "";
    })
    .not.toMatch(/^(?:about:blank|chrome-error:\/\/chromewebdata\/)$/);
});
