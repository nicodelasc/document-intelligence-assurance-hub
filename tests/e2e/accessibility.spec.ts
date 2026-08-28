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
    ["1. Source", "Document preview", "Assurance trace"].map(async (name) => {
      const box = await page.getByRole("heading", { name }).boundingBox();
      expect(box).not.toBeNull();
      return box!;
    }),
  );
  expect(headings[0].y).toBeLessThan(headings[1].y);
  expect(headings[1].y).toBeLessThan(headings[2].y);
  await expect(page.getByLabel("Live custom-run model")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add your document" })).toBeVisible();
});
