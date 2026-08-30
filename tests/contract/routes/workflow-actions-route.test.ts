import { describe, expect, it, vi } from "vitest";
import { syntheticFixtures } from "@/domain/fixtures";
import type {
  DocumentFamily,
  DocumentClassification,
  FieldResult,
  Outcome,
  RunStatus,
  WorkflowActionRequest,
  WorkflowEvent,
} from "@/domain/types";
import type { HttpContainer } from "@/server/http/container";
import { handleMetricsGet } from "@/server/http/metrics-handler";
import { handleWorkflowActionPost } from "@/server/http/workflow-action-handler";
import type { CreateWorkflowEventResult } from "@/server/repositories/run-repository";
import { hashDeletionToken } from "@/server/security/deletion-token";
import { createTestContainer, readJson } from "./test-support";

const now = new Date("2026-08-29T10:00:00.000Z");
const runId = "run-workflow-1";
const runCapability = "private_run_capability_0123456789";

const fields: FieldResult[] = [
  {
    key: "invoice_total",
    label: "Invoice total",
    extractedValue: "1250.00 SGD",
    normalizedValue: "1250.00 SGD",
    evidence: "Invoice total 1250.00 SGD",
    page: 1,
    evaluatorStatus: "pass",
    referenceMatch: true,
  },
];

function idSequence(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `request-fallback-${index}`;
}

async function seedRun(input: {
  container: HttpContainer;
  id?: string;
  status?: RunStatus;
  outcome?: Outcome;
  documentClassification?: DocumentClassification;
  family?: DocumentFamily | null;
  expiresAt?: string;
  resultFields?: FieldResult[];
}) {
  const id = input.id ?? runId;
  const status = input.status ?? "completed";
  const outcome = input.outcome ?? "clear";
  const action =
    syntheticFixtures.find((fixture) => fixture.expectedOutcome === outcome)
      ?.action ?? syntheticFixtures[0].action;
  await input.container.repository.createRun({
    id,
    provider: "openai",
    model: "gpt-5.6-luna",
    promptVersion: "recorded-fixture-2026-08-29.v1",
    executionMode: "recorded",
    providerDispatched: false,
    sourceType: "synthetic",
    documentFamily: input.family ?? "supplier_invoice",
    fixtureId: "invoice-clean-match",
    file: {
      filename: "sample.pdf",
      mediaType: "application/pdf",
      sizeBytes: 100,
      pageCount: 1,
    },
    documentKey: `${id}/document`,
    requestedFields: fields.map(({ key, label }) => ({ key, label })),
    status: "validating",
    outcome: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    estimatedCostUsd: 0,
    consent: false,
    createdAt: "2026-08-29T09:00:00.000Z",
    completedAt: null,
    expiresAt: input.expiresAt ?? "2026-08-30T09:00:00.000Z",
    deletedAt: null,
    deletionTokenHash: hashDeletionToken(runCapability),
    retryCount: 0,
    latencyMs: null,
    stepDurations: {},
  });
  if (status !== "validating") {
    await input.container.repository.saveResults(id, {
      fields: structuredClone(input.resultFields ?? fields),
      outcome,
      documentClassification: input.documentClassification,
      documentInstruction: action.instructionEvidence,
      action: structuredClone(action),
      usage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      retryCount: 0,
      latencyMs: 10,
      stepDurations: {},
      completedAt: "2026-08-29T09:00:01.000Z",
    });
  }
  if (status === "failed") {
    await input.container.repository.markFailed(id, {
      timestamp: "2026-08-29T09:00:02.000Z",
      safeCode: "provider_failed",
      failedStage: "failed",
      retryCount: 1,
      latencyMs: 10,
      stepDurations: {},
    });
  }
}

function workflowRequest(
  input: {
    body?: WorkflowActionRequest | Record<string, unknown> | string;
    capability?: string | null;
    id?: string;
  } = {},
): Request {
  const targetId = input.id ?? runId;
  const capability =
    input.capability === undefined ? runCapability : input.capability;
  const body =
    input.body ??
    ({
      action: "download_summary",
      recipientRole: null,
    } satisfies WorkflowActionRequest);
  return new Request(
    `http://local.test/api/runs/${targetId}/workflow-actions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(capability === null ? {} : { "x-run-capability": capability }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

async function postWorkflow(
  container: HttpContainer,
  input: Parameters<typeof workflowRequest>[0] = {},
): Promise<Response> {
  return handleWorkflowActionPost(
    workflowRequest(input),
    { id: input.id ?? runId },
    container,
  );
}

async function errorCode(response: Response): Promise<string> {
  return (await readJson<{ error: { code: string } }>(response)).error.code;
}

function expectPrivateHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
}

describe("POST /api/runs/[id]/workflow-actions", () => {
  it("denies the rate-limited request before capability lookup, JSON parsing or run read", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container });
    const capabilityLookup = vi.spyOn(
      container.repository,
      "getDeletionTokenHash",
    );
    const runRead = vi.spyOn(container.repository, "readPublicRun");
    const eventCreate = vi.spyOn(container.repository, "createWorkflowEvent");
    container.abuseControl = {
      allowRunSubmission: async () => true,
      allowDocumentRead: async () => true,
      allowPublicRead: async (input) => {
        expect(input.resource).toBe("run_detail");
        expect(input.resourceId).toBe(runId);
        expect(input.now).toEqual(now);
        return false;
      },
    };

    const response = await postWorkflow(container, { body: "{" });

    expect(response.status).toBe(429);
    expectPrivateHeaders(response);
    expect(capabilityLookup).not.toHaveBeenCalled();
    expect(runRead).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["wrong", "wrong-capability"],
    ["oversized", "x".repeat(513)],
  ])(
    "rejects a %s capability before parsing or reading the run",
    async (_label, capability) => {
      const container = createTestContainer({ clock: () => now });
      await seedRun({ container });
      const runRead = vi.spyOn(container.repository, "readPublicRun");
      const response = await postWorkflow(container, {
        capability,
        body: "{",
      });

      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("workflow_not_authorized");
      expectPrivateHeaders(response);
      expect(runRead).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["malformed JSON", "{"],
    [
      "extra properties",
      { action: "download_summary", recipientRole: null, send: true },
    ],
    ["unsupported send action", { action: "send_email", recipientRole: null }],
    ["missing recipient property", { action: "download_summary" }],
  ])("returns a stable request error for %s", async (_label, body) => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container });
    const runRead = vi.spyOn(container.repository, "readPublicRun");

    const response = await postWorkflow(container, { body });

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("workflow_request_invalid");
    expectPrivateHeaders(response);
    expect(runRead).not.toHaveBeenCalled();
  });

  it("creates one explicit event then returns the same event for a duplicate identity", async () => {
    const container = createTestContainer({
      clock: () => now,
      requestIdSource: idSequence(
        "request-created",
        "event-created",
        "request-duplicate",
        "event-duplicate-unused",
      ),
    });
    await seedRun({ container });
    const originalCreate = container.repository.createWorkflowEvent.bind(
      container.repository,
    );
    container.repository.createWorkflowEvent = async (input) => {
      const result = await originalCreate(input);
      return result.status === "created"
        ? ({
            ...result,
            event: { ...result.event, internalSecret: "must-not-leak" },
          } as CreateWorkflowEventResult)
        : result;
    };

    const first = await postWorkflow(container);
    const duplicate = await postWorkflow(container);
    const firstBody = await readJson<{
      workflow: { status: string; event: WorkflowEvent };
      emailPreview?: unknown;
    }>(first);
    const duplicateBody = await readJson<{
      workflow: { status: string; event: WorkflowEvent };
      emailPreview?: unknown;
    }>(duplicate);

    expect(first.status).toBe(200);
    expect(firstBody).toEqual({
      workflow: {
        status: "created",
        event: {
          id: "event-created",
          runId,
          action: "download_summary",
          recipientRole: null,
          status: "simulated",
          createdAt: now.toISOString(),
        },
      },
    });
    expect(duplicate.status).toBe(200);
    expect(duplicateBody).toEqual({
      workflow: {
        status: "already_created",
        event: firstBody.workflow.event,
      },
    });
    expectPrivateHeaders(first);
    expectPrivateHeaders(duplicate);
    const stored = await container.repository.readPublicRun(runId, now);
    expect(stored?.details?.workflowEvents).toEqual([firstBody.workflow.event]);
  });

  it("treats different recipient roles as different event identities", async () => {
    const container = createTestContainer({
      clock: () => now,
      requestIdSource: idSequence(
        "request-buyer",
        "event-buyer",
        "request-supplier",
        "event-supplier",
      ),
    });
    await seedRun({ container, outcome: "needs_review" });

    const buyer = await postWorkflow(container, {
      body: { action: "assign_review", recipientRole: "Buyer" },
    });
    const supplier = await postWorkflow(container, {
      body: {
        action: "assign_review",
        recipientRole: "Supplier Contact",
      },
    });

    expect(buyer.status).toBe(200);
    expect(supplier.status).toBe(200);
    const stored = await container.repository.readPublicRun(runId, now);
    expect(stored?.details?.workflowEvents).toHaveLength(2);
    expect(
      stored?.details?.workflowEvents.map((event) => event.recipientRole),
    ).toEqual(["Buyer", "Supplier Contact"]);
  });

  it("rejects an action outside the run outcome policy", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container, outcome: "needs_review" });

    const response = await postWorkflow(container, {
      body: { action: "approve_and_stage", recipientRole: null },
    });

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("workflow_action_not_allowed");
    expectPrivateHeaders(response);
  });

  it.each(["irrelevant", "uncertain"] as const)(
    "denies disallowed workflow actions for a guarded %s custom document",
    async (documentClassification) => {
      const container = createTestContainer({ clock: () => now });
      await seedRun({
        container,
        outcome: "not_found",
        documentClassification,
      });

      const response = await postWorkflow(container, {
        body: { action: "prepare_email", recipientRole: "Buyer" },
      });

      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe("workflow_action_not_allowed");
    },
  );

  it.each([
    ["unknown role", "prepare_email", "Unknown Role"],
    ["missing role", "prepare_email", null],
    ["role on a role-free action", "download_summary", "Buyer"],
  ])("rejects %s", async (_label, action, recipientRole) => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container });

    const response = await postWorkflow(container, {
      body: { action, recipientRole },
    });

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("workflow_recipient_not_allowed");
    expectPrivateHeaders(response);
  });

  it("allows only recovery actions for a failed run", async () => {
    const container = createTestContainer({
      clock: () => now,
      requestIdSource: idSequence(
        "request-retry",
        "event-retry",
        "request-approve",
      ),
    });
    await seedRun({ container, status: "failed" });

    const retry = await postWorkflow(container, {
      body: { action: "retry_processing", recipientRole: null },
    });
    const approve = await postWorkflow(container, {
      body: { action: "approve_and_stage", recipientRole: null },
    });

    expect(retry.status).toBe(200);
    expect(
      (await readJson<{ workflow: { event: WorkflowEvent } }>(retry)).workflow
        .event,
    ).toMatchObject({ action: "retry_processing", status: "simulated" });
    expect(approve.status).toBe(409);
    expect(await errorCode(approve)).toBe("workflow_action_not_allowed");
  });

  it("returns run_expired after capability verification", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container, expiresAt: now.toISOString() });

    const response = await postWorkflow(container);

    expect(response.status).toBe(410);
    expect(await errorCode(response)).toBe("run_expired");
    expectPrivateHeaders(response);
  });

  it("returns run_deleted when deletion races after capability verification", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container });
    const active = await container.repository.readPublicRun(runId, now);
    if (!active) throw new Error("seeded run is required");
    container.repository.readPublicRun = async () => ({
      ...active,
      status: "deleted",
      deletedAt: now.toISOString(),
      details: undefined,
    });

    const response = await postWorkflow(container);

    expect(response.status).toBe(410);
    expect(await errorCode(response)).toBe("run_deleted");
    expectPrivateHeaders(response);
  });

  it("returns unauthorized for an ordinary deleted run whose capability was revoked", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container });
    await container.repository.deleteDetailedData(runId, now.toISOString());

    const response = await postWorkflow(container);

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("workflow_not_authorized");
    expectPrivateHeaders(response);
  });

  it("maps an event ID collision to a retryable safe conflict without a false event", async () => {
    const container = createTestContainer({
      clock: () => now,
      requestIdSource: idSequence("request-collision", "collision-event"),
    });
    await seedRun({ container });
    await container.repository.createWorkflowEvent({
      runId,
      action: "prepare_email",
      recipientRole: "Buyer",
      status: "prepared",
      now,
      eventId: "collision-event",
    });

    const response = await postWorkflow(container);

    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("workflow_event_conflict");
    expectPrivateHeaders(response);
    const stored = await container.repository.readPublicRun(runId, now);
    expect(stored?.details?.workflowEvents).toHaveLength(1);
    expect(stored?.details?.workflowEvents[0].action).toBe("prepare_email");
  });

  it("prepares email copy without an outbound request or persisted content", async () => {
    const container = createTestContainer({
      clock: () => now,
      requestIdSource: idSequence("request-email", "event-email"),
    });
    await seedRun({ container });
    const outbound = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("outbound calls are forbidden"));

    const response = await postWorkflow(container, {
      body: { action: "prepare_email", recipientRole: "Buyer" },
    });
    const body = await readJson<{
      workflow: { status: string; event: WorkflowEvent };
      emailPreview: {
        recipientRole: string;
        subject: string;
        body: string;
        deliveryStatus: string;
      };
    }>(response);

    expect(response.status).toBe(200);
    expect(body.workflow.status).toBe("created");
    expect(body.emailPreview.deliveryStatus).toBe("prepared_only_not_sent");
    expect(body.emailPreview.subject).toContain("Prepared only - not sent");
    expect(outbound).not.toHaveBeenCalled();
    const stored = await container.repository.readPublicRun(runId, now);
    const persisted = JSON.stringify(stored?.details?.workflowEvents);
    expect(persisted).not.toContain(body.emailPreview.subject);
    expect(persisted).not.toContain(body.emailPreview.body);
    expect(persisted).not.toContain("deliveryStatus");
    outbound.mockRestore();
  });

  it("invalidates a warm metrics snapshot only when a new event is created", async () => {
    let currentTime = now;
    const container = createTestContainer({
      clock: () => currentTime,
      requestIdSource: idSequence(
        "metrics-warm",
        "request-created",
        "event-created",
        "metrics-refill",
        "request-duplicate",
        "event-duplicate-unused",
        "metrics-cached",
      ),
    });
    await seedRun({ container });
    const aggregate = vi.spyOn(container.repository, "aggregateAnonymousUsage");

    await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    expect(aggregate).toHaveBeenCalledTimes(1);

    const created = await postWorkflow(container);
    expect(created.status).toBe(200);
    const refreshed = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as {
      runExplorer: Array<{
        id: string;
        latestWorkflowEvent: { action: string } | null;
      }>;
    };
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(
      refreshed.runExplorer.find((run) => run.id === runId)
        ?.latestWorkflowEvent,
    ).toMatchObject({ action: "download_summary" });

    currentTime = new Date(now.getTime() + 1);
    await container.repository.createWorkflowEvent({
      runId,
      action: "prepare_email",
      recipientRole: "Buyer",
      status: "prepared",
      now: currentTime,
      eventId: "event-not-invalidated",
    });
    const duplicate = await postWorkflow(container);
    expect(
      (await readJson<{ workflow: { status: string } }>(duplicate)).workflow
        .status,
    ).toBe("already_created");
    const cached = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as {
      runExplorer: Array<{
        id: string;
        latestWorkflowEvent: { action: string } | null;
      }>;
    };
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(
      cached.runExplorer.find((run) => run.id === runId)?.latestWorkflowEvent,
    ).toMatchObject({ action: "download_summary" });
  });

  it("rejects email preparation when completed result fields are unavailable", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container });
    const active = await container.repository.readPublicRun(runId, now);
    if (!active) throw new Error("seeded run is required");
    container.repository.readPublicRun = async () => ({
      ...active,
      details: { steps: [], result: null, workflowEvents: [] },
    });

    const response = await postWorkflow(container, {
      body: { action: "prepare_email", recipientRole: "Buyer" },
    });

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("workflow_unavailable");
  });

  it("maps repository failures to a safe unavailable response", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container });
    container.repository.readPublicRun = async () => {
      throw new Error("private database body");
    };

    const response = await postWorkflow(container);
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text).error.code).toBe("workflow_unavailable");
    expect(text).not.toContain("private database body");
    expectPrivateHeaders(response);
  });
});
