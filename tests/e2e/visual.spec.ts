import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const connectedLoadTimeout = 15_000;

test("captures approved desktop and mobile evidence", async ({ page }) => {
  const output = join(process.cwd(), "docs", "design", "verification");
  await mkdir(output, { recursive: true });
  for (const route of ["workbench", "operations"]) {
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`/${route}`);
    if (route === "operations") {
      await expect(page.locator("main")).toHaveAttribute("aria-busy", "false", {
        timeout: connectedLoadTimeout,
      });
    } else {
      await expect(page.getByText("Loading active public runs…")).toBeHidden({
        timeout: connectedLoadTimeout,
      });
    }
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: join(output, `${route}-1536x1024.png`), fullPage: false });
    if (route !== "workbench") continue;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/${route}`);
    if (route === "operations") {
      await expect(page.locator("main")).toHaveAttribute("aria-busy", "false", {
        timeout: connectedLoadTimeout,
      });
    } else {
      await expect(page.getByText("Loading active public runs…")).toBeHidden({
        timeout: connectedLoadTimeout,
      });
    }
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: join(output, `${route}-390x844-reduced-motion.png`), fullPage: false });
  }
});
