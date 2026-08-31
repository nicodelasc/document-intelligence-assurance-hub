import { describe, expect, it, vi } from "vitest";
import { syntheticFixtures } from "@/domain/fixtures";
import { handleStageActionPost } from "@/server/http/stage-action-handler";
import type {
  ActionProposal,
  RunStatus,
  WorkflowEvent,
} from "@/domain/types";
import type { HttpContainer } from "@/server/http/container";
import { hashDeletionToken } from "@/server/security/deletion-token";
import { createTestContainer, readJson } from "./test-support";

const now = new Date("2026-08-27T01:00:00.000Z");
const runCapability = "private_run_capability_0123456789";

async function seedRun(input: {
  container: HttpContainer;
  action: ActionProposal;
  status?: RunStatus;
  expiresAt?: string;
}) {
  await input.container.repository.createRun({
    id: "run-action-1",
    provider: "openai",
    model: "gpt-5.6-luna",
    promptVersion: "recorded-fixture-2026-08-27.v1",
    executionMode: "recorded",
    providerDispatched: false,
    sourceType: "synthetic",
    documentFamily: null,
    fixtureId: null,
    file: {
      filename: "sample.pdf",
      mediaType: "application/pdf",
      sizeBytes: 100,
      pageCount: 1,
    },
    documentKey: "runs/run-action-1/document",
    requestedFields: [],
    status: "validating",
    outcome: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    estimatedCostUsd: 0,
    consent: false,
    createdAt: "2026-08-27T00:00:00.000Z",
    completedAt: null,
    expiresAt: input.expiresAt ?? "2026-08-27T23:55:00.000Z",
    deletedAt: null,
    deletionTokenHash: hashDeletionToken(runCapability),
    retryCount: 0,
    latencyMs: null,
    stepDurations: {},
  });
  await input.container.repository.saveResults("run-action-1", {
    fields: [],
    outcome: input.action.status === "blocked" ? "incomplete" : "clear",
    documentInstruction: input.action.instructionEvidence,
    action: structuredClone(input.action),
    usage: { inputTokens: 0, outputTokens: 0 },
    estimatedCostUsd: 0,
    retryCount: 0,
    latencyMs: 10,
    stepDurations: {},
    completedAt: "2026-08-27T00:00:01.000Z",
  });
  if (input.status === "failed") {
    await input.container.repository.markFailed("run-action-1", {
      timestamp: "2026-08-27T00:00:02.000Z",
      safeCode: "provider_failed",
      failedStage: "failed",
      retryCount: 0,
      latencyMs: 10,
      stepDurations: {},
    });
  }
}

function request(capability: string | null = runCapability) {
  return new Request("http://local.test/api/runs/run-action-1/stage-action", {
    method: "POST",
    headers: capability ? { "x-run-capability": capability } : undefined,
  });
}

async function errorDetails(
  response: Response,
): Promise<{ code: string; message: string }> {
  const { code, message } = (
    await readJson<{ error: { code: string; message: string } }>(response)
  ).error;
  return { code, message };
}

describe("POST /api/runs/[id]/stage-action", () => {
  it("preserves rate limiting before capability lookup or mutation", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container, action: syntheticFixtures[1].action });
    const getCapabilityHash = vi.spyOn(
      container.repository,
      "getDeletionTokenHash",
    );
    const stageAction = vi.spyOn(container.repository, "stageAction");
    container.abuseControl = {
      allowRunSubmission: async () => true,
      allowDocumentRead: async () => true,
      allowPublicRead: async () => false,
    };

    const response = await handleStageActionPost(
      request(),
      { id: "run-action-1" },
      container,
    );

    expect(response.status).toBe(429);
    expect(await errorDetails(response)).toEqual({
      code: "stage_action_rate_limited",
      message:
        "Posting handoff preparation was requested too frequently. Retry shortly.",
    });
    expect(getCapabilityHash).not.toHaveBeenCalled();
    expect(stageAction).not.toHaveBeenCalled();
  });

  it("rejects a missing capability without attempting the mutation", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container, action: syntheticFixtures[1].action });
    const stageAction = vi.spyOn(container.repository, "stageAction");

    const response = await handleStageActionPost(
      request(null),
      { id: "run-action-1" },
      container,
    );

    expect(response.status).toBe(401);
    expect(await errorDetails(response)).toEqual({
      code: "stage_action_not_authorized",
      message:
        "This browser does not hold the capability required to prepare the posting handoff.",
    });
    expect(stageAction).not.toHaveBeenCalled();
  });

  it("rejects an invalid capability without attempting the mutation", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container, action: syntheticFixtures[1].action });
    const stageAction = vi.spyOn(container.repository, "stageAction");

    const response = await handleStageActionPost(
      request("invalid_run_capability_0123456789"),
      { id: "run-action-1" },
      container,
    );

    expect(response.status).toBe(401);
    expect(await errorDetails(response)).toEqual({
      code: "stage_action_not_authorized",
      message:
        "This browser does not hold the capability required to prepare the posting handoff.",
    });
    expect(stageAction).not.toHaveBeenCalled();
  });

  it("prepares a permitted posting handoff idempotently", async () => {
    const ids = [
      "request-stage-1",
      "event-stage-1",
      "request-stage-2",
      "event-stage-2-unused",
    ];
    const container = createTestContainer({
      clock: () => now,
      requestIdSource: () => ids.shift() ?? "request-stage-fallback",
    });
    await seedRun({ container, action: syntheticFixtures[1].action });

    const first = await handleStageActionPost(
      request(),
      { id: "run-action-1" },
      container,
    );
    const duplicate = await handleStageActionPost(
      request(),
      { id: "run-action-1" },
      container,
    );
    const firstBody = await readJson<{
      handoff: { status: string; action: ActionProposal };
    }>(first);
    const duplicateBody = await readJson<{
      handoff: { status: string; action: ActionProposal };
    }>(duplicate);

    expect(first.status).toBe(200);
    expect(firstBody.handoff.status).toBe("prepared");
    expect(firstBody.handoff.action.stagedAt).toBeNull();
    expect(duplicate.status).toBe(200);
    expect(duplicateBody).toEqual({
      handoff: {
        status: "already_prepared",
        action: firstBody.handoff.action,
      },
    });
    const stored = await container.repository.readPublicRun(
      "run-action-1",
      now,
    );
    expect(stored?.details?.workflowEvents).toEqual([
      {
        id: "event-stage-1",
        runId: "run-action-1",
        action: "approve_and_stage",
        recipientRole: null,
        status: "prepared",
        createdAt: now.toISOString(),
      },
    ]);
    expect(stored?.details?.result?.action.stagedAt).toBeNull();
    expect(stored?.details?.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "action",
          stage: "action_staged",
        }),
      ]),
    );
  });

  it("returns a truthful compatibility response for an immutable historical staged handoff", async () => {
    const historicalCreatedAt = new Date("2026-08-27T00:30:00.000Z");
    const historicalEvent: WorkflowEvent = {
      id: "event-historical-staged",
      runId: "run-action-1",
      action: "approve_and_stage",
      recipientRole: null,
      status: "staged",
      createdAt: historicalCreatedAt.toISOString(),
    };
    const ids = ["request-historical-replay", "event-historical-unused"];
    const container = createTestContainer({
      clock: () => now,
      requestIdSource: () => ids.shift() ?? "request-stage-fallback",
    });
    await seedRun({ container, action: syntheticFixtures[1].action });
    await container.repository.createWorkflowEvent({
      runId: "run-action-1",
      action: "approve_and_stage",
      recipientRole: null,
      status: "staged",
      now: historicalCreatedAt,
      eventId: historicalEvent.id,
    });
    const before = await container.repository.readPublicRun(
      "run-action-1",
      now,
    );

    const response = await handleStageActionPost(
      request(),
      { id: "run-action-1" },
      container,
    );

    expect(response.status).toBe(200);
    expect(
      await readJson<{
        handoff: { status: string; action: ActionProposal };
      }>(response),
    ).toEqual({
      handoff: {
        status: "historical_staged",
        action: expect.objectContaining({ stagedAt: null }),
      },
    });
    const after = await container.repository.readPublicRun(
      "run-action-1",
      now,
    );
    expect(after).toEqual(before);
    expect(after?.details?.workflowEvents).toEqual([historicalEvent]);
    expect(after?.details?.result?.action.stagedAt).toBeNull();
  });

  it("maps an event ID collision to the safe handoff unavailable response", async () => {
    const ids = ["request-stage-collision", "collision-event"];
    const container = createTestContainer({
      clock: () => now,
      requestIdSource: () => ids.shift() ?? "request-stage-fallback",
    });
    await seedRun({ container, action: syntheticFixtures[1].action });
    await container.repository.createWorkflowEvent({
      runId: "run-action-1",
      action: "prepare_email",
      recipientRole: "Buyer",
      status: "prepared",
      now,
      eventId: "collision-event",
    });

    const response = await handleStageActionPost(
      request(),
      { id: "run-action-1" },
      container,
    );

    expect(response.status).toBe(503);
    expect(await errorDetails(response)).toEqual({
      code: "stage_action_unavailable",
      message: "The posting handoff could not be prepared safely.",
    });
    const stored = await container.repository.readPublicRun(
      "run-action-1",
      now,
    );
    expect(stored?.details?.workflowEvents).toHaveLength(1);
    expect(stored?.details?.result?.action.stagedAt).toBeNull();
  });

  it("rejects a blocked action", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container, action: syntheticFixtures[2].action });

    const response = await handleStageActionPost(
      request(),
      { id: "run-action-1" },
      container,
    );

    expect(response.status).toBe(409);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("action_blocked");
  });

  it("rejects an expired run", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({
      container,
      action: syntheticFixtures[1].action,
      expiresAt: now.toISOString(),
    });

    const response = await handleStageActionPost(
      request(),
      { id: "run-action-1" },
      container,
    );

    expect(response.status).toBe(410);
    expect(await errorDetails(response)).toEqual({
      code: "run_expired",
      message:
        "This run has expired and can no longer prepare a posting handoff.",
    });
  });

  it("revokes the handoff capability when a run is deleted", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container, action: syntheticFixtures[1].action });
    await container.repository.deleteDetailedData(
      "run-action-1",
      now.toISOString(),
    );

    const response = await handleStageActionPost(
      request(),
      { id: "run-action-1" },
      container,
    );

    expect(response.status).toBe(401);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("stage_action_not_authorized");
  });

  it("rejects a failed run", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({
      container,
      action: syntheticFixtures[1].action,
      status: "failed",
    });

    const response = await handleStageActionPost(
      request(),
      { id: "run-action-1" },
      container,
    );

    expect(response.status).toBe(409);
    expect(await errorDetails(response)).toEqual({
      code: "action_unavailable",
      message: "This run does not have a posting handoff that can be prepared.",
    });
  });
});
