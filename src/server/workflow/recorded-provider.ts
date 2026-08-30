import type { Provider } from "@/domain/types";
import {
  defaultModelForProvider,
  requireEnabledModel,
} from "@/domain/live-model-catalog";
import {
  recordedDocumentRunResults,
  syntheticFixtures,
} from "@/domain/fixtures";
import {
  validateExtractionForRequest,
  type ExtractionProvider,
  type ProviderExtractionInput,
  type ProviderExtractionResponse,
} from "@/server/workflow/provider";

type FixtureId = (typeof syntheticFixtures)[number]["id"];

export function createRecordedExtractionProvider(input: {
  provider: Provider;
  fixtureId: FixtureId;
  model?: string;
}): ExtractionProvider {
  const fixture = recordedDocumentRunResults.find(
    (result) => result.fixtureId === input.fixtureId,
  );
  const metadata = syntheticFixtures.find(
    (candidate) => candidate.id === input.fixtureId,
  );
  if (!fixture || !metadata) throw new Error("recorded_fixture_not_found");
  const model = input.model ?? defaultModelForProvider(input.provider);
  requireEnabledModel(input.provider, model);

  return {
    provider: input.provider,
    model,
    promptVersion: "recorded-fixture-2026-08-27.v1",
    executionMode: "recorded",
    async extract(request: ProviderExtractionInput): Promise<ProviderExtractionResponse> {
      request.signal?.throwIfAborted();
      const extraction = {
        classification: metadata.family,
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
        documentInstruction: metadata.action.instructionEvidence,
        action: {
          ...metadata.action,
          payload: metadata.action.payload.map((entry) => ({ ...entry })),
        },
      };

      return {
        extraction: validateExtractionForRequest(extraction, request.requestedFields),
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
      };
    },
  };
}
