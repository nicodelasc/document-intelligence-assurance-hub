import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "migrations/0010_source_origin_status.sql";

describe("source origin status migration", () => {
  it("adds and backfills the bounded source origin column idempotently", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS source_origin_status TEXT/);
    expect(migration).toMatch(/WHEN source_type = 'synthetic' THEN 'server_original'/);
    expect(migration).toMatch(/ELSE 'unverified'/);
    expect(migration).toMatch(/ALTER COLUMN source_origin_status SET NOT NULL/);
    expect(migration).toMatch(/runs_source_origin_status_check/);
    expect(migration).toMatch(
      /source_origin_status IN \('server_original', 'recognized_copy', 'unverified'\)/,
    );
    expect(migration).toMatch(/pg_constraint/);
    expect(migration).toMatch(/VALUES \('0010_source_origin_status'\)/);
    expect(migration).toMatch(/ON CONFLICT \(version\) DO NOTHING/);
  });
});
