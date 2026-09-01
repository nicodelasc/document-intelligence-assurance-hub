import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { syntheticFixtures } from "@/domain/fixtures";
import { runEventSchema } from "@/domain/run-schema";
import type { RunEvent } from "@/domain/types";
import type { HttpContainer } from "@/server/http/container";
import type { ExtractionProvider } from "@/server/workflow/provider";
import { ProviderRequestError } from "@/server/workflow/provider";
import { InMemoryQuotaRepository } from "@/server/security/rate-limit";
import { handleRunsGet, handleRunsPost } from "@/server/http/runs-handler";
import { parseRunMultipart } from "@/server/http/multipart";
import { handleRunGet } from "@/server/http/run-detail-handler";
import { InMemoryDocumentStore } from "@/server/storage/document-store";
import {
  createTestContainer,
  formRequest,
  makePdf,
  readJson,
  readLines,
  syntheticRequest,
} from "./test-support";

describe("POST /api/runs", () => {
  it("derives fixture and custom origin status after admitting each source", async () => {
    const container = createTestContainer({ liveModeEnabled: true });
    const exactCopy = new Uint8Array(
      await readFile(
        join(process.cwd(), "public", "samples", "invoice-clean-match.pdf"),
      ),
    );
    const screenshotBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0,
    ]);
    const parsedSynthetic = await parseRunMultipart(
      syntheticRequest(),
      container,
    );
    const parsedExactCopy = await parseRunMultipart(
      formRequest([
        ["sourceType", "custom"],
        ["provider", "openai"],
        ["requestedField", "Vendor name"],
        ["requestedField", "Invoice total"],
        ["consent", "true"],
        [
          "document",
          new Blob([exactCopy], { type: "application/pdf" }),
          "fixture-copy.pdf",
        ],
      ]),
      container,
    );
    const parsedScreenshot = await parseRunMultipart(
      formRequest([
        ["sourceType", "custom"],
        ["provider", "openai"],
        ["requestedField", "Vendor name"],
        ["requestedField", "Invoice total"],
        ["consent", "true"],
        [
          "document",
          new Blob([screenshotBytes], { type: "image/png" }),
          "screenshot.png",
        ],
      ]),
      container,
    );
    expect(parsedSynthetic.sourceOriginStatus).toBe("server_original");
    expect(parsedExactCopy.sourceOriginStatus).toBe("recognized_copy");
    expect(parsedScreenshot.sourceOriginStatus).toBe("unverified");
  });

  it("keeps a recognized custom fixture copy on the live provider path", async () => {
    let providerCreations = 0;
    const fixtureBytes = new Uint8Array(
      await readFile(
        join(process.cwd(), "public", "samples", "invoice-clean-match.pdf"),
      ),
    );
    const container = createTestContainer({
      liveModeEnabled: true,
      providerAvailability: { openai: true, anthropic: false },
      async createProvider(input) {
        providerCreations += 1;
        return {
          provider: input.provider,
          model: input.model,
          promptVersion: "origin-admission-test.v1",
          executionMode: "live",
          async extract(request) {
            await request.onDispatch?.();
            return {
              extraction: {
                classification: "supplier_invoice",
                fields: request.requestedFields.map((field) => ({
                  key: field.key,
                  label: field.label,
                  extractedValue: null,
                  normalizedValue: null,
                  evidence: null,
                  page: null,
                })),
                documentInstruction: null,
                action: structuredClone(syntheticFixtures[0].action),
              },
              usage: { inputTokens: 0, outputTokens: 0 },
              latencyMs: 0,
            };
          },
        };
      },
    });

    const response = await handleRunsPost(
      formRequest([
        ["sourceType", "custom"],
        ["provider", "openai"],
        ["requestedField", "Vendor name"],
        ["requestedField", "Invoice total"],
        ["consent", "true"],
        [
          "document",
          new Blob([fixtureBytes], { type: "application/pdf" }),
          "fixture-copy.pdf",
        ],
      ]),
      container,
    );
    const events = await readLines(response);
    const completed = events.at(-1) as { runId: string };
    const stored = await container.repository.readPublicRun(
      completed.runId,
      container.clock(),
    );

    expect(response.status).toBe(200);
    expect(providerCreations).toBe(1);
    expect(stored?.sourceOriginStatus).toBe("recognized_copy");
  });

  it("ignores a client origin status and passes the derived unverified status into execution", async () => {
    let providerCreations = 0;
    let executeInput: Parameters<HttpContainer["execute"]>[0] | undefined;
    const screenshotBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0,
    ]);
    const container = createTestContainer({
      liveModeEnabled: true,
      providerAvailability: { openai: true, anthropic: false },
      async createProvider(input) {
        providerCreations += 1;
        return {
          provider: input.provider,
          model: input.model,
          promptVersion: "origin-admission-test.v1",
          executionMode: "live",
          async extract() {
            throw new Error("provider_must_not_extract_in_route_boundary_test");
          },
        };
      },
      execute: async function* (input) {
        executeInput = input;
        yield {
          type: "completed",
          runId: "run-origin-unverified",
          outcome: "needs_review",
          executionMode: "live",
          provider: "openai",
          model: "gpt-5.6-luna",
          deletionToken: "delete-once",
          timestamp: "2026-08-27T00:00:00.000Z",
        } as RunEvent;
      } as HttpContainer["execute"],
    });

    const response = await handleRunsPost(
      formRequest([
        ["sourceType", "custom"],
        ["provider", "openai"],
        ["requestedField", "Vendor name"],
        ["requestedField", "Invoice total"],
        ["consent", "true"],
        ["sourceOriginStatus", "server_original"],
        [
          "document",
          new Blob([screenshotBytes], { type: "image/png" }),
          "screenshot.png",
        ],
      ]),
      container,
    );
    await response.text();

    expect(providerCreations).toBe(1);
    expect(executeInput?.sourceOriginStatus).toBe("unverified");
  });

  it("runs an operational fixture with its verified action semantics", async () => {
    const container = createTestContainer();
    const response = await handleRunsPost(
      syntheticRequest(
        "warehouse-clean-receipt",
        "openai",
        "operational-fixture-action-20260828",
      ),
      container,
    );
    const events = await readLines(response);
    const completed = events.find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "completed",
    ) as { runId: string; outcome: string };
    const stored = await container.repository.readPublicRun(
      completed.runId,
      container.clock(),
    );

    expect(response.status).toBe(200);
    expect(completed.outcome).toBe("clear");
    expect(stored?.file.filename).toBe("warehouse-clean-receipt.pdf");
    expect(stored?.requestedFields.map((field) => field.key)).toEqual([
      "goods_receipt_number",
      "delivery_note_number",
      "purchase_order_number",
      "item_code",
      "lot_number",
      "expected_quantity",
      "received_quantity",
      "damaged_quantity",
      "receiver_comments",
    ]);
    expect(stored?.details?.result?.action).toEqual(
      syntheticFixtures.find(
        (fixture) => fixture.id === "warehouse-clean-receipt",
      )?.action,
    );
  });

  it("derives the invoice review outcome from conflicting document evidence", async () => {
    const container = createTestContainer();
    const response = await handleRunsPost(
      syntheticRequest(
        "invoice-total-mismatch",
        "openai",
        "invoice-conflict-outcome-20260828",
      ),
      container,
    );
    const events = await readLines(response);
    const completed = events.find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "completed",
    ) as { outcome: string };

    expect(completed.outcome).toBe("needs_review");
  });

  it("passes a valid catalogue model through provider construction", async () => {
    let selectedModel: string | undefined;
    const base = createTestContainer();
    const container = createTestContainer({
      async createProvider(input) {
        selectedModel = input.model;
        return base.createProvider(input);
      },
    });

    const response = await handleRunsPost(
      syntheticRequest(
        "warehouse-clean-receipt",
        "openai",
        "valid-model-selection-20260828",
        "gpt-5.6-terra",
      ),
      container,
    );
    await response.text();

    expect(response.status).toBe(200);
    expect(selectedModel).toBe("gpt-5.6-terra");
    const runs = await container.repository.listPublicRuns(container.clock());
    expect(runs[0]?.model).toBe("gpt-5.6-terra");
  });

  it("rejects an unknown catalogue model before provider construction", async () => {
    let providerCreations = 0;
    const container = createTestContainer({
      async createProvider() {
        providerCreations += 1;
        throw new Error("provider_must_not_be_created");
      },
    });

    const response = await handleRunsPost(
      syntheticRequest(
        "warehouse-clean-receipt",
        "openai",
        "unknown-model-selection-20260828",
        "gpt-unknown",
      ),
      container,
    );

    expect(response.status).toBe(400);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("invalid_model");
    expect(providerCreations).toBe(0);
  });

  it("rejects a provider-model mismatch before provider construction", async () => {
    const response = await handleRunsPost(
      syntheticRequest(
        "warehouse-clean-receipt",
        "openai",
        "mismatched-model-selection-20260828",
        "claude-haiku-4-5",
      ),
      createTestContainer(),
    );

    expect(response.status).toBe(400);
    expect(
      (await readJson<{ error: { code: string } }>(response)).error.code,
    ).toBe("invalid_model");
  });

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
      ["sampleId", "warehouse-clean-receipt"],
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
        syntheticRequest("warehouse-clean-receipt", "openai", idempotencyKey),
        container,
      ),
      handleRunsPost(
        syntheticRequest("warehouse-clean-receipt", "openai", idempotencyKey),
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

  it("uses live execution for an available built-in provider despite a recorded client mode", async () => {
    const selected: Array<{ provider: string; mode: string }> = [];
    const container = createTestContainer({
      liveModeEnabled: true,
      providerAvailability: { openai: true, anthropic: false },
      async createProvider(input) {
        selected.push({ provider: input.provider, mode: input.executionMode });
        return {
          provider: "openai",
          model: input.model,
          promptVersion: "server-owned-admission.v1",
          executionMode: "live",
          async extract(request) {
            await request.onDispatch?.();
            return {
              extraction: {
                classification: "warehouse_goods_receipt",
                fields: request.requestedFields.map((field) => ({
                  key: field.key,
                  label: field.label,
                  extractedValue: null,
                  normalizedValue: null,
                  evidence: null,
                  page: null,
                })),
                documentInstruction: null,
                action: structuredClone(syntheticFixtures[0].action),
              },
              usage: { inputTokens: 100, outputTokens: 20 },
              latencyMs: 5,
            };
          },
        };
      },
    });
    const request = formRequest([
      ["sourceType", "synthetic"],
      ["provider", "openai"],
      ["sampleId", "warehouse-clean-receipt"],
      ["executionMode", "recorded"],
    ]);

    const response = await handleRunsPost(request, container);
    const events = await readLines(response);

    expect(response.status).toBe(200);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      executionMode: "live",
    });
    expect(selected).toEqual([{ provider: "openai", mode: "live" }]);
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
    expect(body.error.message).toContain("synthetic sample");
    expect(providerCreations).toBe(0);
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
  });

  it("uses live execution for an available custom provider despite a recorded client mode", async () => {
    const selected: Array<{ provider: string; mode: string }> = [];
    const container = createTestContainer({
      liveModeEnabled: true,
      providerAvailability: { openai: false, anthropic: true },
      async createProvider(input) {
        selected.push({ provider: input.provider, mode: input.executionMode });
        return {
          provider: "anthropic",
          model: input.model,
          promptVersion: "server-owned-custom-admission.v1",
          executionMode: "live",
          async extract(request) {
            await request.onDispatch?.();
            return {
              extraction: {
                classification: "supplier_invoice",
                fields: request.requestedFields.map((field) => ({
                  key: field.key,
                  label: field.label,
                  extractedValue: null,
                  normalizedValue: null,
                  evidence: null,
                  page: null,
                })),
                documentInstruction: null,
                action: structuredClone(syntheticFixtures[0].action),
              },
              usage: { inputTokens: 100, outputTokens: 20 },
              latencyMs: 5,
            };
          },
        };
      },
    });
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
    const events = await readLines(response);

    expect(response.status).toBe(200);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      executionMode: "live",
    });
    expect(selected).toEqual([{ provider: "anthropic", mode: "live" }]);
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
            classification: "supplier_invoice",
            fields: input.requestedFields.map((field) => ({
              key: field.key,
              label: field.label,
              extractedValue: null,
              normalizedValue: null,
              evidence: null,
              page: null,
            })),
            documentInstruction: null,
            action: structuredClone(syntheticFixtures[0].action),
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
      providerDispatched: true,
    });
    const listResponse = await handleRunsGet(
      new Request("http://local.test/api/runs"),
      container,
    );
    expect(await listResponse.json()).toMatchObject({
      runs: [
        {
          id: completed.runId,
          providerCalled: true,
          provider: "anthropic",
          model: "claude-haiku-4-5",
          configuredProvider: "anthropic",
          configuredModel: "claude-haiku-4-5",
        },
      ],
    });
    expect(
      (await container.quotaRepository.snapshot(container.clock()))
        .globalSpendUsd,
    ).toBeGreaterThan(0);
  });

  it("rejects an unavailable custom provider before claim, quota or document storage", async () => {
    const documentStore = new InMemoryDocumentStore();
    const container = createTestContainer({
      liveModeEnabled: true,
      providerAvailability: { openai: false, anthropic: true },
      documentStore,
      async createProvider() {
        throw new Error("provider_must_not_be_created");
      },
    });
    const claimRunRequest = vi.spyOn(container.repository, "claimRunRequest");
    const reserveQuota = vi.spyOn(container.quotaRepository, "reserve");
    const storePrivateDocument = vi.spyOn(
      documentStore,
      "storePrivateDocument",
    );
    const request = formRequest([
      ["sourceType", "custom"],
      ["provider", "openai"],
      ["executionMode", "live"],
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
    const body = await readJson<{ error: { code: string; message: string } }>(
      response,
    );

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("live_disabled");
    expect(body.error.message).toContain("synthetic sample");
    expect(claimRunRequest).not.toHaveBeenCalled();
    expect(reserveQuota).not.toHaveBeenCalled();
    expect(storePrivateDocument).not.toHaveBeenCalled();
    expect(
      (await container.repository.aggregateAnonymousUsage()).totalRuns,
    ).toBe(0);
  });

  it("keeps public attribution uncalled when document storage fails before dispatch", async () => {
    class FailingDocumentStore extends InMemoryDocumentStore {
      override async storePrivateDocument(): Promise<never> {
        throw new Error("storage_unavailable");
      }
    }
    let providerCalls = 0;
    const container = createTestContainer({
      liveModeEnabled: true,
      documentStore: new FailingDocumentStore(),
      async createProvider() {
        return {
          provider: "openai",
          model: "gpt-5.6-luna",
          promptVersion: "storage-failure.v1",
          executionMode: "live",
          async extract() {
            providerCalls += 1;
            throw new Error("provider_must_not_be_called");
          },
        };
      },
    });
    const response = await handleRunsPost(
      formRequest([
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
      ]),
      container,
    );
    const events = await readLines(response);
    const failed = events.at(-1) as { runId: string };

    expect(events.at(-1)).toMatchObject({
      type: "failed",
      code: "storage_unavailable",
    });
    expect(providerCalls).toBe(0);
    const detailResponse = await handleRunGet(
      new Request(`http://local.test/api/runs/${failed.runId}`),
      { id: failed.runId },
      container,
    );
    expect(await detailResponse.json()).toMatchObject({
      run: { providerCalled: false, provider: null, model: null },
    });
  });

  it("returns actual attribution after a confirmed dispatch ends in provider failure", async () => {
    const container = createTestContainer({
      liveModeEnabled: true,
      async createProvider() {
        return {
          provider: "anthropic",
          model: "claude-haiku-4-5",
          promptVersion: "post-dispatch-failure.v1",
          executionMode: "live",
          async extract(input) {
            await input.onDispatch?.();
            throw new ProviderRequestError("provider_request_rejected", 400);
          },
        };
      },
    });
    const response = await handleRunsPost(
      formRequest([
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
      ]),
      container,
    );
    const events = await readLines(response);
    const failed = events.at(-1) as { runId: string };

    expect(events.at(-1)).toMatchObject({
      type: "failed",
      code: "provider_request_rejected",
    });
    const detailResponse = await handleRunGet(
      new Request(`http://local.test/api/runs/${failed.runId}`),
      { id: failed.runId },
      container,
    );
    expect(await detailResponse.json()).toMatchObject({
      run: {
        providerCalled: true,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        configuredProvider: "anthropic",
        configuredModel: "claude-haiku-4-5",
      },
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
          providerCalled: false,
          provider: null,
          model: null,
          configuredProvider: "openai",
          configuredModel: "gpt-5.6-luna",
          filename: "warehouse-clean-receipt.pdf",
        },
      ],
      pagination: { limit: 20, offset: 0, returned: 1 },
    });
  });

  it("uses bounded limit and offset pagination", async () => {
    const container = createTestContainer();
    for (const sampleId of [
      "invoice-clean-match",
      "warehouse-clean-receipt",
      "invoice-buyer-hold",
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
            input.provider === "openai" ? "gpt-5.6-luna" : "claude-haiku-4-5",
          promptVersion: "live-cookie-limit-test.v1",
          executionMode: "live",
          async extract(request) {
            return {
              extraction: {
                classification: "supplier_invoice",
                fields: request.requestedFields.map((field) => ({
                  key: field.key,
                  label: field.label,
                  extractedValue: null,
                  normalizedValue: null,
                  evidence: null,
                  page: null,
                })),
                documentInstruction: null,
                action: structuredClone(syntheticFixtures[0].action),
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
