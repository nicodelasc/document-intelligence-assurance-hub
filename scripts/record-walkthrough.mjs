import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";

function option(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args
    .find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

const args = process.argv.slice(2);
const baseUrl = option(args, "--base-url") ?? process.env.WALKTHROUGH_BASE_URL;
const outputPath = resolve(
  option(args, "--output") ??
    process.env.WALKTHROUGH_OUTPUT ??
    "artifacts/walkthrough.webm",
);

if (!baseUrl) {
  throw new Error(
    "Provide --base-url http://127.0.0.1:3100 or set WALKTHROUGH_BASE_URL.",
  );
}

const origin = new URL(baseUrl).origin;
const videoDirectory = await mkdtemp(join(tmpdir(), "assurance-walkthrough-"));
const browser = await chromium.launch();

async function showChapter(
  page,
  eyebrow,
  title,
  body,
  durationMs,
  side = "right",
) {
  await page.evaluate(
    ({ eyebrow, title, body, side }) => {
      let caption = document.querySelector("[data-walkthrough-caption]");
      if (!caption) {
        caption = document.createElement("aside");
        caption.dataset.walkthroughCaption = "true";
        caption.setAttribute("aria-hidden", "true");
        Object.assign(caption.style, {
          position: "fixed",
          zIndex: "2147483647",
          right: "28px",
          bottom: "24px",
          width: "min(520px, calc(100vw - 56px))",
          padding: "18px 20px",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          borderRadius: "14px",
          color: "#ffffff",
          background: "rgba(10, 18, 34, 0.94)",
          boxShadow: "0 18px 50px rgba(0, 0, 0, 0.3)",
          fontFamily: "Arial, sans-serif",
          pointerEvents: "none",
        });
        document.body.append(caption);
      }

      Object.assign(caption.style, {
        right: side === "right" ? "28px" : "auto",
        left: side === "left" ? "28px" : "auto",
      });
      caption.replaceChildren();
      const eyebrowNode = document.createElement("div");
      eyebrowNode.textContent = eyebrow;
      Object.assign(eyebrowNode.style, {
        marginBottom: "6px",
        color: "#9FC2FF",
        fontSize: "12px",
        fontWeight: "700",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      });
      const titleNode = document.createElement("strong");
      titleNode.textContent = title;
      Object.assign(titleNode.style, {
        display: "block",
        marginBottom: "7px",
        fontSize: "20px",
        lineHeight: "1.25",
      });
      const bodyNode = document.createElement("p");
      bodyNode.textContent = body;
      Object.assign(bodyNode.style, {
        margin: "0",
        color: "#E8EEF8",
        fontSize: "14px",
        lineHeight: "1.5",
      });
      caption.append(eyebrowNode, titleNode, bodyNode);
    },
    { eyebrow, title, body, side },
  );
  await page.waitForTimeout(durationMs);
  await page.evaluate(() => {
    const caption = document.querySelector("[data-walkthrough-caption]");
    caption?.remove();
  });
}

async function assertKeylessProviderAvailability(page) {
  const response = await page.request.get(new URL("/api/models", origin).href);
  if (!response.ok()) {
    throw new Error("walkthrough_model_availability_unavailable");
  }
  const payload = await response.json();
  const availability = payload?.providerAvailability;
  if (
    !availability ||
    typeof availability.openai !== "boolean" ||
    typeof availability.anthropic !== "boolean"
  ) {
    throw new Error("walkthrough_model_availability_invalid");
  }
  if (availability.openai || availability.anthropic) {
    throw new Error("walkthrough_requires_keyless_provider_routes");
  }
}

async function waitForRenderedImage(page, selector) {
  await page.locator(selector).waitFor();
  await page.waitForFunction((imageSelector) => {
    const image = document.querySelector(imageSelector);
    return (
      image instanceof HTMLImageElement &&
      image.complete &&
      image.naturalWidth > 0
    );
  }, selector);
}

let releaseError;

try {
  let context;
  let page;
  let video;
  let walkthroughError;

  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: videoDirectory, size: { width: 1440, height: 900 } },
    });
    page = await context.newPage();
    video = page.video();

    await assertKeylessProviderAvailability(page);
    await page.goto(new URL("/workbench", origin).href);
    await page
      .getByRole("heading", { name: "Review incoming procurement documents" })
      .waitFor();
    await page.getByRole("tab", { name: "Supplier invoices" }).waitFor();
    await page.getByRole("tab", { name: "Warehouse goods receipts" }).waitFor();
    await page.getByLabel("Processing model").waitFor();
    await page
      .getByText("Sample results - no AI processing", { exact: true })
      .waitFor();
    await waitForRenderedImage(page, ".document-preview__image");
    await showChapter(
      page,
      "Document Intelligence Assurance Hub",
      "Review incoming procurement documents",
      "Finance and warehouse teams verify synthetic supplier invoices and goods receipts before a controlled downstream handoff. The Processing model selector changes configuration only until Assess for exceptions is pressed.",
      7_000,
    );

    await page.getByRole("tab", { name: "Warehouse goods receipts" }).click();
    await page
      .locator('[role="tabpanel"]:not([hidden])')
      .getByTestId("fixture-variant")
      .first()
      .waitFor();
    await showChapter(
      page,
      "Two document families",
      "Five Warehouse goods receipts",
      "The second family also contains Correct, Needs attention and Incorrect variants. Browsing does not start processing.",
      6_000,
    );

    await page.getByRole("tab", { name: "Supplier invoices" }).click();
    await page.getByRole("button", { name: /Clean match/i }).click();
    await waitForRenderedImage(page, ".document-preview__image");
    await page.getByLabel("Processing model").selectOption("gpt-5.6-luna");
    await page.getByRole("button", { name: "Assess for exceptions" }).click();
    await page
      .getByRole("heading", { name: "Ready for posting review" })
      .waitFor();
    await page
      .getByRole("heading", { name: "Review result" })
      .scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "View review steps" }).click();
    for (const stage of [
      "Understand document",
      "Verify evidence",
      "Triage exception and prepare handoff",
    ]) {
      await page.getByText(stage, { exact: true }).waitFor();
    }
    await page
      .getByRole("button", { name: "Prepare posting handoff" })
      .waitFor();
    await showChapter(
      page,
      "1 / 7 · Correct fixture",
      "Clean match is ready for a posting decision",
      "Understand document, Verify evidence and Triage exception and prepare handoff are the three visible stages. Prepare posting handoff records preparation only. This fallback result has No AI processing attribution.",
      14_000,
    );

    await page.getByRole("button", { name: /Total mismatch/i }).click();
    await waitForRenderedImage(page, ".document-preview__image");
    await page.getByLabel("Processing model").selectOption("claude-haiku-4-5");
    await page.getByRole("button", { name: "Assess for exceptions" }).click();
    await page
      .getByRole("heading", { name: "Exception review required" })
      .waitFor();
    await page
      .getByRole("heading", { name: "Exception review required" })
      .scrollIntoViewIfNeeded();
    await showChapter(
      page,
      "2 / 7 · Needs attention",
      "The invoice-total conflict is not cleared",
      "The evidence remains visible and the deterministic evaluator requires exception review. Assign exception review and Draft clarification request are the only preparation controls. This outcome does not approve payment or contact an external system.",
      12_000,
    );

    await page
      .getByRole("button", { name: "Draft clarification request" })
      .click();
    const prepareDialog = page.getByRole("dialog", {
      name: "Draft clarification request",
    });
    await prepareDialog.getByLabel("Recipient role").waitFor();
    await prepareDialog
      .getByRole("button", { name: "Prepare request" })
      .waitFor();
    await showChapter(
      page,
      "3 / 7 · Simulated workflow",
      "A recipient role is required",
      "The blank role keeps Prepare request disabled. The role is a synthetic workflow label rather than an address or delivery destination.",
      4_000,
    );
    await prepareDialog.getByLabel("Recipient role").selectOption("Buyer");
    await prepareDialog
      .getByRole("button", { name: "Prepare request" })
      .click();
    const previewDialog = page.getByRole("dialog", {
      name: "Prepared email copy",
    });
    await previewDialog
      .getByText("Prepared only - not sent", { exact: true })
      .waitFor();
    await showChapter(
      page,
      "3 / 7 · Prepared only - not sent",
      "The copy remains inside the requesting browser",
      "The application exposes no delivery control. Closing the preview leaves one prepared case handoff event.",
      12_000,
    );
    await previewDialog.getByRole("button", { name: "Close preview" }).click();
    await page
      .getByText("Email copy prepared - not sent", { exact: true })
      .waitFor();

    await page.getByLabel("Run A").selectOption({ index: 1 });
    await page.getByLabel("Run B").selectOption({ index: 2 });
    await page
      .getByRole("table", { name: /comparison of two assurance runs/i })
      .waitFor();
    await page
      .getByRole("table", { name: /comparison of two assurance runs/i })
      .scrollIntoViewIfNeeded();
    await showChapter(
      page,
      "4 / 7 · Run A and Run B",
      "Compare correct and discrepancy evidence",
      "Requested fields, normalized values, evidence, selected configuration, No AI processing attribution and outcome remain reviewable together.",
      12_000,
    );

    await page.getByRole("link", { name: "Operations" }).click();
    await page
      .getByRole("heading", {
        name: "Procurement review operations",
        exact: true,
      })
      .waitFor();
    const reviewQueue = page.getByRole("table", {
      name: "Procurement review queue",
    });
    await reviewQueue.waitFor();
    await reviewQueue.scrollIntoViewIfNeeded();
    await page
      .getByRole("heading", { name: "Processing performance", level: 3 })
      .waitFor();
    await page
      .getByRole("heading", { name: "Reference quality suite", level: 3 })
      .waitFor();
    await showChapter(
      page,
      "5 / 7 · Procurement review operations",
      "The review queue comes first",
      "Procurement review queue leads with the business decision and prepared next step before processing performance and the Reference quality suite. The 10 provider-neutral observations do not establish provider acceptance.",
      13_000,
    );

    const firstRunSelector = page.locator('input[name="explorer-run"]').first();
    await firstRunSelector.scrollIntoViewIfNeeded();
    await firstRunSelector.check();
    await page
      .getByRole("heading", { name: "Review record and technical trace" })
      .waitFor();
    await page
      .getByRole("heading", { name: "Review record and technical trace" })
      .scrollIntoViewIfNeeded();
    await waitForRenderedImage(page, ".inspector-preview img");
    await showChapter(
      page,
      "5 / 7 · Review record and technical trace",
      "Confirmed attribution remains truthful",
      "The selected fallback run reads No AI processing. A configured model is never promoted into confirmed dispatch attribution.",
      9_000,
    );

    await page
      .getByRole("heading", { name: "Costs workspace", level: 2 })
      .scrollIntoViewIfNeeded();
    await page.getByText("US$0.00", { exact: true }).first().waitFor();
    await page
      .getByText("No confirmed model runs", { exact: true })
      .first()
      .waitFor();
    await page
      .getByRole("heading", {
        name: "Illustrative resource scenario",
        level: 3,
      })
      .scrollIntoViewIfNeeded();
    await showChapter(
      page,
      "6 / 7 · Costs workspace",
      "US$0.00 and No confirmed model runs",
      "The Illustrative resource scenario uses declared SGD inputs plus an illustrative exchange-rate assumption. It is not measured savings.",
      13_000,
      "left",
    );
    await page.getByLabel("Documents each month").fill("400");
    await page
      .getByText("Estimated net savings", { exact: true })
      .scrollIntoViewIfNeeded();
    await showChapter(
      page,
      "6 / 7 · Illustrative result",
      "The calculator updates from the declared inputs",
      "Documents, fields, manual minutes, assisted minutes, loaded hourly cost and confirmed average model cost remain editable. Every SGD result stays illustrative.",
      8_000,
      "left",
    );
    await showChapter(
      page,
      "7 / 7 · Release disclosure",
      "Provider acceptance is not established",
      "All documents and reference records are synthetic. The extraction, comparison, evaluator safeguards and workflow preparation are functional. ERP posting, payment, inventory, email and archive integrations are simulated and no external business system is changed. This walkthrough made no model request.",
      10_000,
    );
  } catch (error) {
    walkthroughError = error;
  } finally {
    try {
      await page?.close();
    } catch (error) {
      walkthroughError ??= error;
    }
    try {
      await context?.close();
    } catch (error) {
      walkthroughError ??= error;
    }
  }

  if (walkthroughError) throw walkthroughError;
  const recordedPath = await video?.path();
  if (!recordedPath) throw new Error("walkthrough_video_not_created");
  await mkdir(dirname(outputPath), { recursive: true });
  await copyFile(recordedPath, outputPath);
  console.log(`Walkthrough recorded at ${outputPath}`);
} catch (error) {
  releaseError = error;
} finally {
  try {
    await browser.close();
  } catch (error) {
    releaseError ??= error;
  }
  try {
    await rm(videoDirectory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (error) {
    releaseError ??= error;
  }
}

if (releaseError) throw releaseError;
