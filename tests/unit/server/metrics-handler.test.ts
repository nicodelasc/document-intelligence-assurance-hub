import { describe, expect, it } from "vitest";
import { recordedDocumentRunResults } from "@/domain/fixtures";
import {
  calculateRecordedFixtureBenchmark,
  handleMetricsGet,
} from "@/server/http/metrics-handler";
import {
  createTestContainer,
  readLines,
} from "../../contract/routes/test-support";
import { handleRunsPost } from "@/server/http/runs-handler";
import { handleStageActionPost } from "@/server/http/stage-action-handler";
import { syntheticRequest } from "../../contract/routes/test-support";

describe("recorded benchmark metrics", () => {
  it("counts persisted action readiness and staged dry runs within the active run population", async () => {
    const container = createTestContainer();
    const runIds: string[] = [];

    for (const fixtureId of [
      "warehouse-receiving-sheet",
      "invoice-exception-packet",
      "visitor-access-request",
    ]) {
      const events = await readLines(
        await handleRunsPost(syntheticRequest(fixtureId), container),
      );
      const completed = events.find(
        (event): event is { type: "completed"; runId: string } =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "completed" &&
          typeof (event as { runId?: unknown }).runId === "string",
      );
      if (!completed) throw new Error("Completed run event is required");
      runIds.push(completed.runId);
    }

    await container.repository.stageAction(runIds[0], container.clock());
    await container.repository.stageAction(runIds[1], container.clock());

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const body = (await response.json()) as {
      actions: {
        ready: number;
        needsReview: number;
        blocked: number;
        stagedDryRuns: number;
        population: {
          activeRuns: number;
          actionProposals: number;
          maximumRuns: number;
          detailExpiryHours: number;
        };
      };
    };

    expect(body.actions).toEqual({
      ready: 1,
      needsReview: 1,
      blocked: 1,
      stagedDryRuns: 2,
      population: {
        activeRuns: 3,
        actionProposals: 3,
        maximumRuns: 100,
        detailExpiryHours: 24,
      },
    });
  });

  it("refreshes the staged dry-run count after the staging route persists an action", async () => {
    const container = createTestContainer();
    const events = await readLines(
      await handleRunsPost(
        syntheticRequest("warehouse-receiving-sheet"),
        container,
      ),
    );
    const completed = events.find(
      (
        event,
      ): event is { type: "completed"; runId: string; deletionToken: string } =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "completed" &&
        typeof (event as { runId?: unknown }).runId === "string" &&
        typeof (event as { deletionToken?: unknown }).deletionToken === "string",
    );
    if (!completed) throw new Error("Completed run event is required");

    const before = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as { actions: { stagedDryRuns: number } };
    expect(before.actions.stagedDryRuns).toBe(0);

    const staged = await handleStageActionPost(
      new Request(
        `http://local.test/api/runs/${completed.runId}/stage-action`,
        {
          method: "POST",
          headers: { "x-run-capability": completed.deletionToken },
        },
      ),
      { id: completed.runId },
      container,
    );
    expect(staged.status).toBe(200);

    const after = (await (
      await handleMetricsGet(
        new Request("http://local.test/api/metrics"),
        container,
      )
    ).json()) as { actions: { stagedDryRuns: number } };
    expect(after.actions.stagedDryRuns).toBe(1);
  });

  it("excludes deterministic demo runs from actual provider usage", async () => {
    const container = createTestContainer();
    await (await handleRunsPost(syntheticRequest(), container)).text();

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const body = (await response.json()) as {
      usage: {
        providerSplit: { openai: number; anthropic: number };
        recordedRuns: number;
        liveRuns: number;
      };
    };

    expect(body.usage.providerSplit).toEqual({ openai: 0, anthropic: 0 });
    expect(body.usage.recordedRuns).toBe(1);
    expect(body.usage.liveRuns).toBe(0);
  });

  it("replays every document fixture with its expected action status", async () => {
    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      createTestContainer(),
    );
    const body = (await response.json()) as {
      benchmark: {
        expectedOutcomes: Record<string, number>;
        actionStatuses: Record<string, number>;
      };
    };

    expect(body.benchmark.expectedOutcomes).toEqual({
      needs_review: 2,
      clear: 2,
      incomplete: 2,
    });
    expect(body.benchmark.actionStatuses).toEqual({
      needs_review: 2,
      ready: 2,
      blocked: 2,
    });
  });

  it("lowers extraction and evaluator scores for a corrupted document observation", () => {
    const observations = structuredClone(recordedDocumentRunResults);
    const invoice = observations.find(
      (observation) => observation.fixtureId === "invoice-exception-packet",
    );
    if (!invoice) throw new Error("Invoice exception fixture observation is required");

    invoice.fields[0] = {
      ...invoice.fields[0],
      extractedValue: "Incorrect vendor",
      normalizedValue: "Incorrect vendor",
      evaluatorStatus: "conflict",
      referenceMatch: false,
    };

    const benchmark = calculateRecordedFixtureBenchmark(observations);

    expect(benchmark.exactMatchRate).toBeLessThan(1);
    expect(benchmark.evaluatorAgreement).toBeLessThan(1);
  });
});
