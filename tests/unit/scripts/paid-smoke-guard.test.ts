import { describe, expect, it, vi } from "vitest";
import type { Route } from "@playwright/test";
import {
  PAID_SMOKE_DESCRIBE_OPTIONS,
  PROVIDER_ATTEMPT_LIMIT_HEADER,
  createPaidSmokeRequestGuard,
  paidSmokeEnabled,
  readProviderAttemptLimitHeader,
} from "../../e2e/support/paid-smoke-guard";

function routeDouble(input: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  postData?: string;
}) {
  const continueRequest = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const route = {
    request: () => ({
      method: () => input.method ?? "POST",
      url: () => input.url ?? "https://example.test/api/runs",
      headers: () => input.headers ?? { accept: "application/x-ndjson" },
      postDataBuffer: () =>
        input.postData === undefined ? null : Buffer.from(input.postData),
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

  it("blocks a paid request whose multipart provider does not match the intended test", async () => {
    const guard = createPaidSmokeRequestGuard({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
    const request = routeDouble({
      postData: [
        'Content-Disposition: form-data; name="provider"',
        "",
        "openai",
        'Content-Disposition: form-data; name="model"',
        "",
        "gpt-5.6-luna",
      ].join("\r\n"),
    });

    await expect(guard.handle(request.route)).rejects.toThrow(
      "paid_smoke_configuration_mismatch",
    );

    expect(request.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(request.continueRequest).not.toHaveBeenCalled();
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

  it("keeps unrelated sensitive headers out of a failed marker assertion", async () => {
    const cookieSentinel = "diah_browser=sentinel-cookie-value";
    const authorizationSentinel = "Bearer sentinel-authorization-value";
    const allHeaders = vi.fn(async () => ({
      cookie: cookieSentinel,
      authorization: authorizationSentinel,
      [PROVIDER_ATTEMPT_LIMIT_HEADER]: "2",
    }));
    const headerValue = vi.fn(async (name: string) =>
      name === PROVIDER_ATTEMPT_LIMIT_HEADER ? "2" : null,
    );
    const received = await readProviderAttemptLimitHeader({ headerValue });
    let diagnostic = "";
    try {
      expect(received).toBe("1");
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
    }

    expect(headerValue).toHaveBeenCalledWith(PROVIDER_ATTEMPT_LIMIT_HEADER);
    expect(allHeaders).not.toHaveBeenCalled();
    expect(diagnostic).not.toContain(cookieSentinel);
    expect(diagnostic).not.toContain(authorizationSentinel);
  });
});
