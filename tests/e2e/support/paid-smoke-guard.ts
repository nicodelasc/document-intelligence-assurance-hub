import type { Request, Route } from "@playwright/test";

export const PROVIDER_ATTEMPT_LIMIT_HEADER = "x-provider-attempt-limit";

export const PAID_SMOKE_DESCRIBE_OPTIONS = {
  mode: "serial",
  retries: 0,
} as const;

export async function readProviderAttemptLimitHeader(
  request: Pick<Request, "headerValue">,
): Promise<string | null> {
  return request.headerValue(PROVIDER_ATTEMPT_LIMIT_HEADER);
}

export function paidSmokeEnabled(
  environment: Record<string, string | undefined>,
): boolean {
  return environment.RUN_PAID_SMOKE === "1";
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasMultipartField(body: string, name: string, value: string): boolean {
  return new RegExp(
    `name="${escapePattern(name)}"\\r?\\n\\r?\\n${escapePattern(value)}(?:\\r?\\n|$)`,
  ).test(body);
}

export function createPaidSmokeRequestGuard(expected?: {
  provider: "openai" | "anthropic";
  model: string;
}) {
  let submittedRuns = 0;

  return {
    async handle(route: Route): Promise<void> {
      const request = route.request();
      const isRunSubmission =
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/api/runs");
      if (!isRunSubmission) {
        await route.continue();
        return;
      }

      submittedRuns += 1;
      if (submittedRuns > 1) {
        await route.abort("blockedbyclient");
        throw new Error("paid_smoke_request_limit");
      }

      if (expected) {
        const body = request.postDataBuffer()?.toString("utf8") ?? "";
        const configurationMatches =
          hasMultipartField(body, "provider", expected.provider) &&
          hasMultipartField(body, "model", expected.model);
        if (!configurationMatches) {
          await route.abort("blockedbyclient");
          throw new Error("paid_smoke_configuration_mismatch");
        }
      }

      await route.continue({
        headers: {
          ...request.headers(),
          [PROVIDER_ATTEMPT_LIMIT_HEADER]: "1",
        },
      });
    },
    submittedRuns: () => submittedRuns,
  };
}
