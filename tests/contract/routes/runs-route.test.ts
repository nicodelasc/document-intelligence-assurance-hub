import { describe, expect, it } from "vitest";
import { runEventSchema } from "@/domain/run-schema";
import type { RunEvent } from "@/domain/types";
import type { HttpContainer } from "@/server/http/container";
import { handleRunsGet, handleRunsPost } from "@/server/http/runs-handler";
import {
  createTestContainer,
  formRequest,
  makePdf,
  readJson,
  readLines,
  syntheticRequest,
} from "./test-support";

describe("POST /api/runs", () => {
  it("rejects a non-multipart request before a run is created", async () => {
    const container = createTestContainer();
    const response = await handleRunsPost(
      new Request("http://local.test/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      container,
    );

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_content_type",
        message: "Submit the run as multipart form data.",
        requestId: "request-test-1",
      },
    });
    expect((await container.repository.aggregateAnonymousUsage()).totalRuns).toBe(0);
  });

  it("rejects an oversized custom file before storage", async () => {
    const container = createTestContainer();
    const bytes = new Uint8Array(3 * 1024 * 1024 + 1);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "openai"],
      ["executionMode", "recorded"],
      ["requestedField", "Invoice number"],
      ["requestedField", "Invoice total"],
      ["consent", "true"],
      ["document", new Blob([bytes], { type: "image/png" }), "large.png"],
    ]);

    const response = await handleRunsPost(request, container);

    expect(response.status).toBe(413);
    expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe(
      "file_too_large",
    );
    expect((await container.repository.aggregateAnonymousUsage()).totalRuns).toBe(0);
  });

  it("uses the PDF bytes for page count instead of a form field", async () => {
    const container = createTestContainer();
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "anthropic"],
      ["executionMode", "recorded"],
      ["requestedField", "Vendor name"],
      ["requestedField", "Invoice total"],
      ["consent", "true"],
      ["pageCount", "1"],
      ["document", new Blob([makePdf(6)], { type: "application/pdf" }), "six-pages.pdf"],
    ]);

    const response = await handleRunsPost(request, container);

    expect(response.status).toBe(400);
    expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe(
      "pdf_page_limit",
    );
    expect((await container.repository.aggregateAnonymousUsage()).totalRuns).toBe(0);
  });

  it.each([
    { entries: [["requestedField", "Invoice total"]] as Array<[string, string]>, code: "field_count" },
    {
      entries: [
        ["requestedField", "Invoice total"],
        ["requestedField", "Vendor name"],
      ] as Array<[string, string]>,
      code: "consent_required",
    },
  ])("enforces custom field count and consent: $code", async ({ entries, code }) => {
    const container = createTestContainer();
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "openai"],
      ["executionMode", "recorded"],
      ...entries,
      ["document", new Blob([makePdf(1)], { type: "application/pdf" }), "invoice.pdf"],
    ]);

    const response = await handleRunsPost(request, container);

    expect(response.status).toBe(400);
    expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe(code);
  });

  it("selects synthetic files through the fixture allow-list", async () => {
    const container = createTestContainer();
    const response = await handleRunsPost(
      syntheticRequest("../../private-document"),
      container,
    );

    expect(response.status).toBe(400);
    expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe(
      "sample_not_found",
    );
    expect((await container.repository.aggregateAnonymousUsage()).totalRuns).toBe(0);
  });

  it("rejects live mode without silently falling back to recorded mode", async () => {
    const container = createTestContainer();
    const request = formRequest([
      ["sourceType", "synthetic"],
      ["provider", "openai"],
      ["sampleId", "clean-match"],
      ["executionMode", "live"],
    ]);

    const response = await handleRunsPost(request, container);

    expect(response.status).toBe(503);
    expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe(
      "live_disabled",
    );
  });

  it("streams strict events in workflow order with one deletion receipt", async () => {
    const container = createTestContainer();
    const response = await handleRunsPost(syntheticRequest(), container);
    const events = await readLines(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(events.every((event) => runEventSchema.safeParse(event).success)).toBe(true);
    expect(
      events
        .filter((event): event is RunEvent & { type: "stage" } =>
          typeof event === "object" && event !== null && (event as RunEvent).type === "stage",
        )
        .map((event) => event.stage),
    ).toEqual([
      "validating",
      "storing",
      "extracting",
      "verifying",
      "comparing",
      "deciding",
      "publishing",
    ]);
    expect(events.filter((event) => JSON.stringify(event).includes("deletionToken"))).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      outcome: "clear",
      executionMode: "recorded",
    });
  });

  it("closes a started stream with one schema-valid safe failure", async () => {
    const execute: HttpContainer["execute"] = async function* () {
      yield {
        type: "stage",
        stage: "validating",
        timestamp: "2026-08-27T00:00:00.000Z",
      };
      throw new Error("secret storage credential and stack");
    };
    const container = createTestContainer({ execute });

    const response = await handleRunsPost(syntheticRequest(), container);
    const text = await response.text();
    const events = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);

    expect(events).toHaveLength(2);
    expect(events.every((event) => runEventSchema.safeParse(event).success)).toBe(true);
    expect(events.at(-1)).toEqual({
      type: "failed",
      code: "stream_failed",
      message: "The run stream ended safely.",
      timestamp: "2026-08-27T00:00:00.000Z",
    });
    expect(text).not.toContain("secret storage credential");
    expect(text).not.toContain("stack");
  });
});

describe("GET /api/runs", () => {
  it("lists anonymous rows without uploader credentials", async () => {
    const container = createTestContainer();
    const postResponse = await handleRunsPost(syntheticRequest(), container);
    await postResponse.text();

    const response = await handleRunsGet(
      new Request("http://local.test/api/runs"),
      container,
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(text).not.toContain("deletionToken");
    expect(text).not.toContain("deletionTokenHash");
    expect(text).not.toContain("documentKey");
    expect(JSON.parse(text)).toMatchObject({ runs: [{ executionMode: "recorded" }] });
  });
});
