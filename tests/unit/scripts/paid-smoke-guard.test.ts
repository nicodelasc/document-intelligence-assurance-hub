import { describe, expect, it, vi } from "vitest";
import type { Route } from "@playwright/test";
import {
  PAID_SMOKE_DESCRIBE_OPTIONS,
  PROVIDER_ATTEMPT_LIMIT_HEADER,
  createPaidSmokeRequestGuard,
  paidSmokeEnabled,
} from "../../e2e/support/paid-smoke-guard";

function routeDouble(input: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}) {
  const continueRequest = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const route = {
    request: () => ({
      method: () => input.method ?? "POST",
      url: () => input.url ?? "https://example.test/api/runs",
      headers: () => input.headers ?? { accept: "application/x-ndjson" },
    }),
    continue: continueRequest,
    abort,
  } as unknown as Route;
  return { route, continueRequest, abort };
}

describe("paid smoke safeguards", () => {
  it("enables paid smoke only for the exact opt-in value", () => {
    expect(paidSmokeEnabled({ RUN_PAID_SMOKE: "1" })).toBe(true);
    expect(paidSmokeEnabled({})).toBe(false);
    expect(paidSmokeEnabled({ RUN_PAID_SMOKE: "true" })).toBe(false);
  });

  it("exposes serial mode with zero Playwright retries", () => {
    expect(PAID_SMOKE_DESCRIBE_OPTIONS).toEqual({
      mode: "serial",
      retries: 0,
    });
  });

  it("adds the one-attempt header before the first run submission continues", async () => {
    const guard = createPaidSmokeRequestGuard();
    const first = routeDouble({ headers: { accept: "application/x-ndjson" } });

    await guard.handle(first.route);

    expect(first.abort).not.toHaveBeenCalled();
    expect(first.continueRequest).toHaveBeenCalledWith({
      headers: {
        accept: "application/x-ndjson",
        [PROVIDER_ATTEMPT_LIMIT_HEADER]: "1",
      },
    });
    expect(guard.submittedRuns()).toBe(1);
  });

  it("aborts and fails before a second run submission reaches the network", async () => {
    const guard = createPaidSmokeRequestGuard();
    const first = routeDouble({});
    const second = routeDouble({});

    await guard.handle(first.route);
    await expect(guard.handle(second.route)).rejects.toThrow(
      "paid_smoke_request_limit",
    );

    expect(second.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(second.continueRequest).not.toHaveBeenCalled();
    expect(guard.submittedRuns()).toBe(2);
  });

  it("keeps each test guard counter independent", async () => {
    const openaiGuard = createPaidSmokeRequestGuard();
    const anthropicGuard = createPaidSmokeRequestGuard();

    await openaiGuard.handle(routeDouble({}).route);
    await anthropicGuard.handle(routeDouble({}).route);

    expect(openaiGuard.submittedRuns()).toBe(1);
    expect(anthropicGuard.submittedRuns()).toBe(1);
  });

  it("does not count or mark non-submission requests", async () => {
    const guard = createPaidSmokeRequestGuard();
    const read = routeDouble({ method: "GET" });

    await guard.handle(read.route);

    expect(read.continueRequest).toHaveBeenCalledWith();
    expect(guard.submittedRuns()).toBe(0);
  });
});
