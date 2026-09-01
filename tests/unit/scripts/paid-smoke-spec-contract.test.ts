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
    expect(source.match(/createPaidSmokeRequestGuard\(\)/g)).toHaveLength(2);
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
    expect(source).toContain("PROVIDER_ATTEMPT_LIMIT_HEADER");
  });
});
