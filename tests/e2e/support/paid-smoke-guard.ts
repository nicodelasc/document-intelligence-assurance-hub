import type { Route } from "@playwright/test";

export const PROVIDER_ATTEMPT_LIMIT_HEADER = "x-provider-attempt-limit";

export const PAID_SMOKE_DESCRIBE_OPTIONS = {
  mode: "serial",
  retries: 0,
} as const;

export function paidSmokeEnabled(
  environment: Record<string, string | undefined>,
): boolean {
  return environment.RUN_PAID_SMOKE === "1";
}

export function createPaidSmokeRequestGuard() {
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
