import { describe, expect, it, vi } from "vitest";
import { syntheticFixtures } from "@/domain/fixtures";
import { handleStageActionPost } from "@/server/http/stage-action-handler";
import type { ActionProposal, RunStatus } from "@/domain/types";
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

describe("POST /api/runs/[id]/stage-action", () => {
  it("preserves rate limiting before capability lookup or mutation", async () => {
    const container = createTestContainer({ clock: () => now });
    await seedRun({ container, action: syntheticFixtures[1].action });
    const getCapabilityHash = vi.spyOn(container.repository, "getDeletionTokenHash");
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
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("stage_action_not_authorized");
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
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("stage_action_not_authorized");
    expect(stageAction).not.toHaveBeenCalled();
  });

  it("stages a permitted internal action idempotently", async () => {
    const container = createTestContainer({ clock: () => now });
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
      staging: { status: string; action: ActionProposal };
    }>(first);
    const duplicateBody = await readJson<{
      staging: { status: string; action: ActionProposal };
    }>(duplicate);

    expect(first.status).toBe(200);
    expect(firstBody.staging.status).toBe("staged");
    expect(firstBody.staging.action.stagedAt).toBe(now.toISOString());
    expect(duplicate.status).toBe(200);
    expect(duplicateBody).toEqual({
      staging: {
        status: "already_staged",
        action: firstBody.staging.action,
      },
    });
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
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("run_expired");
  });

  it("revokes the staging capability when a run is deleted", async () => {
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
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("action_unavailable");
  });
});
