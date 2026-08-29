import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8");
}

const deployment = readProjectFile("docs/deployment-checklist.md");
const walkthrough = readProjectFile("docs/walkthrough-script.md");
const recorder = readProjectFile("scripts/record-walkthrough.mjs");

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
  });

  it("removes retired release wording and preserves non-execution boundaries", () => {
    const releaseArtifacts = [deployment, walkthrough, recorder].join("\n");
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
