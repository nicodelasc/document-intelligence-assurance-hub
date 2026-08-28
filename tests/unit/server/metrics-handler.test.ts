import { describe, expect, it } from "vitest";
import { handleMetricsGet } from "@/server/http/metrics-handler";
import { createTestContainer } from "../../contract/routes/test-support";

describe("recorded benchmark metrics", () => {
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
});
