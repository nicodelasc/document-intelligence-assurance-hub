import type { Provider } from "@/domain/types";
import { recordedRunResults } from "@/domain/fixtures";
import {
  validateExtractionForRequest,
  type ExtractionProvider,
  type ProviderExtractionInput,
  type ProviderExtractionResponse,
} from "@/server/workflow/provider";

type FixtureId = (typeof recordedRunResults)[number]["invoiceId"];

const defaultModels: Record<Provider, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-haiku-4-5",
};

export function createRecordedExtractionProvider(input: {
  provider: Provider;
  fixtureId: FixtureId;
  model?: string;
}): ExtractionProvider {
  const fixture = recordedRunResults.find((result) => result.invoiceId === input.fixtureId);
  if (!fixture) throw new Error("recorded_fixture_not_found");

  return {
    provider: input.provider,
    model: input.model ?? defaultModels[input.provider],
    promptVersion: "recorded-fixture-2026-08-27.v1",
    executionMode: "recorded",
    async extract(request: ProviderExtractionInput): Promise<ProviderExtractionResponse> {
      const extraction = {
        fields: request.requestedFields.map((requestedField) => {
          const field = fixture.fields.find((candidate) => candidate.key === requestedField.key);
          return {
            key: requestedField.key,
            label: requestedField.label,
            extractedValue: field?.extractedValue ?? null,
            normalizedValue: field?.normalizedValue ?? null,
            evidence: field?.evidence ?? null,
            page: field?.page ?? null,
          };
        }),
      };

      return {
        extraction: validateExtractionForRequest(extraction, request.requestedFields),
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
      };
    },
  };
}
