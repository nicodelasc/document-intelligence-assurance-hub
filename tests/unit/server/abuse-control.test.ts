import { describe, expect, it } from "vitest";
import { InMemoryAbuseControl } from "@/server/security/abuse-control";

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
});
