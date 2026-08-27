import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deployment-wide public resource controls migration", () => {
  const migration = readFileSync(
    "migrations/0003_public_resource_controls.sql",
    "utf8",
  );

  it("records an idempotent versioned migration", () => {
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public_rate_limit_windows/);
    expect(migration).toMatch(/VALUES \('0003_public_resource_controls'\)/);
    expect(migration).toMatch(/ON CONFLICT \(version\) DO NOTHING/);
    expect(migration).toMatch(/COMMIT;\s*$/);
  });

  it("locks one global row before the caller bucket and consumes both atomically", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION consume_public_resource_limit/,
    );
    expect(migration).toMatch(
      /scope = 'global'[\s\S]*FOR UPDATE;[\s\S]*scope = 'bucket'[\s\S]*FOR UPDATE;/,
    );
    expect(migration).toMatch(
      /IF global_count >= p_global_limit OR bucket_count >= p_bucket_limit THEN[\s\S]*RETURN false;/,
    );
    expect(migration).toMatch(
      /SET request_count = request_count \+ 1[\s\S]*scope = 'global'[\s\S]*SET request_count = request_count \+ 1[\s\S]*scope = 'bucket'/,
    );
  });
});
