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

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDirectory, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const video = page.video();

  await page.goto(new URL("/workbench", origin).href);
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await page.getByRole("heading", { name: "Clear" }).waitFor();

  await page.getByText("Invoice-total mismatch", { exact: true }).click();
  await page.getByRole("radio", { name: /Anthropic Claude Haiku 4.5/ }).check();
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await page.getByRole("heading", { name: "Needs review" }).waitFor();
  await page.getByLabel("Run A").selectOption({ index: 1 });
  await page.getByLabel("Run B").selectOption({ index: 2 });
  await page
    .getByRole("table", { name: /comparison of two assurance runs/i })
    .waitFor();

  await page.getByRole("link", { name: "Operations" }).click();
  await page.getByRole("heading", { name: "Operations" }).waitFor();
  await page
    .getByText("Illustrative scenario — not measured savings")
    .scrollIntoViewIfNeeded();
  await page.getByLabel("Documents each month").fill("400");
  await page.waitForTimeout(1_500);

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
