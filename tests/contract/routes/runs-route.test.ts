import { describe, expect, it } from "vitest";
import { runEventSchema } from "@/domain/run-schema";
import type { RunEvent } from "@/domain/types";
import type { HttpContainer } from "@/server/http/container";
import type { ExtractionProvider } from "@/server/workflow/provider";
import { InMemoryQuotaRepository } from "@/server/security/rate-limit";
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
        headers: {
          "content-type": "application/json",
          "idempotency-key": "test-idempotency-invalid-content",
        },
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
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
  });

  it("rejects an oversized custom file before storage", async () => {
    const container = createTestContainer({ liveModeEnabled: true });
    const bytes = new Uint8Array(3 * 1024 * 1024 + 1);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "openai"],
      ["executionMode", "live"],
      ["requestedField", "Invoice number"],
      ["requestedField", "Invoice total"],
      ["consent", "true"],
      ["document", new Blob([bytes], { type: "image/png" }), "large.png"],
    ]);

    const response = await handleRunsPost(request, container);

    expect(response.status).toBe(413);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("file_too_large");
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
  });

  it("enforces the absolute multipart cap without trusting Content-Length", async () => {
    let fixtureReads = 0;
    let workflowCalls = 0;
    const container = createTestContainer({
      async loadSyntheticDocument() {
        fixtureReads += 1;
        return makePdf(1);
      },
      execute: (() => {
        workflowCalls += 1;
        throw new Error("workflow_must_not_start");
      }) as HttpContainer["execute"],
    });
    const request = formRequest([
      ["sourceType", "synthetic"],
      ["provider", "openai"],
      ["sampleId", "clean-match"],
      ["ignored", "x".repeat(4_000_100)],
    ]);
    expect(request.headers.get("content-length")).toBeNull();

    const response = await handleRunsPost(request, container);

    expect(response.status).toBe(413);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("request_too_large");
    expect(fixtureReads).toBe(0);
    expect(workflowCalls).toBe(0);
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
    expect(
      await container.quotaRepository.snapshot(container.clock()),
    ).toMatchObject({
      customUploadsByBucket: {},
      liveRunsByBucket: {},
    });
  });

  it("rejects abusive submissions before multipart parsing or fixture reads", async () => {
    let fixtureReads = 0;
    const container = createTestContainer({
      abuseControl: {
        allowRunSubmission: async () => false,
        allowDocumentRead: async () => true,
        allowPublicRead: async () => true,
      },
      async loadSyntheticDocument() {
        fixtureReads += 1;
        return makePdf(1);
      },
    });

    const response = await handleRunsPost(syntheticRequest(), container);

    expect(response.status).toBe(429);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("run_request_rate_limited");
    expect(fixtureReads).toBe(0);
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
  });

  it("requires complete multipart preflight metadata before consuming the body", async () => {
    let bodyReads = 0;
    const request = new Request("http://local.test/api/runs", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=unused",
        "idempotency-key": "test-missing-run-preflight",
      },
      body: "--unused--",
    });
    const requestBody = request.body;
    Object.defineProperty(request, "body", {
      get: () => {
        bodyReads += 1;
        return requestBody;
      },
    });

    const response = await handleRunsPost(request, createTestContainer());

    expect(response.status).toBe(400);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("invalid_run_preflight");
    expect(bodyReads).toBe(0);
  });

  it("rejects a disabled live preflight without consuming multipart bytes", async () => {
    let formDataReads = 0;
    const request = new Request("http://local.test/api/runs", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=unused",
        "idempotency-key": "test-disabled-live-preflight",
        "x-run-source-type": "custom",
        "x-run-execution-mode": "live",
      },
      body: "--unused--",
    });
    Object.defineProperty(request, "formData", {
      value: async () => {
        formDataReads += 1;
        throw new Error("multipart_body_must_not_be_consumed");
      },
    });

    const response = await handleRunsPost(request, createTestContainer());

    expect(response.status).toBe(503);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("live_disabled");
    expect(formDataReads).toBe(0);
  });

  it("rejects a recorded custom preflight without consuming multipart bytes", async () => {
    let formDataReads = 0;
    const request = new Request("http://local.test/api/runs", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=unused",
        "idempotency-key": "test-recorded-custom-preflight",
        "x-run-source-type": "custom",
        "x-run-execution-mode": "recorded",
      },
      body: "--unused--",
    });
    Object.defineProperty(request, "formData", {
      value: async () => {
        formDataReads += 1;
        throw new Error("multipart_body_must_not_be_consumed");
      },
    });

    const response = await handleRunsPost(request, createTestContainer());

    expect(response.status).toBe(409);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("recorded_custom_unavailable");
    expect(formDataReads).toBe(0);
  });

  it("keeps multipart values authoritative when preflight metadata disagrees", async () => {
    const base = syntheticRequest();
    const request = new Request(base, {
      headers: {
        ...Object.fromEntries(base.headers),
        "x-run-source-type": "synthetic",
        "x-run-execution-mode": "live",
      },
    });

    const response = await handleRunsPost(
      request,
      createTestContainer({ liveModeEnabled: true }),
    );

    expect(response.status).toBe(400);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("run_preflight_mismatch");
  });

  it("claims a concurrent idempotency key once before quota and provider work", async () => {
    let providerCreations = 0;
    const base = createTestContainer();
    const container = createTestContainer({
      repository: base.repository,
      quotaRepository: base.quotaRepository,
      documentStore: base.documentStore,
      async createProvider(input) {
        providerCreations += 1;
        return base.createProvider(input);
      },
    });
    const idempotencyKey = "concurrent-idempotency-key-20260827";

    const responses = await Promise.all([
      handleRunsPost(
        syntheticRequest("clean-match", "openai", idempotencyKey),
        container,
      ),
      handleRunsPost(
        syntheticRequest("clean-match", "openai", idempotencyKey),
        container,
      ),
    ]);
    await Promise.all(responses.map((response) => response.text()));

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(providerCreations).toBe(1);
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(1);
  });

  it("uses the PDF bytes for page count instead of a form field", async () => {
    const container = createTestContainer({ liveModeEnabled: true });
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "anthropic"],
      ["executionMode", "live"],
      ["requestedField", "Vendor name"],
      ["requestedField", "Invoice total"],
      ["consent", "true"],
      ["pageCount", "1"],
      [
        "document",
        new Blob([makePdf(6)], { type: "application/pdf" }),
        "six-pages.pdf",
      ],
    ]);

    const response = await handleRunsPost(request, container);

    expect(response.status).toBe(400);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("pdf_page_limit");
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
  });

  it.each([
    {
      entries: [["requestedField", "Invoice total"]] as Array<[string, string]>,
      code: "field_count",
    },
    {
      entries: [
        ["requestedField", "Invoice total"],
        ["requestedField", "Vendor name"],
      ] as Array<[string, string]>,
      code: "consent_required",
    },
  ])(
    "enforces custom field count and consent: $code",
    async ({ entries, code }) => {
      const container = createTestContainer({ liveModeEnabled: true });
      const request = formRequest([
        ["sourceType", "custom"],
        ["provider", "openai"],
        ["executionMode", "live"],
        ...entries,
        [
          "document",
          new Blob([makePdf(1)], { type: "application/pdf" }),
          "invoice.pdf",
        ],
      ]);

      const response = await handleRunsPost(request, container);

      expect(response.status).toBe(400);
      expect(
        (await readJson<{ error: { code: string } }>(response)).error.code,
      ).toBe(code);
    },
  );

  it("rejects colliding generated custom field keys before quota and storage", async () => {
    const container = createTestContainer({ liveModeEnabled: true });
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "openai"],
      ["requestedField", "Invoice-total"],
      ["requestedField", "Invoice total"],
      ["consent", "true"],
      [
        "document",
        new Blob([makePdf(1)], { type: "application/pdf" }),
        "invoice.pdf",
      ],
    ]);

    const response = await handleRunsPost(request, container);

    expect(response.status).toBe(400);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("duplicate_field_key");
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
    expect(
      await container.quotaRepository.snapshot(container.clock()),
    ).toMatchObject({
      customUploadsByBucket: {},
    });
  });

  it("selects synthetic files through the fixture allow-list", async () => {
    const container = createTestContainer();
    const response = await handleRunsPost(
      syntheticRequest("../../private-document"),
      container,
    );

    expect(response.status).toBe(400);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("sample_not_found");
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
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
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("live_disabled");
  });

  it("defaults custom uploads to live mode and rejects them before storage when disabled", async () => {
    let providerCreations = 0;
    const container = createTestContainer({
      async createProvider() {
        providerCreations += 1;
        throw new Error("provider_must_not_be_created");
      },
    });
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "openai"],
      ["requestedField", "Vendor name"],
      ["requestedField", "Invoice total"],
      ["consent", "true"],
      [
        "document",
        new Blob([makePdf(1)], { type: "application/pdf" }),
        "invoice.pdf",
      ],
    ]);

    const response = await handleRunsPost(request, container);

    expect(response.status).toBe(503);
    const body = await readJson<{ error: { code: string; message: string } }>(
      response,
    );
    expect(body.error.code).toBe("live_disabled");
    expect(body.error.message).toContain("synthetic recorded replay");
    expect(providerCreations).toBe(0);
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
  });

  it("rejects explicit recorded mode for custom uploads without fabricating extraction", async () => {
    const container = createTestContainer({ liveModeEnabled: true });
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "anthropic"],
      ["executionMode", "recorded"],
      ["requestedField", "Vendor name"],
      ["requestedField", "Invoice total"],
      ["consent", "true"],
      [
        "document",
        new Blob([makePdf(1)], { type: "application/pdf" }),
        "invoice.pdf",
      ],
    ]);

    const response = await handleRunsPost(request, container);

    expect(response.status).toBe(409);
    const body = await readJson<{ error: { code: string; message: string } }>(
      response,
    );
    expect(body.error.code).toBe("recorded_custom_unavailable");
    expect(body.error.message).toContain("synthetic recorded replay");
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
  });

  it("passes an enabled custom live run through the selected injected provider and quota reservation", async () => {
    const selected: Array<{ provider: string; mode: string }> = [];
    const provider: ExtractionProvider = {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      promptVersion: "live-contract-test.v1",
      executionMode: "live",
      async extract(input) {
        await input.onDispatch?.();
        return {
          extraction: {
            fields: input.requestedFields.map((field) => ({
              key: field.key,
              label: field.label,
              extractedValue: null,
              normalizedValue: null,
              evidence: null,
              page: null,
            })),
          },
          usage: { inputTokens: 100, outputTokens: 20 },
          latencyMs: 5,
        };
      },
    };
    const container = createTestContainer({
      liveModeEnabled: true,
      async createProvider(input) {
        selected.push({ provider: input.provider, mode: input.executionMode });
        return provider;
      },
    });
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "anthropic"],
      ["requestedField", "Vendor name"],
      ["requestedField", "Invoice total"],
      ["consent", "true"],
      [
        "document",
        new Blob([makePdf(1)], { type: "application/pdf" }),
        "invoice.pdf",
      ],
    ]);

    const response = await handleRunsPost(request, container);
    const events = await readLines(response);
    const completed = events.at(-1) as {
      type: string;
      runId: string;
      executionMode: string;
    };

    expect(completed).toMatchObject({
      type: "completed",
      executionMode: "live",
    });
    expect(selected).toEqual([{ provider: "anthropic", mode: "live" }]);
    expect(
      await container.repository.readPublicRun(
        completed.runId,
        container.clock(),
      ),
    ).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      executionMode: "live",
    });
    expect(
      (await container.quotaRepository.snapshot(container.clock()))
        .globalSpendUsd,
    ).toBeGreaterThan(0);
  });

  it("returns a post-create deletion receipt when live mode is enabled without a provider key", async () => {
    const { createOpenAIExtractionProvider } = await import(
      "@/server/workflow/live-provider"
    );
    const container = createTestContainer({
      liveModeEnabled: true,
      async createProvider() {
        return createOpenAIExtractionProvider({
          liveEnabled: true,
          apiKey: undefined,
        });
      },
    });
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "openai"],
      ["requestedField", "Vendor name"],
      ["requestedField", "Invoice total"],
      ["consent", "true"],
      [
        "document",
        new Blob([makePdf(1)], { type: "application/pdf" }),
        "invoice.pdf",
      ],
    ]);

    const response = await handleRunsPost(request, container);
    const events = await readLines(response);

    expect(events.at(-1)).toMatchObject({
      type: "failed",
      code: "live_provider_key_missing",
      runId: expect.any(String),
      deletionToken: expect.any(String),
    });
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
    expect(
      events.every((event) => runEventSchema.safeParse(event).success),
    ).toBe(true);
    expect(
      events
        .filter(
          (event): event is RunEvent & { type: "stage" } =>
            typeof event === "object" &&
            event !== null &&
            (event as RunEvent).type === "stage",
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
    expect(
      events.filter((event) => JSON.stringify(event).includes("deletionToken")),
    ).toHaveLength(1);
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
    const events = text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);

    expect(events).toHaveLength(2);
    expect(
      events.every((event) => runEventSchema.safeParse(event).success),
    ).toBe(true);
    expect(events.at(-1)).toEqual({
      type: "failed",
      code: "stream_failed",
      message: "The run stream ended safely.",
      timestamp: "2026-08-27T00:00:00.000Z",
    });
    expect(text).not.toContain("secret storage credential");
    expect(text).not.toContain("stack");
  });

  it("emits a safe terminal failure when an iterable ends without a terminal event", async () => {
    const execute: HttpContainer["execute"] = async function* () {
      yield {
        type: "stage",
        stage: "validating",
        timestamp: "2026-08-27T00:00:00.000Z",
      };
    };
    const container = createTestContainer({ execute });

    const response = await handleRunsPost(syntheticRequest(), container);
    const events = await readLines(response);

    expect(events).toEqual([
      {
        type: "stage",
        stage: "validating",
        timestamp: "2026-08-27T00:00:00.000Z",
      },
      {
        type: "failed",
        code: "stream_incomplete",
        message: "The run stream ended before a terminal result.",
        timestamp: "2026-08-27T00:00:00.000Z",
      },
    ]);
  });
});

describe("GET /api/runs", () => {
  it("rate limits list reads before querying public history", async () => {
    const container = createTestContainer();
    let listReads = 0;
    const listPublicRuns = container.repository.listPublicRuns.bind(
      container.repository,
    );
    container.repository.listPublicRuns = async (...input) => {
      listReads += 1;
      return listPublicRuns(...input);
    };
    container.abuseControl = {
      allowRunSubmission: async () => true,
      allowDocumentRead: async () => true,
      allowPublicRead: async () => false,
    };

    const response = await handleRunsGet(
      new Request("http://local.test/api/runs"),
      container,
    );

    expect(response.status).toBe(429);
    expect(listReads).toBe(0);
    expect(response.headers.get("set-cookie")).toContain("diah_browser=");
  });

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
    expect(JSON.parse(text)).toMatchObject({
      runs: [
        {
          executionMode: "recorded",
          filename: "clean-match-invoice.pdf",
        },
      ],
      pagination: { limit: 20, offset: 0, returned: 1 },
    });
  });

  it("uses bounded limit and offset pagination", async () => {
    const container = createTestContainer();
    for (const sampleId of [
      "clean-match",
      "invoice-total-mismatch",
      "missing-purchase-order",
    ]) {
      await (
        await handleRunsPost(syntheticRequest(sampleId), container)
      ).text();
    }

    const response = await handleRunsGet(
      new Request("http://local.test/api/runs?limit=999&offset=1"),
      container,
    );
    const body = (await response.json()) as {
      runs: unknown[];
      pagination: Record<string, number>;
    };

    expect(body.runs).toHaveLength(2);
    expect(body.pagination).toEqual({ limit: 50, offset: 1, returned: 2 });
  });

  it("bounds recorded replay creation for one browser", async () => {
    let nextReservation = 0;
    const quotaRepository = new InMemoryQuotaRepository(
      3,
      () => `reservation-${++nextReservation}`,
      1,
      { recordedRunsPerBucket: 2, globalRecordedRuns: 10 },
    );
    const container = createTestContainer({ quotaRepository });
    const cookie = "diah_browser=bounded-browser-token-12345678901234567890";
    const request = () => {
      const base = syntheticRequest();
      return new Request(base, {
        headers: { ...Object.fromEntries(base.headers), cookie },
      });
    };

    await (await handleRunsPost(request(), container)).text();
    await (await handleRunsPost(request(), container)).text();
    const denied = await handleRunsPost(request(), container);

    expect(denied.status).toBe(429);
    expect(
      (await readJson<{ error: { code: string } }>(denied)).error.code,
    ).toBe("recorded_run_limit");
  });

  it("enforces the global custom-upload ceiling across rotated browser cookies", async () => {
    const quotaRepository = new InMemoryQuotaRepository(
      3,
      () => crypto.randomUUID(),
      1,
      { globalCustomUploads: 2 },
    );
    const container = createTestContainer({
      quotaRepository,
      liveModeEnabled: true,
      async createProvider(input) {
        return {
          provider: input.provider,
          model:
            input.provider === "openai"
              ? "gpt-5.6-luna"
              : "claude-haiku-4-5",
          promptVersion: "live-cookie-limit-test.v1",
          executionMode: "live",
          async extract(request) {
            return {
              extraction: {
                fields: request.requestedFields.map((field) => ({
                  key: field.key,
                  label: field.label,
                  extractedValue: null,
                  normalizedValue: null,
                  evidence: null,
                  page: null,
                })),
              },
              usage: { inputTokens: 0, outputTokens: 0 },
              latencyMs: 0,
            };
          },
        };
      },
    });
    const request = (cookie: string) => {
      const base = formRequest([
        ["sourceType", "custom"],
        ["provider", "openai"],
        ["requestedField", "Vendor name"],
        ["requestedField", "Invoice total"],
        ["consent", "true"],
        [
          "document",
          new Blob([makePdf(1)], { type: "application/pdf" }),
          "invoice.pdf",
        ],
      ]);
      return new Request(base, {
        headers: { ...Object.fromEntries(base.headers), cookie },
      });
    };

    await (
      await handleRunsPost(
        request("diah_browser=rotated-browser-a-12345678901234567890"),
        container,
      )
    ).text();
    await (
      await handleRunsPost(
        request("diah_browser=rotated-browser-b-12345678901234567890"),
        container,
      )
    ).text();
    const denied = await handleRunsPost(
      request("diah_browser=rotated-browser-c-12345678901234567890"),
      container,
    );

    expect(denied.status).toBe(429);
    expect(
      (await readJson<{ error: { code: string } }>(denied)).error.code,
    ).toBe("global_custom_upload_limit");
  });
});
