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
    documentFamily: "supplier_invoice" as const,
    fixtureId: "invoice-clean-match",
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
    completedAt: null,
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
  it("creates one event per non-null or null recipient identity and returns clones", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun({ ...runRecord(), status: "completed" });
    const now = new Date("2026-08-27T00:05:00.000Z");

    const first = await repository.createWorkflowEvent({
      runId: "run-1",
      action: "prepare_email",
      recipientRole: "Buyer",
      status: "prepared",
      now,
      eventId: "event_1",
    });
    const duplicate = await repository.createWorkflowEvent({
      runId: "run-1",
      action: "prepare_email",
      recipientRole: "Buyer",
      status: "prepared",
      now: new Date("2026-08-27T00:06:00.000Z"),
      eventId: "event_2",
    });
    const firstWithoutRole = await repository.createWorkflowEvent({
      runId: "run-1",
      action: "download_summary",
      recipientRole: null,
      status: "simulated",
      now,
      eventId: "event_3",
    });
    const duplicateWithoutRole = await repository.createWorkflowEvent({
      runId: "run-1",
      action: "download_summary",
      recipientRole: null,
      status: "simulated",
      now: new Date("2026-08-27T00:06:00.000Z"),
      eventId: "event_4",
    });

    expect(first).toMatchObject({ status: "created", event: { id: "event_1" } });
    expect(duplicate).toMatchObject({
      status: "already_created",
      event: { id: "event_1" },
    });
    expect(firstWithoutRole).toMatchObject({
      status: "created",
      event: { id: "event_3", recipientRole: null },
    });
    expect(duplicateWithoutRole).toMatchObject({
      status: "already_created",
      event: { id: "event_3", recipientRole: null },
    });

    if (first.status === "created") first.event.recipientRole = "mutated";
    if (duplicate.status === "already_created") duplicate.event.id = "mutated";
    const stored = await repository.readPublicRun(
      "run-1",
      new Date("2026-08-27T00:07:00.000Z"),
    );
    expect(stored?.details?.workflowEvents).toEqual([
      {
        id: "event_1",
        runId: "run-1",
        action: "prepare_email",
        recipientRole: "Buyer",
        status: "prepared",
        createdAt: now.toISOString(),
      },
      {
        id: "event_3",
        runId: "run-1",
        action: "download_summary",
        recipientRole: null,
        status: "simulated",
        createdAt: now.toISOString(),
      },
    ]);
  });

  it("resolves an existing identity before checking a globally colliding event ID", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun({ ...runRecord("run-a"), status: "completed" });
    await repository.createRun({ ...runRecord("run-b"), status: "completed" });
    const now = new Date("2026-08-27T00:05:00.000Z");

    await repository.createWorkflowEvent({
      runId: "run-a",
      action: "prepare_email",
      recipientRole: "Buyer",
      status: "prepared",
      now,
      eventId: "event_shared",
    });
    await repository.createWorkflowEvent({
      runId: "run-b",
      action: "prepare_email",
      recipientRole: "Buyer",
      status: "prepared",
      now,
      eventId: "event_b",
    });

    await expect(
      repository.createWorkflowEvent({
        runId: "run-b",
        action: "prepare_email",
        recipientRole: "Buyer",
        status: "prepared",
        now,
        eventId: "event_shared",
      }),
    ).resolves.toMatchObject({
      status: "already_created",
      event: { id: "event_b" },
    });
    await expect(
      repository.createWorkflowEvent({
        runId: "run-b",
        action: "assign_review",
        recipientRole: "Buyer",
        status: "simulated",
        now,
        eventId: "event_shared",
      }),
    ).resolves.toEqual({ status: "id_collision" });
  });

  it("applies deleted then expired then failed policy then nonterminal lifecycle decisions", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun({ ...runRecord("failed-active"), status: "failed" });
    await repository.createRun({ ...runRecord("failed-expired"), status: "failed" });
    await repository.createRun({
      ...runRecord("explicit-expired"),
      status: "expired",
      expiresAt: "2026-08-28T23:55:00.000Z",
    });
    await repository.createRun({ ...runRecord("extracting"), status: "extracting" });
    await repository.createRun({ ...runRecord("deleted"), status: "completed" });
    await repository.deleteDetailedData("deleted", "2026-08-27T00:10:00.000Z");
    const activeNow = new Date("2026-08-27T00:05:00.000Z");
    const expiredNow = new Date("2026-08-27T23:55:00.000Z");

    for (const action of ["retry_processing", "download_summary"] as const) {
      await expect(
        repository.createWorkflowEvent({
          runId: "failed-active",
          action,
          recipientRole: null,
          status: "simulated",
          now: activeNow,
          eventId: `event_${action}`,
        }),
      ).resolves.toMatchObject({ status: "created", event: { action } });
    }
    await expect(
      repository.createWorkflowEvent({
        runId: "failed-active",
        action: "approve_and_stage",
        recipientRole: null,
        status: "staged",
        now: activeNow,
        eventId: "event_blocked",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      repository.createWorkflowEvent({
        runId: "failed-expired",
        action: "retry_processing",
        recipientRole: null,
        status: "simulated",
        now: expiredNow,
        eventId: "event_expired_by_time",
      }),
    ).resolves.toEqual({ status: "expired" });
    await expect(
      repository.createWorkflowEvent({
        runId: "explicit-expired",
        action: "retry_processing",
        recipientRole: null,
        status: "simulated",
        now: activeNow,
        eventId: "event_explicit_expired",
      }),
    ).resolves.toEqual({ status: "expired" });
    await expect(
      repository.createWorkflowEvent({
        runId: "extracting",
        action: "retry_processing",
        recipientRole: null,
        status: "simulated",
        now: activeNow,
        eventId: "event_nonterminal",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      repository.createWorkflowEvent({
        runId: "deleted",
        action: "retry_processing",
        recipientRole: null,
        status: "simulated",
        now: expiredNow,
        eventId: "event_deleted",
      }),
    ).resolves.toEqual({ status: "deleted" });
    await expect(
      repository.createWorkflowEvent({
        runId: "missing",
        action: "retry_processing",
        recipientRole: null,
        status: "simulated",
        now: activeNow,
        eventId: "event_missing",
      }),
    ).resolves.toEqual({ status: "not_found" });
  });

  it("hides details when an in-memory run has an explicit inactive status", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun({ ...runRecord("explicit-expired-detail"), status: "completed" });
    await repository.createRun({ ...runRecord("explicit-deleted-detail"), status: "completed" });
    const now = new Date("2026-08-27T00:05:00.000Z");
    for (const runId of ["explicit-expired-detail", "explicit-deleted-detail"]) {
      await repository.createWorkflowEvent({
        runId,
        action: "approve_and_stage",
        recipientRole: null,
        status: "staged",
        now,
        eventId: `event_${runId}`,
      });
    }
    await repository.setStatus("explicit-expired-detail", "expired");
    await repository.setStatus("explicit-deleted-detail", "deleted");

    await expect(
      repository.readPublicRun("explicit-expired-detail", now),
    ).resolves.toMatchObject({ status: "expired" });
    await expect(
      repository.readPublicRun("explicit-expired-detail", now),
    ).resolves.not.toHaveProperty("details");
    await expect(
      repository.readPublicRun("explicit-deleted-detail", now),
    ).resolves.toMatchObject({ status: "deleted" });
    await expect(
      repository.readPublicRun("explicit-deleted-detail", now),
    ).resolves.not.toHaveProperty("details");
  });

  it("orders events by created time then ID", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun({ ...runRecord(), status: "completed" });
    const eventInputs = [
      {
        action: "mark_for_later_review" as const,
        eventId: "event_z",
        now: new Date("2026-08-27T00:06:00.000Z"),
      },
      {
        action: "approve_and_stage" as const,
        eventId: "event_early",
        now: new Date("2026-08-27T00:05:00.000Z"),
      },
      {
        action: "download_summary" as const,
        eventId: "event_a",
        now: new Date("2026-08-27T00:06:00.000Z"),
      },
    ];
    for (const event of eventInputs) {
      await repository.createWorkflowEvent({
        runId: "run-1",
        action: event.action,
        recipientRole: null,
        status: event.action === "approve_and_stage" ? "staged" : "simulated",
        now: event.now,
        eventId: event.eventId,
      });
    }

    const run = await repository.readPublicRun(
      "run-1",
      new Date("2026-08-27T00:07:00.000Z"),
    );
    expect(run?.details?.workflowEvents.map((event) => event.id)).toEqual([
      "event_early",
      "event_a",
      "event_z",
    ]);
  });

  it("clears event identities during early deletion and expiry purge so IDs can be reused", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun({ ...runRecord("delete-source"), status: "completed" });
    await repository.createRun({ ...runRecord("delete-target"), status: "completed" });
    await repository.createRun({ ...runRecord("expiry-source"), status: "completed" });
    await repository.createRun({
      ...runRecord("expiry-target"),
      status: "completed",
      expiresAt: "2026-08-29T23:55:00.000Z",
    });
    const now = new Date("2026-08-27T00:05:00.000Z");

    await repository.createWorkflowEvent({
      runId: "delete-source",
      action: "approve_and_stage",
      recipientRole: null,
      status: "staged",
      now,
      eventId: "event_reuse_delete",
    });
    await repository.deleteDetailedData(
      "delete-source",
      "2026-08-27T00:06:00.000Z",
    );
    await expect(
      repository.createWorkflowEvent({
        runId: "delete-target",
        action: "approve_and_stage",
        recipientRole: null,
        status: "staged",
        now,
        eventId: "event_reuse_delete",
      }),
    ).resolves.toMatchObject({ status: "created" });
    await expect(
      repository.readPublicRun("delete-source", now),
    ).resolves.not.toHaveProperty("details");

    await repository.createWorkflowEvent({
      runId: "expiry-source",
      action: "approve_and_stage",
      recipientRole: null,
      status: "staged",
      now,
      eventId: "event_reuse_expiry",
    });
    await expect(
      repository.readPublicRun("expiry-source", new Date(expiresAt)),
    ).resolves.not.toHaveProperty("details");
    await repository.purgeExpiredData(new Date(expiresAt));
    await expect(
      repository.createWorkflowEvent({
        runId: "expiry-target",
        action: "approve_and_stage",
        recipientRole: null,
        status: "staged",
        now: new Date("2026-08-28T00:05:00.000Z"),
        eventId: "event_reuse_expiry",
      }),
    ).resolves.toMatchObject({ status: "created" });
  });

  it("persists synthetic fixture identity while custom and legacy rows retain null identity", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun(runRecord("synthetic-run"));
    await repository.createRun({
      ...runRecord("custom-run"),
      sourceType: "custom",
      documentFamily: null,
      fixtureId: null,
    });

    await expect(
      repository.readPublicRun("synthetic-run", new Date("2026-08-27T01:00:00.000Z")),
    ).resolves.toMatchObject({
      documentFamily: "supplier_invoice",
      fixtureId: "invoice-clean-match",
    });
    await expect(
      repository.readPublicRun("custom-run", new Date("2026-08-27T01:00:00.000Z")),
    ).resolves.toMatchObject({ documentFamily: null, fixtureId: null });

    const legacyDriver: NeonDriver = {
      async query(sql) {
        if (sql.includes("SELECT * FROM runs WHERE id")) {
          return [{
            id: "legacy-run",
            provider: "openai",
            model: "gpt-5-mini",
            prompt_version: "legacy.v1",
            execution_mode: "recorded",
            provider_dispatched: false,
            source_type: "custom",
            file_metadata: { filename: "invoice.pdf", mediaType: "application/pdf", sizeBytes: 100, pageCount: 1 },
            requested_fields: [],
            status: "completed",
            outcome: null,
            usage: { inputTokens: 0, outputTokens: 0 },
            estimated_cost_usd: 0,
            consent: true,
            created_at: createdAt,
            expires_at: expiresAt,
            deleted_at: null,
            retry_count: 0,
            latency_ms: null,
            step_durations: {},
            details_deleted: false,
          }];
        }
        if (sql.includes("SELECT step_json") || sql.includes("SELECT result_json")) return [];
        return [];
      },
    };
    const legacyRepository = createNeonRunRepository({ databaseUrl: undefined, driver: legacyDriver });
    await expect(
      legacyRepository.readPublicRun("legacy-run", new Date("2026-08-27T01:00:00.000Z")),
    ).resolves.toMatchObject({ documentFamily: null, fixtureId: null });
  });

  it("inserts fixture identity into Neon storage", async () => {
    const statements: Array<{ sql: string; parameters: unknown[] }> = [];
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        statements.push({ sql, parameters });
        return [];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });

    await repository.createRun(runRecord("neon-fixture-run"));

    expect(statements[0]?.sql).toContain("document_family, fixture_id");
    expect(statements[0]?.parameters).toContain("supplier_invoice");
    expect(statements[0]?.parameters).toContain("invoice-clean-match");
    expect(statements[0]?.sql).toMatch(/fixture_id, completed_at/);
    expect(statements[0]?.sql).toMatch(/\$23, NULL\s+\)/);
  });

  it("forces an initial null completion time until results are durably saved", async () => {
    const repository = new InMemoryRunRepository();
    await repository.createRun({
      ...runRecord("initial-completion"),
      completedAt: "2026-08-27T00:00:00.001Z",
    });

    await expect(
      repository.readPublicRun(
        "initial-completion",
        new Date("2026-08-27T00:01:00.000Z"),
      ),
    ).resolves.toMatchObject({ completedAt: null });
  });

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
      workflowEvents: [],
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
      workflowEvents: [],
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
      workflowEvents: [],
    });
    await expect(repository.listPublicRuns(new Date("2026-08-27T01:00:00.000Z"))).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        details: expect.objectContaining({ result: null }),
      }),
    ]);
  });

  it("uses one atomic Neon statement and reports the event origin explicitly", async () => {
    const queryLog: Array<{ sql: string; parameters: unknown[] }> = [];
    const responses = [
      {
        decision: "available",
        event_created: true,
        id: "event_neon_1",
        run_id: "run-neon",
        action: "prepare_email",
        recipient_role: "Buyer",
        status: "prepared",
        created_at: "2026-08-27T00:05:00.000Z",
      },
      {
        decision: "available",
        event_created: false,
        id: "event_neon_1",
        run_id: "run-neon",
        action: "prepare_email",
        recipient_role: "Buyer",
        status: "prepared",
        created_at: "2026-08-27T00:05:00.000Z",
      },
    ];
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        queryLog.push({ sql, parameters });
        return [responses.shift()!];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });
    const now = new Date("2026-08-27T00:05:00.000Z");

    await expect(
      repository.createWorkflowEvent({
        runId: "run-neon",
        action: "prepare_email",
        recipientRole: "Buyer",
        status: "prepared",
        now,
        eventId: "event_neon_1",
      }),
    ).resolves.toMatchObject({ status: "created", event: { id: "event_neon_1" } });
    await expect(
      repository.createWorkflowEvent({
        runId: "run-neon",
        action: "prepare_email",
        recipientRole: "Buyer",
        status: "prepared",
        now: new Date("2026-08-27T00:06:00.000Z"),
        eventId: "event_neon_2",
      }),
    ).resolves.toMatchObject({
      status: "already_created",
      event: { id: "event_neon_1" },
    });

    expect(queryLog).toHaveLength(2);
    for (const entry of queryLog) {
      expect(entry.sql).toMatch(
        /SELECT id, status, expires_at, details_deleted\s+FROM runs WHERE id = \$1 FOR UPDATE/,
      );
      expect(entry.sql).toMatch(/ON CONFLICT DO NOTHING/);
      expect(entry.sql).toMatch(/true AS event_created/);
      expect(entry.sql).toMatch(/false AS event_created/);
      expect(entry.sql).toMatch(
        /run_id = classified\.id AND action = \$4[\s\S]+COALESCE\(recipient_role, ''\) = COALESCE\(\$5, ''\)/,
      );
      expect(entry.sql).toMatch(
        /WHEN details_deleted OR status = 'deleted' THEN 'deleted'[\s\S]+WHEN status = 'expired' OR expires_at <= \$2::timestamptz THEN 'expired'[\s\S]+WHEN status = 'failed' AND \$4 IN \('retry_processing', 'download_summary'\) THEN 'available'[\s\S]+WHEN status <> 'completed' THEN 'unavailable'/,
      );
    }
    expect(queryLog[0]?.parameters).toEqual([
      "run-neon",
      now.toISOString(),
      "event_neon_1",
      "prepare_email",
      "Buyer",
      "prepared",
    ]);
  });

  it("returns a Neon collision when an available row has no matching identity", async () => {
    const rows = [
      {
        decision: "available",
        event_created: false,
        id: "event_other",
        run_id: "other-run",
        action: "assign_review",
        recipient_role: "Buyer",
        status: "simulated",
        created_at: "2026-08-27T00:05:00.000Z",
      },
      { decision: "available", event_created: null },
    ];
    const driver: NeonDriver = {
      async query() {
        return [rows.shift()!];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });
    const input = {
      runId: "run-neon",
      action: "prepare_email" as const,
      recipientRole: "Buyer",
      status: "prepared" as const,
      now: new Date("2026-08-27T00:05:00.000Z"),
      eventId: "event_neon_1",
    };

    await expect(repository.createWorkflowEvent(input)).resolves.toEqual({
      status: "id_collision",
    });
    await expect(
      repository.createWorkflowEvent({ ...input, eventId: "event_neon_2" }),
    ).resolves.toEqual({ status: "id_collision" });
  });

  it("queries ordered workflow columns only for active detailed Neon reads", async () => {
    const queryLog: string[] = [];
    const row = {
      id: "run-neon",
      provider: "openai",
      model: "gpt-5-mini",
      prompt_version: "document-extraction-2026-08-27.v1",
      execution_mode: "recorded",
      provider_dispatched: false,
      source_type: "synthetic",
      document_family: "supplier_invoice",
      fixture_id: "invoice-clean-match",
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
      async query(sql) {
        queryLog.push(sql);
        if (sql.includes("SELECT * FROM runs WHERE id")) return [row];
        if (sql.includes("FROM runs ORDER BY")) return [row];
        if (sql.includes("SELECT step_json")) return [];
        if (sql.includes("SELECT result_json")) return [];
        if (sql.includes("FROM workflow_events")) {
          return [
            {
              id: "event_z",
              run_id: "run-neon",
              action: "download_summary",
              recipient_role: null,
              status: "simulated",
              created_at: "2026-08-27T00:06:00.000Z",
            },
            {
              id: "event_a",
              run_id: "run-neon",
              action: "approve_and_stage",
              recipient_role: null,
              status: "staged",
              created_at: "2026-08-27T00:05:00.000Z",
            },
          ];
        }
        return [];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });

    const detailed = await repository.readPublicRun(
      "run-neon",
      new Date("2026-08-27T01:00:00.000Z"),
    );
    expect(detailed?.details?.workflowEvents.map((event) => event.id)).toEqual([
      "event_a",
      "event_z",
    ]);
    const eventQuery = queryLog.find((sql) => sql.includes("FROM workflow_events"));
    expect(eventQuery).toMatch(
      /SELECT id, run_id, action, recipient_role, status, created_at\s+FROM workflow_events WHERE run_id = \$1 ORDER BY created_at, id/,
    );

    queryLog.length = 0;
    await repository.listPublicRuns(new Date("2026-08-27T01:00:00.000Z"), {
      limit: 10,
      offset: 0,
      includeDetails: false,
    });
    expect(queryLog.some((sql) => sql.includes("workflow_events"))).toBe(false);

    queryLog.length = 0;
    const expired = await repository.readPublicRun("run-neon", new Date(expiresAt));
    expect(expired?.status).toBe("expired");
    expect(expired?.details).toBeUndefined();
    expect(queryLog.some((sql) => sql.includes("workflow_events"))).toBe(false);
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

  it("keeps the Neon action timestamp in a separate RFC 3339 text parameter", async () => {
    const stagedAt = "2026-08-27T00:05:00.000Z";
    let stagingSql = "";
    let stagingParameters: unknown[] = [];
    const action = {
      ...structuredClone(syntheticFixtures[1].action),
      stagedAt,
    };
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        stagingSql = sql;
        stagingParameters = parameters;
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

    await repository.stageAction("run-neon", new Date(stagedAt));

    expect(stagingSql).toContain("to_jsonb($4::text)");
    expect(stagingParameters).toEqual([
      "run-neon",
      stagedAt,
      expect.stringContaining('"stage":"action_staged"'),
      stagedAt,
    ]);
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
    expect(queries[0].sql).toMatch(/completed_at = \$9::timestamptz/);
    expect(queries[0].parameters[8]).toBe("2026-08-27T00:00:02.000Z");
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

  it("aggregates only completed confirmed model runs with trustworthy usage", async () => {
    const repository = new InMemoryRunRepository();
    const now = new Date("2026-08-29T12:00:00.000Z");
    const action = structuredClone(syntheticFixtures[0].action);
    const saveCompleted = async (input: {
      id: string;
      provider: "openai" | "anthropic";
      model: string;
      executionMode: "live" | "recorded";
      documentFamily: "supplier_invoice" | "warehouse_goods_receipt" | null;
      usage: { inputTokens: number; outputTokens: number };
      estimatedCostUsd: number;
      completedAt: string;
      expiresAt: string;
      sourceType?: "synthetic" | "custom";
    }) => {
      await repository.createRun({
        ...runRecord(input.id),
        provider: input.provider,
        model: input.model,
        executionMode: input.executionMode,
        documentFamily: input.documentFamily,
        fixtureId: input.documentFamily === null ? null : `${input.id}-fixture`,
        sourceType: input.sourceType ?? "synthetic",
        expiresAt: input.expiresAt,
      });
      if (input.executionMode === "live") {
        await repository.markProviderDispatched(input.id);
      }
      await repository.saveResults(input.id, {
        fields,
        outcome: "clear",
        documentInstruction: action.instructionEvidence,
        action,
        usage: input.usage,
        estimatedCostUsd: input.estimatedCostUsd,
        retryCount: 0,
        latencyMs: 100,
        stepDurations: { extracting: 50 },
        completedAt: input.completedAt,
      });
    };

    await saveCompleted({
      id: "openai-invoice",
      provider: "openai",
      model: "gpt-5.6-luna",
      executionMode: "live",
      documentFamily: "supplier_invoice",
      usage: { inputTokens: 120, outputTokens: 20 },
      estimatedCostUsd: 0.08,
      completedAt: "2026-08-29T08:00:00.000Z",
      expiresAt: "2026-08-29T12:30:00.000Z",
    });
    await saveCompleted({
      id: "anthropic-warehouse",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      executionMode: "live",
      documentFamily: "warehouse_goods_receipt",
      usage: { inputTokens: 180, outputTokens: 40 },
      estimatedCostUsd: 0.12,
      completedAt: "2026-08-10T08:00:00.000Z",
      expiresAt: "2026-08-29T16:00:00.000Z",
    });
    await saveCompleted({
      id: "recorded-zero",
      provider: "openai",
      model: "gpt-5.6-luna",
      executionMode: "recorded",
      documentFamily: "supplier_invoice",
      usage: { inputTokens: 999, outputTokens: 999 },
      estimatedCostUsd: 0,
      completedAt: "2026-08-29T09:00:00.000Z",
      expiresAt: "2026-08-29T22:00:00.000Z",
    });
    await saveCompleted({
      id: "malformed-usage",
      provider: "openai",
      model: "gpt-5.6-luna",
      executionMode: "live",
      documentFamily: "supplier_invoice",
      usage: { inputTokens: Number.NaN, outputTokens: 1 },
      estimatedCostUsd: 0.9,
      completedAt: "2026-08-29T10:00:00.000Z",
      expiresAt: "2026-08-30T13:00:00.000Z",
    });
    await repository.createRun({
      ...runRecord("failed-dispatch"),
      executionMode: "live",
      usage: { inputTokens: 500, outputTokens: 100 },
      estimatedCostUsd: 0.5,
      expiresAt: "2026-08-30T13:00:00.000Z",
    });
    await repository.markProviderDispatched("failed-dispatch");
    await repository.markFailed("failed-dispatch", {
      timestamp: "2026-08-29T11:00:00.000Z",
      safeCode: "provider_unavailable",
      failedStage: "failed",
      retryCount: 1,
      latencyMs: 50,
      stepDurations: { extracting: 50 },
    });

    const expected = {
      completedRunCount: 2,
      totalInputTokens: 300,
      totalOutputTokens: 60,
      providerCounts: { openai: 1, anthropic: 1 },
      totalEstimatedCostUsd: 0.2,
      averageEstimatedCostUsd: 0.1,
      todayEstimatedCostUsd: 0.08,
      monthToDateEstimatedCostUsd: 0.2,
      byModel: [
        {
          provider: "anthropic",
          model: "claude-haiku-4-5",
          runCount: 1,
          totalEstimatedCostUsd: 0.12,
          averageEstimatedCostUsd: 0.12,
        },
        {
          provider: "openai",
          model: "gpt-5.6-luna",
          runCount: 1,
          totalEstimatedCostUsd: 0.08,
          averageEstimatedCostUsd: 0.08,
        },
      ],
      byFamily: [
        {
          documentFamily: "supplier_invoice",
          runCount: 1,
          totalEstimatedCostUsd: 0.08,
          averageEstimatedCostUsd: 0.08,
        },
        {
          documentFamily: "warehouse_goods_receipt",
          runCount: 1,
          totalEstimatedCostUsd: 0.12,
          averageEstimatedCostUsd: 0.12,
        },
      ],
    };
    await expect(repository.aggregateConfirmedModelCosts(now)).resolves.toEqual(
      expected,
    );
    await expect(repository.aggregateActiveDetailLifecycle(now)).resolves.toEqual({
      activeDocuments: 3,
      activePublicUploads: 0,
      expiryBuckets: {
        lessThanOneHour: 1,
        oneToSixHours: 1,
        sixToTwentyFourHours: 1,
      },
    });

    await repository.deleteDetailedData(
      "anthropic-warehouse",
      "2026-08-29T12:01:00.000Z",
    );
    await expect(repository.aggregateConfirmedModelCosts(now)).resolves.toEqual(
      expected,
    );
    await expect(repository.aggregateActiveDetailLifecycle(now)).resolves.toMatchObject({
      activeDocuments: 2,
      expiryBuckets: { oneToSixHours: 0 },
    });
  });

  it("uses inclusive UTC time boundaries and excludes future completions", async () => {
    const repository = new InMemoryRunRepository();
    const now = new Date("2026-08-29T12:00:00.000Z");
    const completionTimes = [
      ["previous-month", "2026-07-31T23:59:59.999Z"],
      ["month-boundary", "2026-08-01T00:00:00.000Z"],
      ["before-today", "2026-08-28T23:59:59.999Z"],
      ["today-boundary", "2026-08-29T00:00:00.000Z"],
      ["at-now", "2026-08-29T12:00:00.000Z"],
      ["future", "2026-08-29T12:00:00.001Z"],
    ] as const;
    for (const [id, completedAt] of completionTimes) {
      await repository.createRun({
        ...runRecord(id),
        executionMode: "live",
        expiresAt: "2026-08-30T12:00:00.000Z",
      });
      await repository.markProviderDispatched(id);
      await repository.saveResults(id, {
        fields,
        outcome: "clear",
        documentInstruction: null,
        action: structuredClone(syntheticFixtures[0].action),
        usage: { inputTokens: 1, outputTokens: 0 },
        estimatedCostUsd: 0.01,
        retryCount: 0,
        latencyMs: 1,
        stepDurations: {},
        completedAt,
      });
    }

    await expect(repository.aggregateConfirmedModelCosts(now)).resolves.toMatchObject({
      completedRunCount: 5,
      totalEstimatedCostUsd: 0.05,
      todayEstimatedCostUsd: 0.02,
      monthToDateEstimatedCostUsd: 0.04,
    });
  });

  it("places exact active-detail expiry boundaries into exclusive buckets", async () => {
    const repository = new InMemoryRunRepository();
    const now = new Date("2026-08-29T12:00:00.000Z");
    const records = [
      ["at-one-hour", "2026-08-29T13:00:00.000Z", "custom"],
      ["at-six-hours", "2026-08-29T18:00:00.000Z", "synthetic"],
      ["at-twenty-four-hours", "2026-08-30T12:00:00.000Z", "synthetic"],
      ["beyond-twenty-four", "2026-08-30T12:00:00.001Z", "synthetic"],
      ["already-expired", "2026-08-29T12:00:00.000Z", "synthetic"],
    ] as const;
    for (const [id, recordExpiresAt, sourceType] of records) {
      await repository.createRun({
        ...runRecord(id),
        sourceType,
        documentFamily: sourceType === "custom" ? null : "supplier_invoice",
        fixtureId: sourceType === "custom" ? null : "invoice-clean-match",
        expiresAt: recordExpiresAt,
      });
    }
    await repository.createRun({
      ...runRecord("explicit-deleted"),
      status: "deleted",
      expiresAt: "2026-08-29T13:00:00.000Z",
    });
    await repository.createRun({
      ...runRecord("explicit-expired"),
      status: "expired",
      expiresAt: "2026-08-29T13:00:00.000Z",
    });
    await repository.createRun({
      ...runRecord("details-deleted"),
      expiresAt: "2026-08-29T13:00:00.000Z",
    });
    await repository.deleteDetailedData(
      "details-deleted",
      "2026-08-29T11:00:00.000Z",
    );

    await expect(repository.aggregateActiveDetailLifecycle(now)).resolves.toEqual({
      activeDocuments: 3,
      activePublicUploads: 1,
      expiryBuckets: {
        lessThanOneHour: 1,
        oneToSixHours: 1,
        sixToTwentyFourHours: 1,
      },
    });
  });

  it("hydrates sorted bounded Neon cost and lifecycle aggregates", async () => {
    const statements: Array<{ sql: string; parameters: unknown[] }> = [];
    const now = new Date("2026-08-29T12:00:00.000Z");
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        statements.push({ sql, parameters });
        if (sql.includes("AS active_documents")) {
          return [
            {
              active_documents: "3",
              active_public_uploads: "1",
              less_than_one_hour: "1",
              one_to_six_hours: "1",
              six_to_twenty_four_hours: "1",
            },
          ];
        }
        if (sql.includes("GROUP BY provider, model")) {
          return [
            {
              provider: "openai",
              model: "gpt-5.6-luna",
              run_count: "1",
              total_estimated_cost_usd: "0.08",
              average_estimated_cost_usd: "0.08",
            },
            {
              provider: "anthropic",
              model: "claude-haiku-4-5",
              run_count: "1",
              total_estimated_cost_usd: "0.12",
              average_estimated_cost_usd: "0.12",
            },
          ];
        }
        if (sql.includes("GROUP BY document_family")) {
          return [
            {
              document_family: "warehouse_goods_receipt",
              run_count: "1",
              total_estimated_cost_usd: "0.12",
              average_estimated_cost_usd: "0.12",
            },
            {
              document_family: "supplier_invoice",
              run_count: "1",
              total_estimated_cost_usd: "0.08",
              average_estimated_cost_usd: "0.08",
            },
          ];
        }
        if (sql.includes("AS completed_run_count")) {
          return [
            {
              completed_run_count: "2",
              input_tokens: "300",
              output_tokens: "60",
              openai_runs: "1",
              anthropic_runs: "1",
              total_estimated_cost_usd: "0.20",
              average_estimated_cost_usd: "0.10",
              today_estimated_cost_usd: "0.08",
              month_to_date_estimated_cost_usd: "0.20",
            },
          ];
        }
        return [];
      },
    };
    const repository = createNeonRunRepository({ databaseUrl: undefined, driver });

    await expect(repository.aggregateConfirmedModelCosts(now)).resolves.toEqual({
      completedRunCount: 2,
      totalInputTokens: 300,
      totalOutputTokens: 60,
      providerCounts: { openai: 1, anthropic: 1 },
      totalEstimatedCostUsd: 0.2,
      averageEstimatedCostUsd: 0.1,
      todayEstimatedCostUsd: 0.08,
      monthToDateEstimatedCostUsd: 0.2,
      byModel: [
        {
          provider: "anthropic",
          model: "claude-haiku-4-5",
          runCount: 1,
          totalEstimatedCostUsd: 0.12,
          averageEstimatedCostUsd: 0.12,
        },
        {
          provider: "openai",
          model: "gpt-5.6-luna",
          runCount: 1,
          totalEstimatedCostUsd: 0.08,
          averageEstimatedCostUsd: 0.08,
        },
      ],
      byFamily: [
        {
          documentFamily: "supplier_invoice",
          runCount: 1,
          totalEstimatedCostUsd: 0.08,
          averageEstimatedCostUsd: 0.08,
        },
        {
          documentFamily: "warehouse_goods_receipt",
          runCount: 1,
          totalEstimatedCostUsd: 0.12,
          averageEstimatedCostUsd: 0.12,
        },
      ],
    });
    await expect(repository.aggregateActiveDetailLifecycle(now)).resolves.toEqual({
      activeDocuments: 3,
      activePublicUploads: 1,
      expiryBuckets: {
        lessThanOneHour: 1,
        oneToSixHours: 1,
        sixToTwentyFourHours: 1,
      },
    });

    const costQueries = statements.filter((entry) =>
      entry.sql.includes("eligible_confirmed_runs"),
    );
    expect(costQueries).toHaveLength(3);
    for (const query of costQueries) {
      expect(query.parameters).toEqual([now.toISOString()]);
      expect(query.sql).toMatch(/provider_dispatched = true/);
      expect(query.sql).toMatch(/was_completed = true/);
      expect(query.sql).toMatch(/completed_at <= \$1::timestamptz/);
      expect(query.sql).toMatch(/input_tokens \+ output_tokens > 0/);
    }
    const lifecycleQuery = statements.find((entry) =>
      entry.sql.includes("AS active_documents"),
    );
    expect(lifecycleQuery?.parameters).toEqual([now.toISOString()]);
    expect(lifecycleQuery?.sql).toMatch(/details_deleted = false/);
    expect(lifecycleQuery?.sql).toMatch(/status NOT IN \('expired', 'deleted'\)/);
    expect(lifecycleQuery?.sql).toMatch(
      /expires_at <= \$1::timestamptz \+ interval '24 hours'/,
    );
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
    let tombstoneSql = "";
    const documentKey = "runs/run-neon/document";
    const driver: NeonDriver = {
      async query(sql) {
        if (sql.includes("INSERT INTO document_cleanup_jobs")) {
          tombstoneSql = sql;
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
    expect(tombstoneSql).toMatch(
      /removed_workflow_events AS \(\s*DELETE FROM workflow_events WHERE run_id = \$1\s*\)/,
    );
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
