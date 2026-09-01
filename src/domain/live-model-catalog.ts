import type { Provider } from "./types";

export const pricingAsOf = "2026-09-01" as const;

export type LiveModelId =
  | "gpt-5.6-luna"
  | "gpt-5.6-terra"
  | "claude-haiku-4-5"
  | "claude-sonnet-5";

export const gpt56LongContextPricing = Object.freeze({
  inputTokenThreshold: 272_000,
  inputMultiplier: 2,
  outputMultiplier: 1.5,
});

export type LongContextPricing = typeof gpt56LongContextPricing;

export interface LiveModelDefinition {
  id: LiveModelId;
  provider: Provider;
  displayName: string;
  recommended: boolean;
  contextWindowTokens: number;
  pricingAsOf: typeof pricingAsOf;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  longContextPricing: LongContextPricing | null;
}

export const liveModelCatalog: readonly LiveModelDefinition[] = Object.freeze([
  Object.freeze({
    id: "gpt-5.6-luna",
    provider: "openai",
    displayName: "GPT-5.6 Luna",
    recommended: true,
    contextWindowTokens: 1_050_000,
    pricingAsOf,
    inputPerMillionUsd: 0.2,
    outputPerMillionUsd: 1.2,
    longContextPricing: gpt56LongContextPricing,
  }),
  Object.freeze({
    id: "gpt-5.6-terra",
    provider: "openai",
    displayName: "GPT-5.6 Terra",
    recommended: false,
    contextWindowTokens: 1_050_000,
    pricingAsOf,
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 12,
    longContextPricing: gpt56LongContextPricing,
  }),
  Object.freeze({
    id: "claude-haiku-4-5",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    recommended: true,
    contextWindowTokens: 200_000,
    pricingAsOf,
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 5,
    longContextPricing: null,
  }),
  Object.freeze({
    id: "claude-sonnet-5",
    provider: "anthropic",
    displayName: "Claude Sonnet 5",
    recommended: false,
    contextWindowTokens: 1_000_000,
    pricingAsOf,
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 10,
    longContextPricing: null,
  }),
]);

export function requireEnabledModel(
  provider: Provider,
  model: string,
): LiveModelDefinition {
  const definition = liveModelCatalog.find(
    (candidate) => candidate.id === model && candidate.provider === provider,
  );
  if (!definition) throw new Error("unsupported_live_model");
  return definition;
}

export function defaultModelForProvider(provider: Provider): LiveModelId {
  const model = liveModelCatalog.find(
    (candidate) => candidate.provider === provider && candidate.recommended,
  );
  if (!model) throw new Error("unsupported_live_model");
  return model.id;
}
