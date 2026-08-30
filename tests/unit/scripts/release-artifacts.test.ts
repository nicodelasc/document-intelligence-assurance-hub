import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { syntheticFixtures } from "@/domain/fixtures";

const projectRoot = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8");
}

const deployment = readProjectFile("docs/deployment-checklist.md");
const walkthrough = readProjectFile("docs/walkthrough-script.md");
const recorder = readProjectFile("scripts/record-walkthrough.mjs");
const readme = readProjectFile("README.md");
// The committed previews measure above 350. A white or texture-only page stays far below 100.
const minimumPreviewLuminanceVariance = 100;

function durationSeconds(timestamp: string): number {
  const [hours, minutes, seconds] = timestamp.split(":").map(Number);
  return hours * 3_600 + minutes * 60 + seconds;
}

async function previewLuminanceVariance(path: string) {
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  let count = 0;
  let sum = 0;
  let sumOfSquares = 0;

  for (let index = 0; index < pixels.length; index += 64) {
    const luminance =
      0.2126 * pixels[index] +
      0.7152 * pixels[index + 1] +
      0.0722 * pixels[index + 2];
    count += 1;
    sum += luminance;
    sumOfSquares += luminance * luminance;
  }

  const mean = sum / count;
  return {
    width: image.width,
    height: image.height,
    variance: sumOfSquares / count - mean * mean,
  };
}

describe("Release artifact hardening", () => {
  it("documents exact-once idempotent application and schema checks for migrations 0008 and 0009", () => {
    expect(deployment).toMatch(
      /psql .*migrations\/0008_document_workflow\.sql/i,
    );
    expect(deployment).toMatch(
      /psql .*migrations\/0009_completed_run_aggregates\.sql/i,
    );
    expect(deployment).toMatch(/0008_document_workflow.*exactly once/is);
    expect(deployment).toMatch(/0009_completed_run_aggregates.*exactly once/is);
    expect(deployment).toMatch(/reapply.*migrations 0001 through 0009/is);
    expect(deployment).toMatch(/idempotenc/i);

    for (const schemaMarker of [
      "runs.document_family",
      "runs.fixture_id",
      "workflow_events",
      "workflow_events_idempotency_idx",
      "workflow_events_run_created_idx",
      "runs.completed_at",
      "safe completed-row backfill",
      "runs_confirmed_model_cost_idx",
    ]) {
      expect(deployment).toContain(schemaMarker);
    }
  });

  it("defines the current keyless rollout smoke across document workflow operations and costs", () => {
    for (const marker of [
      "Supplier invoices",
      "Warehouse goods receipts",
      "Correct",
      "Needs attention",
      "Incorrect",
      "Sample results - no AI processing",
      "No AI processing",
      "Prepared only - not sent",
      "Operations workspace",
      "Costs workspace",
      "No confirmed model runs",
      "US$0.00",
    ]) {
      expect(deployment).toContain(marker);
    }

    expect(deployment).toMatch(/Reference quality.*exactly 10/is);
    expect(deployment).toMatch(/two-thirds Operations.*one-third Costs/is);
    expect(deployment).toMatch(/mobile.*Operations.*before Costs/is);
    expect(deployment).toMatch(/illustrative.*SGD/is);
    expect(deployment).toMatch(/newest-100 explorer/i);
    expect(deployment).toMatch(/expiry or Delete now.*physical cleanup/is);
  });

  it("keeps the walkthrough and recorder aligned to the current two-family UI", () => {
    for (const marker of [
      "Supplier invoices",
      "Warehouse goods receipts",
      "10 provider-neutral observations",
      "Process document",
      "Processing model",
      "Understand document",
      "Verify evidence",
      "Resolve and prepare action",
      "Clean match",
      "Total mismatch",
      "Prepared only - not sent",
      "Run A",
      "Run B",
      "Operations workspace",
      "Costs workspace",
      "No AI processing",
      "Illustrative resource scenario",
    ]) {
      expect(walkthrough).toContain(marker);
      expect(recorder).toContain(marker);
    }

    expect(recorder).toMatch(
      /getByLabel\(["']Processing model["']\)\.selectOption/,
    );
    expect(recorder).toMatch(
      /getByRole\(["']button["'], \{ name: \/Clean match\/i \}\)/,
    );
    expect(recorder).toMatch(
      /getByRole\(["']button["'], \{ name: \/Total mismatch\/i \}\)/,
    );
    expect(recorder).toMatch(/Prepare email to the selected role/);
    expect(recorder).toMatch(/Recipient role/);
    expect(recorder).toMatch(/Prepare copy/);
    expect(walkthrough).toMatch(
      /node scripts\/record-walkthrough\.mjs --base-url/,
    );
    expect(recorder).not.toContain(
      "Total mismatch uses a second selected configuration",
    );
    expect(recorder).toMatch(
      /waitForTimeout\(durationMs\);[\s\S]*caption\?\.remove\(\)/,
    );
    expect(recorder).toMatch(
      /getByRole\("heading", \{ name: "Operations", exact: true \}\)/,
    );
  });

  it("starts the Total mismatch chapter only after processing reaches Needs review", () => {
    const mismatchSelection = recorder.indexOf("name: /Total mismatch/i");
    const nextWorkflowAction = recorder.indexOf(
      'name: "Prepare email to the selected role"',
      mismatchSelection,
    );
    const mismatchFlow = recorder.slice(mismatchSelection, nextWorkflowAction);
    const processClick = mismatchFlow.indexOf(
      'await page.getByRole("button", { name: "Process document"',
    );
    const needsReviewWait = mismatchFlow.indexOf(
      'await page.getByRole("heading", { name: "Needs review"',
      processClick,
    );
    const mismatchChapter = mismatchFlow.indexOf("await showChapter(");

    expect(mismatchSelection).toBeGreaterThanOrEqual(0);
    expect(nextWorkflowAction).toBeGreaterThan(mismatchSelection);
    expect(processClick).toBeGreaterThanOrEqual(0);
    expect(needsReviewWait).toBeGreaterThan(processClick);
    expect(mismatchChapter).toBeGreaterThan(needsReviewWait);
    expect(mismatchFlow.slice(processClick, needsReviewWait)).toMatch(
      /await page[\s\S]*\.click\(\);/,
    );
    expect(mismatchFlow.slice(needsReviewWait, mismatchChapter)).toMatch(
      /\.waitFor\(\);/,
    );
  });

  it("publishes the current keyless artifact in the README", () => {
    expect(readme).toMatch(/current keyless walkthrough/i);
    expect(readme).toContain("artifacts/walkthrough.webm");
    expect(readme).not.toMatch(/A replacement walkthrough must show/i);
  });

  it("tracks a nonempty WebM plus exactly 10 PDF sources and rendered previews", () => {
    const artifact = readFileSync(
      join(projectRoot, "artifacts/walkthrough.webm"),
    );
    expect(artifact.byteLength).toBeGreaterThan(1_000_000);
    expect([...artifact.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

    const sampleDirectory = join(projectRoot, "public/samples");
    const sampleFiles = readdirSync(sampleDirectory);
    expect(syntheticFixtures).toHaveLength(10);
    expect(
      sampleFiles.filter((filename) => filename.endsWith(".pdf")),
    ).toHaveLength(10);
    expect(
      sampleFiles.filter((filename) => filename.endsWith(".png")),
    ).toHaveLength(11);

    for (const fixture of syntheticFixtures) {
      const previewFilename = fixture.filename.replace(/\.pdf$/i, ".png");
      expect(sampleFiles).toContain(fixture.filename);
      expect(sampleFiles).toContain(previewFilename);
      expect(
        statSync(join(sampleDirectory, fixture.filename)).size,
      ).toBeGreaterThan(0);
      const preview = readFileSync(join(sampleDirectory, previewFilename));
      expect(preview.byteLength).toBeGreaterThan(10_000);
      expect([...preview.subarray(0, 8)]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
    }
  });

  it("fully decodes one 1440x900 VP8 stream within half a second of 2:08", () => {
    const artifactPath = join(projectRoot, "artifacts/walkthrough.webm");
    if (!ffmpegPath) {
      throw new Error("ffmpeg_static_binary_unavailable");
    }
    const decode = spawnSync(
      ffmpegPath,
      [
        "-hide_banner",
        "-nostdin",
        "-xerror",
        "-i",
        artifactPath,
        "-map",
        "0:v",
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );

    expect(decode.error).toBeUndefined();
    expect(decode.status, decode.stderr).toBe(0);
    const inputMetadata = decode.stderr.split("Stream mapping:")[0];
    const videoStreams = [
      ...inputMetadata.matchAll(
        /Stream #\d+:\d+[^:]*: Video: ([^,\s]+)[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/g,
      ),
    ];
    expect(videoStreams).toHaveLength(1);
    expect(videoStreams[0]?.[1]).toBe("vp8");
    expect(videoStreams[0]?.[2]).toBe("1440");
    expect(videoStreams[0]?.[3]).toBe("900");

    const duration = inputMetadata.match(
      /Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/,
    );
    expect(duration).not.toBeNull();
    expect(
      Math.abs(durationSeconds(duration?.[1] ?? "00:00:00") - 128),
    ).toBeLessThanOrEqual(0.5);
    expect(walkthrough).toMatch(/measured duration is 2:07\.64/i);
    expect(walkthrough).toContain("## 1:58–2:08 — Disclosure and gate");
  }, 60_000);

  it("decodes every fixture preview at 1191x1684 with visible content", async () => {
    const sampleDirectory = join(projectRoot, "public/samples");

    for (const fixture of syntheticFixtures) {
      const previewPath = join(
        sampleDirectory,
        fixture.filename.replace(/\.pdf$/i, ".png"),
      );
      const preview = await previewLuminanceVariance(previewPath);
      expect(preview.width, fixture.id).toBe(1191);
      expect(preview.height, fixture.id).toBe(1684);
      expect(preview.variance, fixture.id).toBeGreaterThan(
        minimumPreviewLuminanceVariance,
      );
    }
  });

  it("removes retired release wording and preserves non-execution boundaries", () => {
    const releaseArtifacts = [deployment, walkthrough, recorder, readme].join(
      "\n",
    );
    const retiredPatterns = [
      /Demo data — no provider call/i,
      /Not called \(demo\)/i,
      /Run assurance check/i,
      /Warehouse receiving sheet/i,
      /Invoice exception packet/i,
      /Visitor access request/i,
      /Invoice-total mismatch/i,
      /Benchmark coverage: OpenAI 3.*Anthropic 3/i,
      /live-call/i,
      /live[- ]provider/i,
      /public prototype/i,
      /recorded replay/i,
    ];

    for (const pattern of retiredPatterns) {
      expect(releaseArtifacts).not.toMatch(pattern);
    }

    expect(releaseArtifacts).toMatch(/provider acceptance.*not established/is);
    expect(releaseArtifacts).toMatch(/no external connector/is);
    expect(releaseArtifacts).not.toMatch(
      /\b(?:email|message) (?:is|was|will be) sent\b/i,
    );
    expect(releaseArtifacts).not.toMatch(
      /\bexternal (?:action|workflow|business-system) (?:is|was|will be )?executed\b/i,
    );
    expect(releaseArtifacts).not.toMatch(
      /\bprovider acceptance (?:is|was|has been) (?:complete|confirmed|established|verified)\b/i,
    );
  });
});
