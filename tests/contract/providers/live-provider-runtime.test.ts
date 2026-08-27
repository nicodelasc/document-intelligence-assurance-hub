import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: generateTextMock };
});

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (model: string) => ({ provider: "openai", model }),
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
});
