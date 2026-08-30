import { expect, test, type Page } from "@playwright/test";

const stageNames = [
  "Understand document",
  "Verify evidence",
  "Resolve and prepare action",
] as const;

const successRunId = "run_guidance_success";
const failureRunId = "run_guidance_failure";

function successRunDetail() {
  return {
    run: {
      id: successRunId,
      status: "completed",
      outcome: "needs_review",
      documentFamily: "supplier_invoice",
      providerCalled: false,
      provider: null,
      model: null,
      details: {
        steps: [],
        workflowEvents: [],
        result: {
          documentClassification: "supplier_invoice",
          fields: [{
            key: "invoice_total",
            label: "Invoice total",
            extractedValue: "S$1,250.00",
            normalizedValue: "1250.00",
            evidence: "Invoice total S$1,250.00",
            page: 1,
            evaluatorStatus: "conflict",
            referenceMatch: false,
          }],
          action: {
            type: "create_ap_exception_case",
            title: "Review invoice mismatch",
            summary: "Keep the invoice in review until the discrepancy is resolved.",
            payload: [{ label: "Invoice total", value: "S$1,250.00" }],
            instructionEvidence: null,
            page: null,
            risk: "medium",
            status: "needs_review",
            reason: "The invoice total differs from the purchase order.",
            stagedAt: null,
          },
        },
      },
    },
  };
}

function failureRunDetail() {
  return {
    run: {
      id: failureRunId,
      status: "failed",
      outcome: null,
      documentFamily: "supplier_invoice",
      providerCalled: false,
      provider: null,
      model: null,
      details: {
        steps: [{ safeCode: "document_parse_failed" }],
        workflowEvents: [],
        result: {
          documentClassification: "supplier_invoice",
          fields: [],
        },
      },
    },
  };
}

async function interceptWorkbenchApi(page: Page, terminal: "success" | "failure") {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === "/api/models") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          models: [{
            id: "gpt-5.6-luna",
            provider: "openai",
            displayName: "GPT-5.6 Luna",
            recommended: true,
          }],
          defaults: { openai: "gpt-5.6-luna", anthropic: "claude-haiku-4-5" },
          providerAvailability: { openai: false, anthropic: false },
        }),
      });
      return;
    }

    if (pathname === "/api/runs" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ runs: [], pagination: { limit: 12, offset: 0, returned: 0 } }),
      });
      return;
    }

    if (pathname === "/api/runs" && request.method() === "POST") {
      const terminalEvent = terminal === "success"
        ? {
            type: "completed",
            outcome: "needs_review",
            runId: successRunId,
            executionMode: "recorded",
            deletionToken: "guidance-capability-success",
            timestamp: "2026-08-30T01:00:03.000Z",
          }
        : {
            type: "failed",
            code: "document_parse_failed",
            message: "The document could not be parsed safely.",
            runId: failureRunId,
            deletionToken: "guidance-capability-failure",
            timestamp: "2026-08-30T01:00:03.000Z",
          };
      const events = [
        { type: "stage", stage: "validating", timestamp: "2026-08-30T01:00:00.000Z" },
        { type: "stage", stage: "extracting", timestamp: "2026-08-30T01:00:01.000Z" },
        { type: "stage", stage: "deciding", timestamp: "2026-08-30T01:00:02.000Z" },
        terminalEvent,
      ];
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      });
      return;
    }

    if (pathname === `/api/runs/${successRunId}` && request.method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(successRunDetail()) });
      return;
    }

    if (pathname === `/api/runs/${failureRunId}` && request.method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(failureRunDetail()) });
      return;
    }

    await route.abort("blockedbyclient");
  });
}

test("opens the Workbench purpose overview from the app header then restores focus", async ({ page }) => {
  await interceptWorkbenchApi(page, "success");
  await page.goto("/workbench");
  const trigger = page.getByRole("button", { name: "How it works" });
  await expect(page.locator(".app-header").getByRole("button", { name: "How it works" })).toBeVisible();
  await trigger.focus();
  await trigger.click();
  const overview = page.getByRole("dialog", { name: "What this workbench does" });
  await expect(overview).toBeVisible();
  await expect(overview).toContainText("agentic document-assurance workflow");
  await expect(overview).toContainText("Built-in documents and reference records are synthetic");
  await expect(overview.getByRole("button", { name: "Start guided tour" })).toBeVisible();

  await overview.getByRole("button", { name: "Close" }).click();

  await expect(overview).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("walks the spotlight steps in order then exits with Escape", async ({ page }) => {
  await interceptWorkbenchApi(page, "success");
  await page.goto("/workbench");
  const trigger = page.getByRole("button", { name: "How it works" });
  await trigger.focus();
  await trigger.click();
  await page.getByRole("button", { name: "Start guided tour" }).click();

  const steps = [
    "Document library",
    "Processing model",
    "Process document",
    "Assurance trace",
    "Decision and next steps",
  ] as const;
  for (let index = 0; index < steps.length; index += 1) {
    const callout = page.getByRole("dialog", { name: steps[index] });
    await expect(callout).toContainText(`Step ${index + 1} of 5`);
    await expect(page.locator(".guided-tour__spotlight")).toBeVisible();
    if (index === 0) {
      await expect(callout.getByRole("heading", { name: steps[index] })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(callout.getByRole("button", { name: "Exit guided tour" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(callout.getByRole("button", { name: "Next" })).toBeFocused();
    }
    if (index < steps.length - 1) await callout.getByRole("button", { name: "Next" }).click();
  }

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("keeps the intermediate header and first spotlight collision-free", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await interceptWorkbenchApi(page, "success");
  await page.goto("/workbench");

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  await page.getByRole("button", { name: "How it works" }).click();
  await page.getByRole("button", { name: "Start guided tour" }).click();
  const spotlight = page.locator(".guided-tour__spotlight");
  await expect(spotlight).toHaveCSS("opacity", "1");
  const [calloutBox, spotlightBox, targetBox] = await Promise.all([
    page.getByRole("dialog", { name: "Document library" }).boundingBox(),
    spotlight.boundingBox(),
    page.locator("#workbench-tour-document-library").boundingBox(),
  ]);
  expect(calloutBox).not.toBeNull();
  expect(spotlightBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(spotlightBox!.width).toBeGreaterThan(40);
  expect(Math.abs(
    spotlightBox!.x + spotlightBox!.width / 2 - (targetBox!.x + targetBox!.width / 2),
  )).toBeLessThanOrEqual(8);
  const overlaps =
    calloutBox!.x < spotlightBox!.x + spotlightBox!.width &&
    calloutBox!.x + calloutBox!.width > spotlightBox!.x &&
    calloutBox!.y < spotlightBox!.y + spotlightBox!.height &&
    calloutBox!.y + calloutBox!.height > spotlightBox!.y;
  expect(overlaps).toBe(false);
});

test("keeps completed assurance and decision spotlights collision-free at 768 px", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await interceptWorkbenchApi(page, "success");
  await page.goto("/workbench");
  await page.getByRole("button", { name: "Process document" }).click();
  await expect(page.getByRole("heading", { name: "Decision and next steps" })).toBeVisible();
  await page.getByRole("button", { name: "How it works" }).click();
  await page.getByRole("button", { name: "Start guided tour" }).click();
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }

  for (const step of [
    { title: "Assurance trace", targetId: "workbench-tour-assurance-trace" },
    { title: "Decision and next steps", targetId: "workbench-tour-decision" },
  ]) {
    const spotlight = page.locator(".guided-tour__spotlight");
    await expect(spotlight).toHaveCSS("opacity", "1");
    const [calloutBox, spotlightBox, targetBox] = await Promise.all([
      page.getByRole("dialog", { name: step.title }).boundingBox(),
      spotlight.boundingBox(),
      page.locator(`#${step.targetId}`).boundingBox(),
    ]);
    expect(calloutBox).not.toBeNull();
    expect(spotlightBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    expect(targetBox!.height).toBeLessThan(80);
    const overlaps =
      calloutBox!.x < spotlightBox!.x + spotlightBox!.width &&
      calloutBox!.x + calloutBox!.width > spotlightBox!.x &&
      calloutBox!.y < spotlightBox!.y + spotlightBox!.height &&
      calloutBox!.y + calloutBox!.height > spotlightBox!.y;
    expect(overlaps).toBe(false);
    if (step.title === "Assurance trace") {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }
  }
});

test("keeps the spotlight and arrow visible in forced colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await interceptWorkbenchApi(page, "success");
  await page.goto("/workbench");
  await page.getByRole("button", { name: "How it works" }).click();
  await page.getByRole("button", { name: "Start guided tour" }).click();
  await expect(page.locator(".guided-tour__spotlight")).toHaveCSS("opacity", "1");
  await expect(page.locator(".guided-tour__arrow")).toBeVisible();

  const spotlightStyle = await page.locator(".guided-tour__spotlight").evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderColor: style.borderColor, forcedColorAdjust: style.forcedColorAdjust };
  });
  const arrowStyle = await page.locator(".guided-tour__arrow").evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, forcedColorAdjust: style.forcedColorAdjust };
  });
  expect(spotlightStyle.forcedColorAdjust).toBe("none");
  expect(spotlightStyle.borderColor).not.toBe("rgb(255, 255, 255)");
  expect(arrowStyle.forcedColorAdjust).toBe("none");
  expect(arrowStyle.backgroundColor).not.toBe("rgba(255, 255, 255, 0)");
});

test("collapses a successful trace then exposes all stages and ordered decision content", async ({ page }) => {
  await interceptWorkbenchApi(page, "success");
  await page.goto("/workbench");
  await page.getByRole("button", { name: "Process document" }).click();

  await expect(page.getByRole("heading", { name: "Decision and next steps" })).toBeVisible();
  const traceToggle = page.getByRole("button", { name: "Assurance trace details" });
  await expect(traceToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("3 of 3 stages completed", { exact: false })).toBeVisible();
  await expect(page.locator(".assurance-trace .trace-list")).toBeHidden();

  await traceToggle.click();
  await expect(traceToggle).toHaveAttribute("aria-expanded", "true");
  for (const stageName of stageNames) {
    await expect(page.getByText(stageName, { exact: true })).toBeVisible();
  }

  const decisionHeadings = await page
    .locator(".decision-panel .decision-panel__section")
    .evaluateAll((sections) => sections.map((section) => section.querySelector("h3")?.textContent?.trim()));
  expect(decisionHeadings).toEqual([
    "Needs review",
    "Decision brief",
    "Evidence differences",
    "Workflow controls",
  ]);
  await expect(
    page.locator(".decision-brief").getByText("Keep the invoice in review until the discrepancy is resolved."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign for review" })).toBeVisible();
});

test("keeps a failed trace expanded for safe diagnostics", async ({ page }) => {
  await interceptWorkbenchApi(page, "failure");
  await page.goto("/workbench");
  await page.getByRole("button", { name: "Process document" }).click();

  await expect(page.getByText("The document could not be parsed safely.", { exact: true })).toBeVisible();
  const traceToggle = page.getByRole("button", { name: "Assurance trace details" });
  await expect(traceToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".assurance-trace .trace-list")).toBeVisible();
  await expect(page.getByText("Resolve and prepare action", { exact: true })).toBeVisible();
  await expect(page.getByText("document parse failed", { exact: true })).toBeVisible();
});

test("keeps the first 390 px viewport usable with reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await interceptWorkbenchApi(page, "success");
  await page.goto("/workbench");

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const heading = page.getByRole("heading", { name: "Review a document" });
  const description = page.getByText(
    "Use synthetic samples or a custom file you voluntarily choose to make public for a limited review.",
    { exact: true },
  );
  const trigger = page.getByRole("button", { name: "How it works" });
  await expect(heading).toBeVisible();
  await expect(description).toBeVisible();
  await expect(trigger).toBeVisible();
  const [headingBox, descriptionBox, triggerBox] = await Promise.all([
    heading.boundingBox(),
    description.boundingBox(),
    trigger.boundingBox(),
  ]);
  expect(headingBox).not.toBeNull();
  expect(descriptionBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();
  const initialViewport = { width: 390, height: 844 };
  for (const box of [headingBox!, descriptionBox!, triggerBox!]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(initialViewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(initialViewport.height);
  }
  for (const [first, second] of [
    [headingBox!, descriptionBox!],
    [headingBox!, triggerBox!],
    [descriptionBox!, triggerBox!],
  ]) {
    const overlaps =
      first.x < second.x + second.width &&
      first.x + first.width > second.x &&
      first.y < second.y + second.height &&
      first.y + first.height > second.y;
    expect(overlaps).toBe(false);
  }
  const descriptionStyle = await description.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });
  expect(descriptionStyle.fontSize).toBeGreaterThanOrEqual(13);
  expect(descriptionStyle.lineHeight).toBeGreaterThanOrEqual(19.5);
  expect(descriptionStyle.scrollWidth).toBeLessThanOrEqual(descriptionStyle.clientWidth);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const transitionDuration = await trigger.evaluate((element) => getComputedStyle(element).transitionDuration);
  const transitionMilliseconds = transitionDuration.endsWith("ms")
    ? Number.parseFloat(transitionDuration)
    : Number.parseFloat(transitionDuration) * 1_000;
  expect(transitionMilliseconds).toBeLessThanOrEqual(0.01);
  await trigger.click();
  await page.getByRole("button", { name: "Start guided tour" }).click();
  const callout = page.getByRole("dialog", { name: "Document library" });
  await expect(callout).toBeVisible();
  const spotlight = page.locator(".guided-tour__spotlight");
  await expect(spotlight).toHaveCSS("opacity", "1");
  const [calloutBox, spotlightBox, targetBox] = await Promise.all([
    callout.boundingBox(),
    spotlight.boundingBox(),
    page.locator("#workbench-tour-document-library").boundingBox(),
  ]);
  expect(calloutBox).not.toBeNull();
  expect(spotlightBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(spotlightBox!.width).toBeGreaterThan(40);
  expect(Math.abs(
    spotlightBox!.x + spotlightBox!.width / 2 - (targetBox!.x + targetBox!.width / 2),
  )).toBeLessThanOrEqual(8);
  expect(calloutBox!.x).toBeGreaterThanOrEqual(16);
  expect(calloutBox!.x + calloutBox!.width).toBeLessThanOrEqual(390 - 16);
  const overlapsSpotlight =
    calloutBox!.x < spotlightBox!.x + spotlightBox!.width &&
    calloutBox!.x + calloutBox!.width > spotlightBox!.x &&
    calloutBox!.y < spotlightBox!.y + spotlightBox!.height &&
    calloutBox!.y + calloutBox!.height > spotlightBox!.y;
  expect(overlapsSpotlight).toBe(false);
  const animationDuration = await callout.evaluate((element) => getComputedStyle(element).animationDuration);
  const animationMilliseconds = animationDuration.endsWith("ms")
    ? Number.parseFloat(animationDuration)
    : Number.parseFloat(animationDuration) * 1_000;
  expect(animationMilliseconds).toBeLessThanOrEqual(0.01);
  await page.keyboard.press("Escape");
  const process = page.getByRole("button", { name: "Process document" });
  await process.scrollIntoViewIfNeeded();
  await expect(process).toBeEnabled();
  await process.click();
  await expect(page.getByRole("heading", { name: "Decision and next steps" })).toBeVisible();
});
