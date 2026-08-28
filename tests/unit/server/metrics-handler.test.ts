import { describe, expect, it } from "vitest";
import { recordedDocumentRunResults } from "@/domain/fixtures";
import {
  calculateRecordedFixtureBenchmark,
  handleMetricsGet,
} from "@/server/http/metrics-handler";
import { createTestContainer } from "../../contract/routes/test-support";
import { handleRunsPost } from "@/server/http/runs-handler";
import { syntheticRequest } from "../../contract/routes/test-support";

describe("recorded benchmark metrics", () => {
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
