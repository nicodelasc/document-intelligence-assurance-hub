import { describe, expect, it } from "vitest";
import {
  InMemoryRunRepository,
  createNeonRunRepository,
  type NeonDriver,
} from "@/server/repositories/run-repository";
import { syntheticFixtures } from "@/domain/fixtures";

const createdAt = "2026-08-27T00:00:00.000Z";
const expiresAt = "2026-08-27T23:55:00.000Z";

function runRecord(id = "run-1") {
  return {
    id,
    provider: "openai" as const,
    model: "gpt-5-mini",
    promptVersion: "recorded-fixture-2026-08-27.v1",
    executionMode: "recorded" as const,
    providerDispatched: false,
    sourceType: "synthetic" as const,
    file: {
      filename: "clean-match-invoice.pdf",
      mediaType: "application/pdf",
      sizeBytes: 2048,
      pageCount: 1,
    },
    documentKey: `runs/${id}/clean-match-invoice.pdf`,
    requestedFields: [
      { key: "vendor_name", label: "Vendor name" },
      { key: "purchase_order_number", label: "Purchase-order number" },
      { key: "invoice_total", label: "Invoice total" },
    ],
    status: "validating" as const,
    outcome: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    estimatedCostUsd: 0,
    consent: false,
    createdAt,
    expiresAt,
    deletedAt: null,
    deletionTokenHash: `sha256:${"a".repeat(64)}`,
    retryCount: 0,
    latencyMs: null,
    stepDurations: {},
  };
}

const fields = [
  {
    key: "vendor_name",
    label: "Vendor name",
    extractedValue: "Northstar Paperworks",
    normalizedValue: "Northstar Paperworks",
    evidence: "Supplier: Northstar Paperworks",
    page: 1,
    evaluatorStatus: "pass" as const,
    referenceMatch: true,
  },
];

describe("InMemoryRunRepository", () => {
  it("counts provider usage only after one idempotent confirmed dispatch", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun(runRecord("recorded-run"));
    await repository.createRun({
      ...runRecord("live-run"),
      provider: "anthropic",
      model: "claude-haiku-4-5",
      executionMode: "live",
      sourceType: "custom",
    });

    expect((await repository.aggregateAnonymousUsage()).providerCounts).toEqual({
      openai: 0,
      anthropic: 0,
    });
    await expect(repository.markProviderDispatched("live-run")).resolves.toBe(true);
    await expect(repository.markProviderDispatched("live-run")).resolves.toBe(true);
    await expect(repository.markProviderDispatched("recorded-run")).resolves.toBe(false);

    expect((await repository.aggregateAnonymousUsage()).providerCounts).toEqual({
      openai: 0,
      anthropic: 1,
    });
    await expect(
      repository.readPublicRun("live-run", new Date("2026-08-27T01:00:00.000Z")),
    ).resolves.toMatchObject({ providerDispatched: true });
  });

  it("persists confirmed dispatch idempotently in Neon and reads the durable fact", async () => {
    const queries: Array<{ sql: string; parameters: unknown[] }> = [];
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        queries.push({ sql, parameters });
        if (sql.includes("UPDATE runs SET provider_dispatched = true")) {
          return [{ id: "run-neon" }];
        }
        if (sql.includes("SELECT * FROM runs WHERE id")) {
          return [{
            id: "run-neon",
            provider: "openai",
            model: "gpt-5.6-luna",
            prompt_version: "live.v1",
            execution_mode: "live",
            provider_dispatched: true,
            source_type: "custom",
            file_metadata: { filename: "invoice.pdf", mediaType: "application/pdf", sizeBytes: 100, pageCount: 1 },
            requested_fields: [],
            status: "failed",
            outcome: null,
            usage: { inputTokens: 0, outputTokens: 0 },
            estimated_cost_usd: 0,
            consent: true,
            created_at: createdAt,
            expires_at: expiresAt,
            deleted_at: null,
            retry_count: 1,
            latency_ms: 10,
            step_durations: {},
            details_deleted: false,
          }];
        }
        if (sql.includes("SELECT step_json") || sql.includes("SELECT result_json")) return [];
        return [];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });

    await expect(repository.markProviderDispatched("run-neon")).resolves.toBe(true);
    await expect(repository.markProviderDispatched("run-neon")).resolves.toBe(true);
    await expect(
      repository.readPublicRun("run-neon", new Date("2026-08-27T01:00:00.000Z")),
    ).resolves.toMatchObject({ providerDispatched: true });
    expect(queries.filter((entry) => entry.sql.includes("UPDATE runs SET provider_dispatched = true"))).toHaveLength(2);
    expect(queries[0]?.sql).toMatch(/execution_mode = 'live'/);
  });

  it("stages a permitted action once with one internal action step", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun(runRecord());
    const action = structuredClone(syntheticFixtures[1].action);
    await repository.saveResults("run-1", {
      fields: [],
      outcome: "clear",
      documentInstruction: action.instructionEvidence,
      action,
      usage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      retryCount: 0,
      latencyMs: 10,
      stepDurations: {},
      completedAt: "2026-08-27T00:00:01.000Z",
    });

    const first = await repository.stageAction(
      "run-1",
      new Date("2026-08-27T00:05:00.000Z"),
    );
    const duplicate = await repository.stageAction(
      "run-1",
      new Date("2026-08-27T00:06:00.000Z"),
    );
    const run = await repository.readPublicRun(
      "run-1",
      new Date("2026-08-27T00:07:00.000Z"),
    );

    expect(first).toMatchObject({ status: "staged" });
    expect(duplicate).toEqual({
      status: "already_staged",
      action: first.status === "staged" ? first.action : action,
    });
    expect(run?.details?.steps.filter((step) => step.kind === "action")).toEqual([
      expect.objectContaining({ stage: "action_staged" }),
    ]);
  });

  it("returns details while active then only safe expired metadata before physical purge", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun(runRecord());
    await repository.appendStep("run-1", {
      kind: "stage",
      stage: "extracting",
      timestamp: "2026-08-27T00:00:01.000Z",
      durationMs: 25,
    });
    await repository.saveResults("run-1", {
      fields,
      outcome: "clear",
      usage: { inputTokens: 100, outputTokens: 25 },
      estimatedCostUsd: 0.000075,
      retryCount: 0,
      latencyMs: 420,
      stepDurations: { extracting: 220 },
      completedAt: "2026-08-27T00:00:02.000Z",
    });

    const active = await repository.readPublicRun("run-1", new Date("2026-08-27T23:54:59.999Z"));
    expect(active?.status).toBe("completed");
    expect(active?.details?.result?.fields).toEqual(fields);
    expect(active?.details?.steps).toHaveLength(1);

    const serialized = JSON.stringify(active);
    expect(serialized).not.toContain("deletionTokenHash");
    expect(serialized).not.toContain("sha256:");
    expect(serialized).not.toMatch(/systemPrompt|reasoning|apiKey/i);

    const expired = await repository.readPublicRun("run-1", new Date(expiresAt));
    expect(expired?.status).toBe("expired");
    expect(expired?.details).toBeUndefined();
    expect(expired?.outcome).toBe("clear");
    expect(expired?.file.filename).toBe("expired-document");
    expect(expired?.requestedFields).toEqual([]);
  });

  it("purges detailed data idempotently while anonymous aggregates survive", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun(runRecord());
    await repository.saveResults("run-1", {
      fields,
      outcome: "clear",
      usage: { inputTokens: 100, outputTokens: 25 },
      estimatedCostUsd: 0.000075,
      retryCount: 0,
      latencyMs: 420,
      stepDurations: { extracting: 220 },
      completedAt: "2026-08-27T00:00:02.000Z",
    });

    const first = await repository.purgeExpiredData(new Date(expiresAt));
    const second = await repository.purgeExpiredData(new Date("2026-08-28T00:00:00.000Z"));

    expect(first).toEqual({
      purgedRunIds: ["run-1"],
      documentKeys: ["runs/run-1/clean-match-invoice.pdf"],
      failedRunIds: [],
    });
    expect(second).toEqual({ purgedRunIds: [], documentKeys: [], failedRunIds: [] });
    expect(await repository.getDeletionTokenHash("run-1")).toBeNull();
    expect(await repository.aggregateAnonymousUsage()).toMatchObject({
      totalRuns: 1,
      completedRuns: 1,
      failedRuns: 0,
      totalInputTokens: 100,
      totalOutputTokens: 25,
      providerCounts: { openai: 0, anthropic: 0 },
      outcomeCounts: { clear: 1 },
    });
  });

  it("exposes in-memory active and failed steps before any result exists", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun(runRecord());
    await repository.appendStep("run-1", {
      kind: "stage",
      stage: "extracting",
      timestamp: "2026-08-27T00:00:01.000Z",
      durationMs: 25,
    });

    const active = await repository.readPublicRun("run-1", new Date("2026-08-27T01:00:00.000Z"));
    expect(active?.details).toEqual({
      steps: [expect.objectContaining({ stage: "extracting" })],
      result: null,
    });
    await expect(repository.listPublicRuns(new Date("2026-08-27T01:00:00.000Z"))).resolves.toEqual([
      expect.objectContaining({ details: expect.objectContaining({ result: null }) }),
    ]);

    await repository.markFailed("run-1", {
      timestamp: "2026-08-27T00:00:02.000Z",
      safeCode: "provider_unavailable",
      failedStage: "failed",
      retryCount: 1,
      latencyMs: 400,
      stepDurations: { extracting: 375 },
    });
    const failed = await repository.readPublicRun("run-1", new Date("2026-08-27T01:00:00.000Z"));
    expect(failed?.status).toBe("failed");
    expect(failed).toMatchObject({
      retryCount: 1,
      latencyMs: 400,
      stepDurations: { extracting: 375 },
    });
    expect(failed?.details?.result).toBeNull();
    expect(failed?.details?.steps.map((step) => step.stage)).toEqual(["extracting", "failed"]);
    await expect(repository.listPublicRuns(new Date("2026-08-27T01:00:00.000Z"))).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        details: expect.objectContaining({ result: null }),
      }),
    ]);
  });

  it("exposes mocked Neon active and failed steps before any result exists", async () => {
    let status = "extracting";
    let failureWrite: unknown[] | undefined;
    const row = () => ({
      id: "run-neon",
      provider: "openai",
      model: "gpt-5-mini",
      prompt_version: "document-extraction-2026-08-27.v1",
      execution_mode: "live",
      source_type: "synthetic",
      file_metadata: {
        filename: "invoice.pdf",
        mediaType: "application/pdf",
        sizeBytes: 100,
        pageCount: 1,
      },
      requested_fields: [{ key: "invoice_total", label: "Invoice total" }],
      status,
      outcome: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      estimated_cost_usd: 0,
      consent: false,
      created_at: "2026-08-27T00:00:00.000Z",
      expires_at: "2026-08-27T23:55:00.000Z",
      deleted_at: null,
      retry_count: status === "failed" ? 1 : 0,
      latency_ms: status === "failed" ? 400 : null,
      step_durations: status === "failed" ? { extracting: 375 } : {},
      details_deleted: false,
    });
    const driver: NeonDriver = {
      async query(sql, parameters) {
        if (sql.includes("UPDATE runs SET status = 'failed'")) {
          failureWrite = parameters;
          status = "failed";
          return [];
        }
        if (sql.includes("SELECT * FROM runs WHERE id")) return [row()];
        if (sql.includes("FROM runs ORDER BY")) return [row()];
        if (sql.includes("SELECT step_json FROM run_steps")) {
          return [{ step_json: { kind: "stage", stage: status, timestamp: createdAt, durationMs: 25 } }];
        }
        if (sql.includes("SELECT result_json FROM run_results")) return [];
        return [];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });

    const active = await repository.readPublicRun("run-neon", new Date("2026-08-27T01:00:00.000Z"));
    expect(active?.details).toEqual({
      steps: [expect.objectContaining({ stage: "extracting" })],
      result: null,
    });
    await expect(repository.listPublicRuns(new Date("2026-08-27T01:00:00.000Z"))).resolves.toEqual([
      expect.objectContaining({ details: expect.objectContaining({ result: null }) }),
    ]);

    await repository.markFailed("run-neon", {
      timestamp: "2026-08-27T00:00:02.000Z",
      safeCode: "provider_unavailable",
      failedStage: "failed",
      retryCount: 1,
      latencyMs: 400,
      stepDurations: { extracting: 375 },
    });
    expect(failureWrite).toEqual([
      "run-neon",
      expect.stringContaining('"safeCode":"provider_unavailable"'),
      1,
      400,
      JSON.stringify({ extracting: 375 }),
    ]);
    const failed = await repository.readPublicRun("run-neon", new Date("2026-08-27T01:00:00.000Z"));
    expect(failed?.status).toBe("failed");
    expect(failed?.details).toEqual({
      steps: [expect.objectContaining({ stage: "failed" })],
      result: null,
    });
    await expect(repository.listPublicRuns(new Date("2026-08-27T01:00:00.000Z"))).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        details: expect.objectContaining({ result: null }),
      }),
    ]);
  });

  it("locks the Neon action result before classifying and inserts from the successful update", async () => {
    let stagingSql = "";
    const stagedAt = "2026-08-27T00:05:00.000Z";
    const action = {
      ...structuredClone(syntheticFixtures[1].action),
      stagedAt,
    };
    const driver: NeonDriver = {
      async query(sql) {
        stagingSql = sql;
        return [
          {
            decision: "staged",
            result_json: {
              fields: [],
              outcome: "clear",
              documentInstruction: action.instructionEvidence,
              action,
              usage: { inputTokens: 0, outputTokens: 0 },
              estimatedCostUsd: 0,
              retryCount: 0,
              latencyMs: 10,
              stepDurations: {},
              completedAt: "2026-08-27T00:00:01.000Z",
            },
          },
        ];
      },
    };
    const repository = createNeonRunRepository({
      databaseUrl: undefined,
      driver,
    });

    await expect(
      repository.stageAction("run-neon", new Date(stagedAt)),
    ).resolves.toEqual({ status: "staged", action });
    expect(stagingSql).toMatch(
      /LEFT JOIN LATERAL \(\s*SELECT result_json\s*FROM run_results AS locked_result\s*WHERE locked_result\.run_id = runs\.id\s*FOR UPDATE OF locked_result\s*\) AS result ON true/,
    );
    expect(stagingSql).toMatch(
      /INSERT INTO run_steps \(run_id, step_json\)\s*SELECT run_id, \$3::jsonb FROM updated/,
    );
  });

  it("keeps a Neon tombstone immutable when a late status update arrives", async () => {
    const queries: Array<{ sql: string; parameters: unknown[] }> = [];
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        queries.push({ sql, parameters });
        return [];
      },
    };
    const repository = createNeonRunRepository({
      databaseUrl: undefined,
      driver,
    });

    await repository.setStatus("run-neon", "extracting");

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(
      /UPDATE runs SET status = \$2 WHERE id = \$1 AND details_deleted = false/,
    );
    expect(queries[0].parameters).toEqual(["run-neon", "extracting"]);
  });

  it("skips a late Neon step when the active tombstone row is unavailable", async () => {
    const queries: Array<{ sql: string; parameters: unknown[] }> = [];
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        queries.push({ sql, parameters });
        return [];
      },
    };
    const repository = createNeonRunRepository({
      databaseUrl: undefined,
      driver,
    });

    await repository.appendStep("run-neon", {
      kind: "stage",
      stage: "extracting",
      timestamp: createdAt,
      durationMs: 20,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(
      /SELECT id FROM runs\s+WHERE id = \$1 AND details_deleted = false FOR UPDATE/,
    );
    expect(queries[0].sql).toMatch(
      /INSERT INTO run_steps \(run_id, step_json\)[\s\S]+SELECT id, \$2::jsonb FROM active_run/,
    );
  });

  it("skips late Neon results when the active tombstone row is unavailable", async () => {
    const queries: Array<{ sql: string; parameters: unknown[] }> = [];
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        queries.push({ sql, parameters });
        return [];
      },
    };
    const repository = createNeonRunRepository({
      databaseUrl: undefined,
      driver,
    });

    await repository.saveResults("run-neon", {
      fields,
      outcome: "clear",
      usage: { inputTokens: 100, outputTokens: 25 },
      estimatedCostUsd: 0.000075,
      retryCount: 0,
      latencyMs: 420,
      stepDurations: { extracting: 220 },
      completedAt: "2026-08-27T00:00:02.000Z",
    });

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(
      /SELECT id FROM runs\s+WHERE id = \$1 AND details_deleted = false FOR UPDATE/,
    );
    expect(queries[0].sql).toMatch(
      /INSERT INTO run_results \(run_id, result_json\)[\s\S]+SELECT id, \$2::jsonb FROM active_run/,
    );
    expect(queries[0].sql).toMatch(
      /UPDATE runs SET[\s\S]+FROM saved[\s\S]+WHERE runs.id = saved.run_id/,
    );
  });

  it("skips a late Neon failure when the active tombstone row is unavailable", async () => {
    const queries: Array<{ sql: string; parameters: unknown[] }> = [];
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        queries.push({ sql, parameters });
        return [];
      },
    };
    const repository = createNeonRunRepository({
      databaseUrl: undefined,
      driver,
    });

    await repository.markFailed("run-neon", {
      timestamp: "2026-08-27T00:00:02.000Z",
      safeCode: "provider_unavailable",
      failedStage: "failed",
      retryCount: 1,
      latencyMs: 400,
      stepDurations: { extracting: 375 },
    });

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(
      /SELECT id FROM runs\s+WHERE id = \$1 AND details_deleted = false FOR UPDATE/,
    );
    expect(queries[0].sql).toMatch(
      /INSERT INTO run_steps \(run_id, step_json\)[\s\S]+SELECT id, \$2::jsonb FROM active_run/,
    );
    expect(queries[0].sql).toMatch(
      /UPDATE runs SET[\s\S]+FROM saved[\s\S]+WHERE runs.id = saved.run_id/,
    );
  });

  it("returns a bounded in-memory summary window without trace details", async () => {
    const repository = new InMemoryRunRepository();
    for (let index = 0; index < 5; index += 1) {
      const record = runRecord(`run-${index}`);
      record.createdAt = new Date(Date.parse(createdAt) + index * 1000).toISOString();
      await repository.createRun(record);
    }

    const runs = await repository.listPublicRuns(
      new Date("2026-08-27T01:00:00.000Z"),
      { limit: 2, offset: 1, includeDetails: false },
    );

    expect(runs.map((run) => run.id)).toEqual(["run-3", "run-2"]);
    expect(runs.every((run) => run.details === undefined)).toBe(true);
  });

  it("uses one bounded Neon summary query without trace N+1 reads", async () => {
    const queryLog: Array<{ sql: string; parameters: unknown[] }> = [];
    const baseRow = {
      provider: "openai",
      model: "gpt-5-mini",
      prompt_version: "recorded-fixture-2026-08-27.v1",
      execution_mode: "recorded",
      source_type: "synthetic",
      file_metadata: {
        filename: "invoice.pdf",
        mediaType: "application/pdf",
        sizeBytes: 100,
        pageCount: 1,
      },
      requested_fields: [],
      status: "completed",
      outcome: "clear",
      usage: { inputTokens: 0, outputTokens: 0 },
      estimated_cost_usd: 0,
      consent: false,
      created_at: createdAt,
      expires_at: expiresAt,
      deleted_at: null,
      retry_count: 0,
      latency_ms: 10,
      step_durations: {},
      details_deleted: false,
    };
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        queryLog.push({ sql, parameters });
        if (sql.includes("FROM runs ORDER BY")) {
          return [
            { ...baseRow, id: "run-neon-2" },
            { ...baseRow, id: "run-neon-1" },
          ];
        }
        return [];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });

    const runs = await repository.listPublicRuns(
      new Date("2026-08-27T01:00:00.000Z"),
      { limit: 2, offset: 4, includeDetails: false },
    );
    const summaryQueries = queryLog.filter((entry) =>
      entry.sql.includes("FROM runs ORDER BY"),
    );

    expect(runs.map((run) => run.id)).toEqual(["run-neon-2", "run-neon-1"]);
    expect(summaryQueries).toHaveLength(1);
    expect(summaryQueries[0].sql).toContain("LIMIT $1 OFFSET $2");
    expect(summaryQueries[0].sql).not.toContain("SELECT *");
    expect(summaryQueries[0].sql).not.toContain("deletion_token_hash");
    expect(summaryQueries[0].sql).not.toContain("document_key");
    expect(summaryQueries[0].parameters).toEqual([2, 4]);
    expect(queryLog.some((entry) => entry.sql.includes("FROM run_steps"))).toBe(false);
    expect(queryLog.some((entry) => entry.sql.includes("FROM run_results"))).toBe(false);
  });

  it("counts only expired detailed records as cleanup backlog", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun(runRecord());

    expect(await repository.countCleanupBacklog(new Date(expiresAt))).toBe(1);
    await repository.purgeExpiredData(new Date(expiresAt));
    expect(await repository.countCleanupBacklog(new Date(expiresAt))).toBe(0);
  });

  it("computes Neon anonymous totals in one server-side aggregate row", async () => {
    let aggregateSql = "";
    const driver: NeonDriver = {
      async query(sql) {
        if (sql.includes("COUNT(*)")) {
          aggregateSql = sql;
          return [
            {
              total_runs: 5,
              completed_runs: 4,
              failed_runs: 1,
              input_tokens: 100,
              output_tokens: 20,
              estimated_cost_usd: 0.5,
              openai_runs: 3,
              anthropic_runs: 2,
              clear_runs: 1,
              needs_review_runs: 1,
              incomplete_runs: 1,
              evidence_consistent_runs: 0,
              conflict_runs: 1,
              not_found_runs: 0,
            },
          ];
        }
        return [];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });

    await expect(repository.aggregateAnonymousUsage()).resolves.toMatchObject({
      totalRuns: 5,
      completedRuns: 4,
      failedRuns: 1,
      providerCounts: { openai: 3, anthropic: 2 },
      outcomeCounts: { clear: 1, needs_review: 1, incomplete: 1, conflict: 1 },
    });
    expect(aggregateSql).toContain("COUNT(*) FILTER");
    expect(aggregateSql).toContain("provider_dispatched");
    expect(aggregateSql).not.toContain("SELECT provider, outcome");
  });
});

describe("Neon migration boundary", () => {
  it("does not run schema DDL during ordinary repository requests", async () => {
    const statements: string[] = [];
    const driver: NeonDriver = {
      async query(sql) {
        statements.push(sql.trim());
        return [];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });

    await repository.createRun(runRecord("run-migrated"));

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^INSERT INTO runs/);
    expect(statements[0]).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s/i);
  });

  it("persists a logical tombstone before retrying failed Blob cleanup", async () => {
    const sequence: string[] = [];
    let cleanupPending = false;
    const documentKey = "runs/run-neon/document";
    const driver: NeonDriver = {
      async query(sql) {
        if (sql.includes("INSERT INTO document_cleanup_jobs")) {
          sequence.push("tombstone");
          cleanupPending = true;
          return [{ id: "run-neon", cleanup_document_key: documentKey }];
        }
        if (sql.includes("AS backlog_count")) {
          return [{ backlog_count: cleanupPending ? 1 : 0 }];
        }
        if (sql.includes("DELETE FROM document_cleanup_jobs")) {
          cleanupPending = false;
          return [];
        }
        if (sql.includes("FROM document_cleanup_jobs")) {
          return cleanupPending
            ? [{ run_id: "run-neon", document_key: documentKey }]
            : [];
        }
        if (sql.includes("expires_at <=")) return [];
        return [];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });

    await expect(
      repository.deleteDetailedData(
        "run-neon",
        "2026-08-27T01:00:00.000Z",
        async () => {
          sequence.push("blob");
          throw new Error("blob_temporarily_unavailable");
        },
      ),
    ).resolves.toBe(true);
    expect(sequence).toEqual(["tombstone", "blob"]);
    expect(
      await repository.countCleanupBacklog(new Date("2026-08-27T01:00:00.000Z")),
    ).toBe(1);

    const retry = await repository.purgeExpiredData(
      new Date("2026-08-27T02:00:00.000Z"),
      async () => undefined,
    );
    expect(retry).toEqual({
      purgedRunIds: [],
      documentKeys: [documentKey],
      failedRunIds: [],
    });
    expect(
      await repository.countCleanupBacklog(new Date("2026-08-27T02:00:00.000Z")),
    ).toBe(0);
  });
});
