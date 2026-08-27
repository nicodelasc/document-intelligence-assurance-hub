import type { Provider } from "./types";

export const pricingAsOf = "2026-08-27";
export const MAX_PROVIDER_OUTPUT_TOKENS = 2_000;
export const MAX_LIVE_PROVIDER_ATTEMPTS = 2;

type LiveModelPolicy = {
  provider: Provider;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  contextWindowTokens: number;
};

const liveModelPolicies = {
  "gpt-5-mini": {
    provider: "openai",
    inputPerMillionUsd: 0.25,
    outputPerMillionUsd: 2,
    contextWindowTokens: 400_000,
  },
  "claude-haiku-4-5": {
    provider: "anthropic",
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 5,
    contextWindowTokens: 200_000,
  },
} as const satisfies Record<string, LiveModelPolicy>;

export type SupportedLiveModel = keyof typeof liveModelPolicies;

export function requireSupportedLiveModel(
  provider: Provider,
  model: string,
): LiveModelPolicy {
  const policy = liveModelPolicies[model as SupportedLiveModel];
  if (!policy || policy.provider !== provider)
    throw new Error("unsupported_live_model");
  return policy;
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
  estimateMaximumLiveRunCost("openai", "gpt-5-mini"),
  estimateMaximumLiveRunCost("anthropic", "claude-haiku-4-5"),
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
