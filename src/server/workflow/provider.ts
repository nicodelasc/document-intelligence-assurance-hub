import { z } from "zod";
import type { Provider } from "@/domain/types";
import type { ExecutionMode, RequestedField, TokenUsage } from "@/server/repositories/run-repository";

export const extractedFieldSchema = z
  .object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    extractedValue: z.string().max(500).nullable(),
    normalizedValue: z.string().max(500).nullable(),
    evidence: z.string().max(600).nullable(),
    page: z.number().int().positive().nullable(),
  })
  .strict();

export const extractionResultSchema = z
  .object({
    fields: z.array(extractedFieldSchema),
  })
  .strict();

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type ExtractedField = z.infer<typeof extractedFieldSchema>;

export type ProviderDocument = {
  filename: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg" | string;
  bytes: Uint8Array;
};

export type ProviderExtractionInput = {
  document: ProviderDocument;
  requestedFields: RequestedField[];
  signal?: AbortSignal;
};

export type ProviderExtractionResponse = {
  extraction: ExtractionResult;
  usage: TokenUsage;
  latencyMs: number;
};

export interface ExtractionProvider {
  readonly provider: Provider;
  readonly model: string;
  readonly promptVersion: string;
  readonly executionMode: ExecutionMode;
  extract(input: ProviderExtractionInput): Promise<ProviderExtractionResponse>;
}

export class ProviderRequestError extends Error {
  readonly name: string = "ProviderRequestError";

  constructor(
    readonly safeCode: string,
    readonly httpStatus: number | null,
    options?: ErrorOptions,
  ) {
    super(safeCode, options);
  }
}

export function validateExtractionForRequest(
  value: unknown,
  requestedFields: RequestedField[],
): ExtractionResult {
  const parsed = extractionResultSchema.parse(value);
  const fieldsByKey = new Map(parsed.fields.map((field) => [field.key, field]));
  if (fieldsByKey.size !== requestedFields.length || parsed.fields.length !== requestedFields.length) {
    throw new ProviderRequestError("provider_schema_mismatch", null);
  }
  return {
    fields: requestedFields.map((requestedField) => {
      const field = fieldsByKey.get(requestedField.key);
      if (!field) throw new ProviderRequestError("provider_schema_mismatch", null);
      return { ...field, key: requestedField.key, label: requestedField.label };
    }),
  };
}

export function isRetryableProviderError(error: unknown): boolean {
  if (!(error instanceof ProviderRequestError) || error.httpStatus === null) return false;
  return error.httpStatus === 429 || (error.httpStatus >= 500 && error.httpStatus <= 599);
}
