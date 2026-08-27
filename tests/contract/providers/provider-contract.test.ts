import { describe, expect, it, vi } from "vitest";
import { extractionResultSchema } from "@/server/workflow/provider";
import { createRecordedExtractionProvider } from "@/server/workflow/recorded-provider";
import {
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
};

describe("extraction provider contract", () => {
  it.each(["openai", "anthropic"] as const)(
    "validates the %s recorded replay through the shared strict schema",
    async (providerName) => {
      const provider = createRecordedExtractionProvider({
        provider: providerName,
        fixtureId: "clean-match",
      });
      const result = await provider.extract({ document, requestedFields });

      expect(provider.executionMode).toBe("recorded");
      expect(provider.promptVersion).toBe("recorded-fixture-2026-08-27.v1");
      expect(extractionResultSchema.parse(result.extraction)).toEqual(validModelOutput);
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    },
  );

  it.each([
    ["openai", createOpenAIExtractionProvider],
    ["anthropic", createAnthropicExtractionProvider],
  ] as const)("keeps the %s adapter inert unless live mode and a server key are both supplied", async (_name, factory) => {
    const generate = vi.fn();
    const disabled = factory({ liveEnabled: false, apiKey: undefined, generate });
    const missingKey = factory({ liveEnabled: true, apiKey: undefined, generate });

    await expect(disabled.extract({ document, requestedFields })).rejects.toBeInstanceOf(
      LiveProviderConfigurationError,
    );
    await expect(missingKey.extract({ document, requestedFields })).rejects.toBeInstanceOf(
      LiveProviderConfigurationError,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["openai", createOpenAIExtractionProvider],
    ["anthropic", createAnthropicExtractionProvider],
  ] as const)("validates mocked %s output with the same schema and exposes no prompt or reasoning", async (_name, factory) => {
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
    expect(provider.promptVersion).toBe("document-extraction-2026-08-27.v1");
    expect(extractionResultSchema.parse(result.extraction)).toEqual(validModelOutput);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(request?.systemInstruction).toMatch(/untrusted/i);
    expect(request?.systemInstruction).toMatch(/ignore.*instructions/i);
    expect(request?.tools).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/prompt|reasoning|apiKey|unit-test-placeholder/i);
  });

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

    await expect(provider.extract({ document, requestedFields })).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("normalizes a complete out-of-order provider array into requested field order", async () => {
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
      generate: async () => ({
        output: { fields: [...validModelOutput.fields].reverse() },
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

    await expect(provider.extract({ document, requestedFields })).rejects.toMatchObject({ name: "ZodError" });
  });

  it.each([
    [429, "provider_rate_limited"],
    [503, "provider_unavailable"],
    [401, "provider_auth_failed"],
  ] as const)("maps a live adapter HTTP %s failure to %s", async (status, safeCode) => {
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
      generate: async () => {
        throw { statusCode: status };
      },
    });

    await expect(provider.extract({ document, requestedFields })).rejects.toMatchObject({
      safeCode,
      httpStatus: status,
    });
  });

  it("passes the workflow abort signal into the selected live adapter", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
      generate: async (request) => {
        observedSignal = request.signal;
        return {
          output: validModelOutput,
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        };
      },
    });

    await provider.extract({ document, requestedFields, signal: controller.signal });

    expect(observedSignal).toBe(controller.signal);
  });
});
