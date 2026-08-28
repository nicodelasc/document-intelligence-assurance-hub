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
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDirectory, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const video = page.video();

  await page.goto(new URL("/workbench", origin).href);
  await page.getByRole("heading", { name: "Review a document" }).waitFor();
  await showChapter(
    page,
    "Document Intelligence Assurance Hub",
    "A public-safe document assurance prototype",
    "Recorded mode demonstrates the complete workflow without sending a document to a model provider.",
    6_000,
  );

  await page.getByRole("button", { name: "Run assurance check" }).click();
  await page.getByRole("heading", { name: "Clear" }).waitFor();
  await page.getByRole("heading", { name: "Clear" }).scrollIntoViewIfNeeded();
  await showChapter(
    page,
    "1 / 6 · Clean fixture",
    "The invoice matches its purchase-order reference",
    "The trace validates, stores, extracts, verifies each field, compares the reference and publishes telemetry. The deterministic decision is Clear.",
    10_000,
  );

  await page.getByText("Invoice-total mismatch", { exact: true }).click();
  await showChapter(
    page,
    "2 / 6 · Mismatch fixture",
    "One field conflicts with reference data",
    "The same requested fields are evaluated against the synthetic purchase-order register.",
    4_000,
  );
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await page.getByRole("heading", { name: "Needs review" }).waitFor();
  await page
    .getByRole("heading", { name: "Needs review" })
    .scrollIntoViewIfNeeded();
  await showChapter(
    page,
    "2 / 6 · OpenAI selection",
    "The invoice-total conflict is not cleared",
    "The evidence remains visible and the deterministic evaluator returns Needs review. This is an assurance outcome rather than a payment approval.",
    9_000,
  );

  await page.getByRole("radio", { name: /Anthropic Claude Haiku 4.5/ }).check();
  await showChapter(
    page,
    "3 / 6 · Provider rerun",
    "Rerun the same fixture with the Anthropic selection",
    "Recorded mode preserves the provider-specific contract while making no external model request.",
    4_000,
  );
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await page.getByRole("heading", { name: "Needs review" }).waitFor();
  await showChapter(
    page,
    "3 / 6 · Anthropic selection",
    "The same conflict reaches the same safe outcome",
    "The run history records provider, evaluator status, evidence, latency and outcome for comparison.",
    7_000,
  );

  await page.getByLabel("Run A").selectOption({ index: 3 });
  await page.getByLabel("Run B").selectOption({ index: 1 });
  await page
    .getByRole("table", { name: /comparison of two assurance runs/i })
    .waitFor();
  await page
    .getByRole("table", { name: /comparison of two assurance runs/i })
    .scrollIntoViewIfNeeded();
  await showChapter(
    page,
    "4 / 6 · Side-by-side evidence",
    "Compare the clean run with the provider rerun",
    "Requested fields, normalized values, evidence, execution mode, evaluator status, latency and outcome remain reviewable together.",
    10_000,
  );

  await page.getByRole("link", { name: "Operations" }).click();
  await page.getByRole("heading", { name: "Operations" }).waitFor();
  await page.getByText("Benchmark coverage: OpenAI 3 · Anthropic 3").waitFor();
  await showChapter(
    page,
    "5 / 6 · Operations",
    "Public-safe monitoring without hidden prompts",
    "The console separates public run telemetry from the six recorded fixture-provider benchmark combinations.",
    5_000,
  );

  const firstRunSelector = page.locator('input[name="explorer-run"]').first();
  await firstRunSelector.scrollIntoViewIfNeeded();
  await firstRunSelector.check();
  await page.getByRole("heading", { name: "Run detail" }).waitFor();
  await page
    .getByRole("heading", { name: "Run detail" })
    .scrollIntoViewIfNeeded();
  await showChapter(
    page,
    "5 / 6 · Run explorer",
    "Inspect extraction, comparison and step telemetry",
    "The active trace exposes evidence, safe errors, provider metadata and a prompt version identifier. API keys, hidden reasoning and full system prompts are never shown.",
    14_000,
  );

  await page
    .getByText("Illustrative scenario — not measured savings")
    .scrollIntoViewIfNeeded();
  await showChapter(
    page,
    "6 / 6 · Resource scenario",
    "Edit transparent operating assumptions",
    "Every result is labelled as illustrative so the portfolio does not claim measured Samsung or Kyndryl savings.",
    4_000,
    "left",
  );
  await page.getByLabel("Documents each month").fill("400");
  await page
    .getByText("Estimated net savings", { exact: true })
    .scrollIntoViewIfNeeded();
  await showChapter(
    page,
    "6 / 6 · Illustrative result",
    "The calculator updates from the declared inputs",
    "Documents, fields, manual minutes, assisted minutes, loaded hourly cost and average model cost remain editable.",
    10_000,
    "left",
  );
  await showChapter(
    page,
    "Release disclosure",
    "Keyless recorded deployment",
    "This walkthrough made no OpenAI or Anthropic model request. Live acceptance remains gated on explicit key authorization and production verification.",
    10_000,
  );

  await page.close();
  await context.close();
  const recordedPath = await video?.path();
  if (!recordedPath) throw new Error("walkthrough_video_not_created");
  await mkdir(dirname(outputPath), { recursive: true });
  await copyFile(recordedPath, outputPath);
  console.log(`Walkthrough recorded at ${outputPath}`);
} finally {
  await browser.close();
  await rm(videoDirectory, { recursive: true, force: true });
}
