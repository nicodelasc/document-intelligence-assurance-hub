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

  it("keeps the pre-source-origin run insert compatible through a conservative default", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const preChangeInsertColumns = [
      "id",
      "provider",
      "model",
      "execution_mode",
      "source_type",
      "file_metadata",
      "document_key",
      "requested_fields",
      "status",
      "outcome",
      "usage",
      "estimated_cost_usd",
      "consent",
      "created_at",
      "expires_at",
      "deleted_at",
      "deletion_token_hash",
      "retry_count",
      "latency_ms",
      "step_durations",
      "prompt_version",
      "provider_dispatched",
      "document_family",
      "fixture_id",
      "completed_at",
    ];
    const defaultPosition = migration.indexOf(
      "ALTER COLUMN source_origin_status SET DEFAULT 'unverified'",
    );
    const notNullPosition = migration.indexOf(
      "ALTER COLUMN source_origin_status SET NOT NULL",
    );

    expect(preChangeInsertColumns).not.toContain("source_origin_status");
    expect(defaultPosition).toBeGreaterThan(-1);
    expect(defaultPosition).toBeLessThan(notNullPosition);
    expect(migration).not.toMatch(
      /ALTER COLUMN source_origin_status DROP DEFAULT/,
    );
  });
});
