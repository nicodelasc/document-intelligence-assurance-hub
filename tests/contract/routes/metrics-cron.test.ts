import { describe, expect, it } from "vitest";
import { handleMetricsGet } from "@/server/http/metrics-handler";
import { handlePurgeExpiredGet } from "@/server/http/cron-handler";
import { handleRunsPost } from "@/server/http/runs-handler";
import { createTestContainer, readLines, syntheticRequest } from "./test-support";

function expectFiniteNumbers(value: unknown): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(expectFiniteNumbers);
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(expectFiniteNumbers);
  }
}

describe("GET /api/metrics", () => {
  it("returns finite zero-denominator metrics and labeled recorded benchmarks", async () => {
    const container = createTestContainer();
    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      summary: {
        totalRuns: 0,
        completionRate: 0,
        reviewRate: 0,
        failureRate: 0,
      },
      usage: {
        liveRuns: 0,
        recordedRuns: 0,
        estimatedCost: true,
      },
      benchmark: {
        source: "recorded_fixture_replay",
        liveRuns: 0,
        falseClearCount: 0,
      },
      resourceScenario: { illustrative: true },
    });
    expectFiniteNumbers(body);
  });

  it("never includes uploader tokens or secret-bearing persistence fields", async () => {
    const container = createTestContainer();
    const postResponse = await handleRunsPost(syntheticRequest(), container);
    const events = await readLines(postResponse);
    const token = (events.at(-1) as { deletionToken: string }).deletionToken;

    const response = await handleMetricsGet(
      new Request("http://local.test/api/metrics"),
      container,
    );
    const text = await response.text();

    expect(text).not.toContain(token);
    expect(text).not.toContain("deletionTokenHash");
    expect(text).not.toContain("documentKey");
    expect(text).not.toContain("systemPrompt");
    expect(text).not.toContain("reasoning");
  });
});

describe("GET /api/cron/purge-expired", () => {
  it("rejects a missing cron configuration before authorization", async () => {
    const container = createTestContainer({ cronSecret: undefined });
    const response = await handlePurgeExpiredGet(
      new Request("http://local.test/api/cron/purge-expired"),
      container,
    );

    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe(
      "cron_not_configured",
    );
  });

  it.each([undefined, "Bearer wrong-secret"])(
    "rejects a missing or wrong full authorization value",
    async (authorization) => {
      const container = createTestContainer();
      const headers = authorization ? { authorization } : undefined;
      const response = await handlePurgeExpiredGet(
        new Request("http://local.test/api/cron/purge-expired", { headers }),
        container,
      );

      expect(response.status).toBe(401);
      expect((await response.json() as { error: { code: string } }).error.code).toBe(
        "cron_not_authorized",
      );
    },
  );

  it("purges expired details idempotently with exact Bearer authorization", async () => {
    let now = new Date("2026-08-27T00:00:00.000Z");
    const container = createTestContainer({ clock: () => now });
    const postResponse = await handleRunsPost(syntheticRequest(), container);
    await postResponse.text();
    now = new Date("2026-08-28T00:00:00.000Z");
    const request = () =>
      new Request("http://local.test/api/cron/purge-expired", {
        headers: { authorization: "Bearer test-cron-secret" },
      });

    const first = await handlePurgeExpiredGet(request(), container);
    const second = await handlePurgeExpiredGet(request(), container);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      purge: { purgedRuns: 1, purgedDocuments: 1, safeFailures: 0 },
    });
    expect(await second.json()).toEqual({
      purge: { purgedRuns: 0, purgedDocuments: 0, safeFailures: 0 },
    });
  });
});
