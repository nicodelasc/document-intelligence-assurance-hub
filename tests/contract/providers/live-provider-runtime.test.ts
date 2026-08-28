import { beforeEach, describe, expect, it, vi } from "vitest";

const { createOpenAIMock, generateTextMock } = vi.hoisted(() => ({
  createOpenAIMock: vi.fn(),
  generateTextMock: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: generateTextMock };
});

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: createOpenAIMock,
}));

import {
  LIVE_PROVIDER_TIMEOUT_MS,
  createOpenAIExtractionProvider,
} from "@/server/workflow/live-provider";
import { MAX_PROVIDER_OUTPUT_TOKENS } from "@/domain/pricing";

const requestedFields = [
  { key: "vendor_name", label: "Vendor name" },
  { key: "invoice_total", label: "Invoice total" },
];

const modelOutput = {
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
      key: "invoice_total",
      label: "Invoice total",
      extractedValue: "1250.00 SGD",
      normalizedValue: "1250.00 SGD",
      evidence: "Total due: 1250.00 SGD",
      page: 1,
    },
  ],
};

describe("default live provider runtime contract", () => {
  beforeEach(() => {
    createOpenAIMock.mockReset();
    createOpenAIMock.mockImplementation(() => (model: string) => ({
      provider: "openai",
      model,
    }));
    generateTextMock.mockReset();
    generateTextMock.mockResolvedValue({
      output: modelOutput,
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  it("delegates retry ownership to the workflow and bounds one SDK call", async () => {
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
    });

    await provider.extract({
      document: {
        filename: "sample.pdf",
        mediaType: "application/pdf",
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      },
      requestedFields,
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock.mock.calls[0]?.[0]).toMatchObject({
      maxRetries: 0,
      maxOutputTokens: MAX_PROVIDER_OUTPUT_TOKENS,
      timeout: { totalMs: LIVE_PROVIDER_TIMEOUT_MS },
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("signals dispatch after SDK client construction and before generation", async () => {
    const order: string[] = [];
    createOpenAIMock.mockImplementationOnce(() => {
      order.push("client");
      return (model: string) => ({ provider: "openai", model });
    });
    generateTextMock.mockImplementationOnce(async () => {
      order.push("generation");
      return {
        output: modelOutput,
        usage: { inputTokens: 120, outputTokens: 30 },
      };
    });
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
    });

    await provider.extract({
      document: {
        filename: "sample.pdf",
        mediaType: "application/pdf",
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      },
      requestedFields,
      onDispatch: async () => {
        order.push("dispatch");
      },
    });

    expect(order).toEqual(["client", "dispatch", "generation"]);
  });

  it("does not signal dispatch when SDK client construction fails", async () => {
    createOpenAIMock.mockImplementationOnce(() => {
      throw new Error("sdk-client-construction-failed");
    });
    const onDispatch = vi.fn();
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
    });

    await expect(
      provider.extract({
        document: {
          filename: "sample.pdf",
          mediaType: "application/pdf",
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        },
        requestedFields,
        onDispatch,
      }),
    ).rejects.toMatchObject({ safeCode: "provider_failed" });
    expect(onDispatch).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("does not invoke the SDK after cancellation during dispatch persistence", async () => {
    const controller = new AbortController();
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
    });

    await expect(
      provider.extract({
        document: {
          filename: "sample.pdf",
          mediaType: "application/pdf",
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        },
        requestedFields,
        signal: controller.signal,
        onDispatch: async () => {
          controller.abort("reviewer_cancelled");
        },
      }),
    ).rejects.toMatchObject({ safeCode: "provider_failed" });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("marks absent SDK usage as untrustworthy for exact budget settlement", async () => {
    generateTextMock.mockResolvedValueOnce({
      output: modelOutput,
      usage: { inputTokens: undefined, outputTokens: undefined },
    });
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
    });

    const result = await provider.extract({
      document: {
        filename: "sample.pdf",
        mediaType: "application/pdf",
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      },
      requestedFields,
    });

    expect(result).toMatchObject({
      usage: { inputTokens: 0, outputTokens: 0 },
      usageTrustworthy: false,
    });
  });

  it.each([
    {
      label: "fractional",
      usage: { inputTokens: 120.5, outputTokens: 30 },
    },
    {
      label: "unsafe",
      usage: {
        inputTokens: Number.MAX_SAFE_INTEGER + 1,
        outputTokens: 30,
      },
    },
    {
      label: "over-output-limit",
      usage: { inputTokens: 120, outputTokens: 2_001 },
    },
    {
      label: "over-context-limit",
      usage: { inputTokens: 1_050_000, outputTokens: 1_001 },
    },
  ])("marks $label SDK usage as untrustworthy", async ({ usage }) => {
    generateTextMock.mockResolvedValueOnce({ output: modelOutput, usage });
    const provider = createOpenAIExtractionProvider({
      liveEnabled: true,
      apiKey: "unit-test-placeholder",
    });

    const result = await provider.extract({
      document: {
        filename: "sample.pdf",
        mediaType: "application/pdf",
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      },
      requestedFields,
    });

    expect(result).toMatchObject({
      usage: { inputTokens: 0, outputTokens: 0 },
      usageTrustworthy: false,
    });
  });
});
