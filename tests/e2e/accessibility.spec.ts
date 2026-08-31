import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const viewport of [{ name: "desktop", width: 1536, height: 1024 }, { name: "mobile", width: 390, height: 844 }]) {
  for (const route of ["workbench", "operations"]) {
    test(`${route} has no serious or critical axe violations on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: viewport.name === "mobile" ? "reduce" : "no-preference" });
      await page.goto(`/${route}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
}

test("Workbench preserves source preview trace order on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/workbench");

  const headings = await Promise.all(
    [
      "1. Select a procurement document",
      "Document preview",
      "Review progress",
    ].map(async (name) => {
      const box = await page.getByRole("heading", { name }).boundingBox();
      expect(box).not.toBeNull();
      return box!;
    }),
  );
  expect(headings[0].y).toBeLessThan(headings[1].y);
  expect(headings[1].y).toBeLessThan(headings[2].y);
  await expect(page.getByLabel("Processing model")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add your document" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("Workbench workflow role dialog has no serious or critical axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/workbench");
  await page.getByRole("button", { name: /Total mismatch/i }).click();
  await page.getByRole("button", { name: "Assess for exceptions" }).click();
  await expect(
    page.getByRole("heading", { name: "Exception review required" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Assign exception review" }).click();
  await expect(
    page.getByRole("dialog", { name: "Assign exception review" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});
