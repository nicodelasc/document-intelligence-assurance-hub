import type { Provider } from "./types";

export const pricingAsOf = "2026-08-27";

const ratesPerMillion: Record<Provider, { input: number; output: number }> = {
  openai: { input: 0.25, output: 2 },
  anthropic: { input: 1, output: 5 },
};

export function estimateRunCost(input: {
  provider: Provider;
  inputTokens: number;
  outputTokens: number;
}): number {
  const rates = ratesPerMillion[input.provider];
  return (input.inputTokens * rates.input + input.outputTokens * rates.output) / 1_000_000;
}
