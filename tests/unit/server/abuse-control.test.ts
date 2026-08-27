import { describe, expect, it } from "vitest";
import {
  createNeonAbuseControl,
  InMemoryAbuseControl,
} from "@/server/security/abuse-control";
import type { NeonDriver } from "@/server/repositories/run-repository";

describe("InMemoryAbuseControl", () => {
  it("bounds pre-parse submissions per anonymous browser and minute", async () => {
    const control = new InMemoryAbuseControl({
      runSubmissionsPerBucketPerMinute: 2,
      globalRunSubmissionsPerMinute: 10,
    });
    const now = new Date("2026-08-27T00:00:00.000Z");

    await expect(control.allowRunSubmission({ bucket: "browser-a", now })).resolves.toBe(true);
    await expect(control.allowRunSubmission({ bucket: "browser-a", now })).resolves.toBe(true);
    await expect(control.allowRunSubmission({ bucket: "browser-a", now })).resolves.toBe(false);
    await expect(control.allowRunSubmission({ bucket: "browser-b", now })).resolves.toBe(true);
  });

  it("bounds active-document reads while leaving ordinary public reads available", async () => {
    const control = new InMemoryAbuseControl({
      documentReadsPerBucketAndRunPerMinute: 2,
      globalDocumentReadsPerMinute: 10,
    });
    const now = new Date("2026-08-27T00:00:00.000Z");
    const input = { bucket: "browser-a", runId: "run-public", now };

    await expect(control.allowDocumentRead(input)).resolves.toBe(true);
    await expect(control.allowDocumentRead(input)).resolves.toBe(true);
    await expect(control.allowDocumentRead(input)).resolves.toBe(false);
    await expect(
      control.allowDocumentRead({ ...input, runId: "run-other" }),
    ).resolves.toBe(true);
  });

  it("keeps a global metrics ceiling effective when browser buckets rotate", async () => {
    const control = new InMemoryAbuseControl({
      metricsReadsPerBucketPerMinute: 2,
      globalMetricsReadsPerMinute: 3,
    });
    const now = new Date("2026-08-27T00:00:00.000Z");

    await expect(
      control.allowPublicRead({ bucket: "browser-a", resource: "metrics", now }),
    ).resolves.toBe(true);
    await expect(
      control.allowPublicRead({ bucket: "browser-a", resource: "metrics", now }),
    ).resolves.toBe(true);
    await expect(
      control.allowPublicRead({ bucket: "browser-b", resource: "metrics", now }),
    ).resolves.toBe(true);
    await expect(
      control.allowPublicRead({ bucket: "browser-c", resource: "metrics", now }),
    ).resolves.toBe(false);
    await expect(
      control.allowPublicRead({ bucket: "browser-a", resource: "run_list", now }),
    ).resolves.toBe(true);
  });
});

describe("NeonAbuseControl", () => {
  it("uses one atomic database decision with a shared global ceiling", async () => {
    const calls: Array<{ sql: string; parameters: unknown[] }> = [];
    const driver: NeonDriver = {
      async query(sql, parameters = []) {
        calls.push({ sql, parameters });
        return [{ allowed: calls.length === 1 }];
      },
    };
    const control = createNeonAbuseControl({
      databaseUrl: undefined,
      driver,
      limits: {
        runListReadsPerBucketPerMinute: 7,
        globalRunListReadsPerMinute: 19,
      },
    });
    const now = new Date("2026-08-27T00:00:42.000Z");

    await expect(
      control.allowPublicRead({ bucket: "browser-a", resource: "run_list", now }),
    ).resolves.toBe(true);
    await expect(
      control.allowPublicRead({ bucket: "browser-b", resource: "run_list", now }),
    ).resolves.toBe(false);

    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("consume_public_resource_limit");
    expect(calls[0].parameters).toEqual([
      "run_list",
      "2026-08-27T00:00:00.000Z",
      "browser-a",
      7,
      19,
    ]);
    expect(calls[1].parameters).toEqual([
      "run_list",
      "2026-08-27T00:00:00.000Z",
      "browser-b",
      7,
      19,
    ]);
  });
});
