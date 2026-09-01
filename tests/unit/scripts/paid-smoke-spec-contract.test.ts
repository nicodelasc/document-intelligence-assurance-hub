import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("paid smoke spec wiring", () => {
  it("keeps explicit opt-in, serial mode and zero Playwright retries", async () => {
    const source = await readFile(
      join(process.cwd(), "tests", "e2e", "live-production-smoke.spec.ts"),
      "utf8",
    );

    expect(source).toMatch(
      /test\.skip\(\s*process\.env\.RUN_PAID_SMOKE !== "1",\s*"paid smoke requires explicit opt-in",?\s*\);/,
    );
    expect(source).toContain(
      "test.describe.configure(PAID_SMOKE_DESCRIBE_OPTIONS);",
    );
  });

  it("creates one fresh browser context and one request guard per provider test", async () => {
    const source = await readFile(
      join(process.cwd(), "tests", "e2e", "live-production-smoke.spec.ts"),
      "utf8",
    );

    expect(source.match(/await browser\.newContext\(/g)).toHaveLength(2);
    expect(
      source.match(/createPaidSmokeRequestGuard\(\{[\s\S]*?\}\)/g),
    ).toHaveLength(2);
    expect(
      source.match(/expect\(guard\.submittedRuns\(\)\)\.toBe\(1\)/g),
    ).toHaveLength(2);
  });

  it("routes every submitted run through the bounded provider-attempt header guard", async () => {
    const source = await readFile(
      join(process.cwd(), "tests", "e2e", "live-production-smoke.spec.ts"),
      "utf8",
    );

    expect(source.match(/page\.route\("\*\*\/api\/runs"/g)).toHaveLength(2);
    expect(source).toContain("readProviderAttemptLimitHeader");
  });

  it("reads only the named attempt header for smoke diagnostics", async () => {
    const source = await readFile(
      join(process.cwd(), "tests", "e2e", "live-production-smoke.spec.ts"),
      "utf8",
    );

    expect(source).toContain(
      "readProviderAttemptLimitHeader(input.response.request())",
    );
    expect(source).not.toContain(".allHeaders()");
  });

  it("observes the consumed stream without reading its response body twice", async () => {
    const source = await readFile(
      join(process.cwd(), "tests", "e2e", "live-production-smoke.spec.ts"),
      "utf8",
    );

    expect(source).toContain("idempotentRunId");
    expect(source).toMatch(/expect\s*\.poll/);
    expect(source).toContain('getByText("Review complete", { exact: true })');
    expect(source).not.toContain("input.response.finished()");
    expect(source).not.toContain("input.response.text()");
    expect(source).not.toContain("terminalEvent(");
  });

  it("allows the model catalogue to cold start without permitting a paid retry", async () => {
    const source = await readFile(
      join(process.cwd(), "tests", "e2e", "live-production-smoke.spec.ts"),
      "utf8",
    );

    expect(
      source.match(/toBeEnabled\(\{\s*timeout: 30_000,?\s*\}\)/g),
    ).toHaveLength(2);
  });
});
