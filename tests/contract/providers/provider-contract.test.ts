import { describe, expect, it, vi } from "vitest";
import {
  recordedDocumentRunResults,
  syntheticFixtures,
} from "@/domain/fixtures";
import { extractionResultSchema } from "@/server/workflow/provider";
import { createRecordedExtractionProvider } from "@/server/workflow/recorded-provider";
import {
  LIVE_PROVIDER_TIMEOUT_MS,
  LiveProviderConfigurationError,
  createAnthropicExtractionProvider,
  createOpenAIExtractionProvider,
  type StructuredGenerationRequest,
} from "@/server/workflow/live-provider";

const document = {
  filename: "sample.pdf",
  mediaType: "application/pdf",
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
};

const requestedFields = [
  { key: "vendor_name", label: "Vendor name" },
  { key: "purchase_order_number", label: "Purchase-order number" },
  { key: "invoice_total", label: "Invoice total" },
];

const validModelOutput = {
  fields: [
    {
      key: "vendor_name",
      label: "Vendor name",
      extractedValue: "Northstar Paperworks",
      normalizedValue: "Northstar Paperworks",
      evidence: "Supplier: Northstar Paperworks",
      page: 1,
    },
    {
      key: "purchase_order_number",
      label: "Purchase-order number",
      extractedValue: "PO-NP-1001",
      normalizedValue: "PO-NP-1001",
      evidence: "PO: PO-NP-1001",
      page: 1,
    },
    {
      key: "invoice_total",
      label: "Invoice total",
      extractedValue: "1250.00 SGD",
      normalizedValue: "1250.00 SGD",
      evidence: "Total due: 1250.00 SGD",
      page: 1,
    },
  ],
  documentInstruction: "Corrected received quantity: 48.",
  action: {
    type: "stage_inventory_receipt",
    title: "Stage inventory receipt",
    summary: "Stage the verified receipt for internal inventory posting.",
    payload: [
      { label: "Shipment ID", value: "SHIP-4018" },
      { label: "Purchase-order number", value: "PO-WR-4018" },
      { label: "Received quantity", value: "48" },
    ],
    instructionEvidence: "Corrected received quantity: 48.",
    page: 1,
    risk: "low",
    status: "ready",
    reason: "The corrected quantity matches the expected delivery.",
    stagedAt: null,
  },
};

describe("extraction provider contract", () => {
  it("uses the enabled OpenAI catalogue default", () => {
    expect(
      createOpenAIExtractionProvider({
        liveEnabled: false,
        apiKey: undefined,
      }).model,
    ).toBe("gpt-5.6-luna");
  });

  it("uses an enabled recorded default and rejects a mismatched override", () => {
    expect(
      createRecordedExtractionProvider({
        provider: "openai",
        fixtureId: "invoice-total-mismatch",
      }).model,
    ).toBe("gpt-5.6-luna");
    expect(() =>
      createRecordedExtractionProvider({
        provider: "openai",
        fixtureId: "invoice-total-mismatch",
        model: "claude-haiku-4-5",
      }),
    ).toThrow("unsupported_live_model");
  });

  it.each(
    syntheticFixtures.flatMap((fixture) =>
      (["openai", "anthropic"] as const).map((providerName) => ({
        fixture,
        providerName,
      })),
    ),
  )(
    "validates $fixture.id through the $providerName recorded-adapter configuration without a provider call",
    async ({ fixture, providerName }) => {
      const provider = createRecordedExtractionProvider({
        provider: providerName,
        fixtureId: fixture.id,
      });
      const result = await provider.extract({
        document,
        requestedFields: fixture.requestedFields,
      });

      expect(provider.executionMode).toBe("recorded");
      expect(provider.promptVersion).toBe("recorded-fixture-2026-08-27.v1");
      expect(extractionResultSchema.parse(result.extraction)).toEqual(
        result.extraction,
      );
      expect(result.extraction.fields.map((field) => field.key)).toEqual(
        fixture.requestedFields.map((field) => field.key),
      );
      expect(result.extraction.action).toEqual(fixture.action);
      const recorded = recordedDocumentRunResults.find(
        (candidate) => candidate.fixtureId === fixture.id,
      );
      expect(result.extraction.fields).toEqual(
        recorded?.fields.map(
          ({ evaluatorStatus, referenceMatch, ...field }) => field,
        ),
      );
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    },
  );

  it.each([
    ["openai", createOpenAIExtractionProvider],
    ["anthropic", createAnthropicExtractionProvider],
  ] as const)(
    "keeps the %s adapter inert unless live mode and a server key are both supplied",
    async (_name, factory) => {
      const generate = vi.fn();
      const disabled = factory({
        liveEnabled: false,
        apiKey: undefined,
        generate,
      });
      const missingKey = factory({
        liveEnabled: true,
        apiKey: undefined,
        generate,
      });

      await expect(
        disabled.extract({ document, requestedFields }),
      ).rejects.toBeInstanceOf(LiveProviderConfigurationError);
      await expect(
        missingKey.extract({ document, requestedFields }),
      ).rejects.toBeInstanceOf(LiveProviderConfigurationError);
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["openai", createOpenAIExtractionProvider, "gpt-5-mini-preview"],
    [
      "anthropic",
      createAnthropicExtractionProvider,
      "claude-haiku-4-5-20261001",
    ],
  ] as const)(
    "rejects an unpriced %s model override before generation",
    (_name, factory, model) => {
      const generate = vi.fn();

      expect(() =>
        factory({
          liveEnabled: true,
          apiKey: "unit-test-placeholder",
          model,
          generate,
        }),
      ).toThrowError("live_provider_model_unsupported");
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["openai", createOpenAIExtractionProvider],
    ["anthropic", createAnthropicExtractionProvider],
  ] as const)(
    "validates mocked %s output with the same schema and exposes no prompt or reasoning",
    async (_name, factory) => {
      let request: StructuredGenerationRequest | undefined;
      const provider = factory({
        liveEnabled: true,
        apiKey: "unit-test-placeholder",
        generate: async (input) => {
          request = input;
          return {
            output: validModelOutput,
            usage: { inputTokens: 120, outputTokens: 30 },
            latencyMs: 250,
          };
        },
      });

      const result = await provider.extract({ document, requestedFields });
      expect(provider.promptVersion).toBe("document-extraction-2026-08-28.v2");
      expect(extractionResultSchema.parse(result.extraction)).toEqual(
        validModelOutput,
      );
      expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
      expect(request?.systemInstruction).toMatch(/untrusted/i);
      expect(request?.systemInstruction).toMatch(/ignore.*instructions/i);
      expect(request?.systemInstruction).toMatch(/verbatim.*page snippet/i);
      expect(request?.systemInstruction).toMatch(/propose.*action/i);
      expect(request?.systemInstruction).toMatch(/internal dry run/i);
      expect(request?.systemInstruction).toMatch(/never.*external/i);
      expect(request?.systemInstruction).toContain(
        "When handwriting is unclear, return null rather than guessing a critical value.",
      );
      expect(request?.systemInstruction).toContain(
        "Do not reconstruct obscured characters from business context.",
      );
      expect(request?.tools).toBeUndefined();
      expect(JSON.stringify(result)).not.toMatch(
        /prompt|reasoning|apiKey|unit-test-placeholder/i,
      );
    },
  );

  it("rejects a malformed adapter response rather than publishing partial output", async () => {
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
      generate: async () => ({
        output: {
          fields: [
            {
              key: "vendor_name",
              label: "Vendor name",
              extractedValue: undefined,
              normalizedValue: null,
              evidence: null,
              page: null,
            },
          ],
        },
        usage: { inputTokens: 10, outputTokens: 10 },
        latencyMs: 50,
      }),
    });

    await expect(
      provider.extract({ document, requestedFields }),
    ).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("normalizes a complete out-of-order provider array into requested field order", async () => {
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
      generate: async () => ({
        output: {
          ...validModelOutput,
          fields: [...validModelOutput.fields].reverse(),
        },
        usage: { inputTokens: 10, outputTokens: 10 },
        latencyMs: 50,
      }),
    });

    const result = await provider.extract({ document, requestedFields });
    expect(result.extraction.fields.map((field) => field.key)).toEqual(
      requestedFields.map((field) => field.key),
    );
  });

  it("rejects an oversized evidence payload at the shared provider boundary", async () => {
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
      generate: async () => ({
        output: {
          fields: validModelOutput.fields.map((field, index) => ({
            ...field,
            evidence: index === 0 ? "x".repeat(601) : field.evidence,
          })),
        },
        usage: { inputTokens: 10, outputTokens: 10 },
        latencyMs: 50,
      }),
    });

    await expect(
      provider.extract({ document, requestedFields }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it.each([
    { title: " \t " },
    { summary: "\u0000\u001f" },
    { reason: "\r\n" },
    { payload: [{ label: "\u0001", value: "Shipment value" }] },
    { payload: [{ label: "Shipment label", value: "\u0002" }] },
  ])("rejects provider action text that sanitizes to empty", (actionPatch) => {
    expect(() =>
      extractionResultSchema.parse({
        ...validModelOutput,
        action: { ...validModelOutput.action, ...actionPatch },
      }),
    ).toThrow();
  });

  it("returns valid required action text after NFKC normalization and control stripping", () => {
    const parsed = extractionResultSchema.parse({
      ...validModelOutput,
      action: {
        ...validModelOutput.action,
        title: "\u0000Ｒｅｖｉｅｗ invoice\u001f",
        summary: "\u0001Prepare ａ valid review.\u007f",
        reason: "\u0002Evidence is ｃｏｍｐｌｅｔｅ.\u0003",
        payload: [
          { label: "\u0004Ｖｅｎｄｏｒ", value: "Ｎｏｒｔｈｓｔａｒ\u0005" },
        ],
      },
    });

    expect(parsed.action).toMatchObject({
      title: "Review invoice",
      summary: "Prepare a valid review.",
      reason: "Evidence is complete.",
      payload: [{ label: "Vendor", value: "Northstar" }],
    });
  });

  it.each([
    [429, "provider_rate_limited"],
    [503, "provider_unavailable"],
    [401, "provider_auth_failed"],
  ] as const)(
    "maps a live adapter HTTP %s failure to %s",
    async (status, safeCode) => {
      const provider = createOpenAIExtractionProvider({
        liveEnabled: true,
        apiKey: "unit-test-placeholder",
        generate: async () => {
          throw { statusCode: status };
        },
      });

      await expect(
        provider.extract({ document, requestedFields }),
      ).rejects.toMatchObject({
        safeCode,
        httpStatus: status,
      });
    },
  );

  it("passes the workflow abort signal into the selected live adapter", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    let finishGeneration:
      | ((result: {
          output: typeof validModelOutput;
          usage: { inputTokens: number; outputTokens: number };
          latencyMs: number;
        }) => void)
      | undefined;
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
      generate: async (request) => {
        observedSignal = request.signal;
        return new Promise((resolve) => {
          finishGeneration = resolve;
        });
      },
    });

    const extractionPromise = provider.extract({
      document,
      requestedFields,
      signal: controller.signal,
    });

    expect(observedSignal).not.toBe(controller.signal);
    expect(observedSignal?.aborted).toBe(false);
    controller.abort("reviewer_left");
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toBe("reviewer_left");
    finishGeneration?.({
      output: validModelOutput,
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 1,
    });
    await extractionPromise;
  });

  it("aborts a live generation after the server-owned deadline", async () => {
    vi.useFakeTimers();
    try {
      let observedSignal: AbortSignal | undefined;
      let finishGeneration:
        | ((result: {
            output: typeof validModelOutput;
            usage: { inputTokens: number; outputTokens: number };
            latencyMs: number;
          }) => void)
        | undefined;
      const provider = createOpenAIExtractionProvider({
        liveEnabled: true,
        apiKey: "unit-test-placeholder",
        generate: async (request) => {
          observedSignal = request.signal;
          return new Promise((resolve) => {
            finishGeneration = resolve;
          });
        },
      });

      const extractionPromise = provider.extract({ document, requestedFields });
      expect(observedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(LIVE_PROVIDER_TIMEOUT_MS);
      expect(observedSignal?.aborted).toBe(true);
      finishGeneration?.({
        output: validModelOutput,
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 1,
      });
      await extractionPromise;
    } finally {
      vi.useRealTimers();
    }
  });
});
