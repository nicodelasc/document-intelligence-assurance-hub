import { test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test("captures approved desktop and mobile evidence", async ({ page }) => {
  const output = join(process.cwd(), "docs", "design", "verification");
  await mkdir(output, { recursive: true });
  for (const route of ["workbench", "operations"]) {
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`/${route}`);
    await page.screenshot({ path: join(output, `${route}-1536x1024.png`), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/${route}`);
    await page.screenshot({ path: join(output, `${route}-390x844-reduced-motion.png`), fullPage: false });
  }
});
