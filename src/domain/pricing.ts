import {
  defaultModelForProvider,
  liveModelCatalog,
  pricingAsOf,
  requireEnabledModel,
  type LiveModelDefinition,
  type LiveModelId,
} from "./live-model-catalog";
import type { Provider } from "./types";

export { pricingAsOf };
export const MAX_PROVIDER_OUTPUT_TOKENS = 2_000;
export const MAX_LIVE_PROVIDER_ATTEMPTS = 2;

export type SupportedLiveModel = LiveModelId;

export function requireSupportedLiveModel(
  provider: Provider,
  model: string,
): LiveModelDefinition {
  return requireEnabledModel(provider, model);
}

export function estimateMaximumLiveRunCost(
  provider: Provider,
  model: string,
): number {
  const policy = requireSupportedLiveModel(provider, model);
  const maximumInputTokens =
    policy.contextWindowTokens - MAX_PROVIDER_OUTPUT_TOKENS;
  return (
    ((maximumInputTokens * policy.inputPerMillionUsd +
      MAX_PROVIDER_OUTPUT_TOKENS * policy.outputPerMillionUsd) /
      1_000_000) *
    MAX_LIVE_PROVIDER_ATTEMPTS
  );
}

export const MAX_SUPPORTED_LIVE_RUN_COST_USD = Math.max(
  ...liveModelCatalog.map((model) =>
    estimateMaximumLiveRunCost(model.provider, model.id),
  ),
);

export const DEFAULT_LIVE_MODEL_RESERVATION_USD = Math.max(
  estimateMaximumLiveRunCost(
    "openai",
    defaultModelForProvider("openai"),
  ),
  estimateMaximumLiveRunCost(
    "anthropic",
    defaultModelForProvider("anthropic"),
  ),
);

export function estimateRunCost(input: {
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const policy = requireSupportedLiveModel(input.provider, input.model);
  return (
    (input.inputTokens * policy.inputPerMillionUsd +
      input.outputTokens * policy.outputPerMillionUsd) /
    1_000_000
  );
}
