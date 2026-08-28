import {
  defaultModelForProvider,
  liveModelCatalog,
} from "@/domain/live-model-catalog";
import { noIndexHeaders, safeJsonResponse } from "@/server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return safeJsonResponse(
    {
      models: liveModelCatalog.map((model) => ({
        id: model.id,
        provider: model.provider,
        displayName: model.displayName,
        recommended: model.recommended,
        contextWindowTokens: model.contextWindowTokens,
        pricingAsOf: model.pricingAsOf,
        inputPerMillionUsd: model.inputPerMillionUsd,
        outputPerMillionUsd: model.outputPerMillionUsd,
      })),
      defaults: {
        openai: defaultModelForProvider("openai"),
        anthropic: defaultModelForProvider("anthropic"),
      },
    },
    { status: 200, headers: noIndexHeaders },
  );
}
