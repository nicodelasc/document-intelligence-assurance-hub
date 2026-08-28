import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("provider dispatch attribution migration", () => {
  const migrationPath = "migrations/0007_provider_dispatch_attribution.sql";
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8")
    : "";

  it("records one idempotent migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS provider_dispatched boolean NOT NULL DEFAULT false/,
    );
    expect(migration).toMatch(
      /VALUES \('0007_provider_dispatch_attribution'\)/,
    );
    expect(migration).toMatch(/ON CONFLICT \(version\) DO NOTHING/);
    expect(migration).toMatch(/COMMIT;\s*$/);
  });
});
