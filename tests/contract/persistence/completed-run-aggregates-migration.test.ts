import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("completed run aggregates migration", () => {
  const migrationPath = "migrations/0009_completed_run_aggregates.sql";
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8")
    : "";

  it("preserves completion time and indexes confirmed completed model runs", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(
      /ALTER TABLE runs\s+ADD COLUMN IF NOT EXISTS completed_at timestamptz;/,
    );
    expect(migration).toMatch(
      /UPDATE runs\s+SET completed_at = COALESCE\([\s\S]+result_json ->> 'completedAt'[\s\S]+created_at[\s\S]+WHERE was_completed = true\s+AND completed_at IS NULL;/,
    );
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS runs_confirmed_model_cost_idx\s+ON runs \(completed_at, provider, model\)\s+WHERE was_completed = true AND provider_dispatched = true;/,
    );
    expect(migration).toMatch(/VALUES \('0009_completed_run_aggregates'\)/);
    expect(migration).toMatch(/ON CONFLICT \(version\) DO NOTHING/);
    expect(migration).toMatch(/COMMIT;\s*$/);
  });

  it("guards malformed legacy result timestamps before casting", () => {
    expect(migration).toMatch(
      /result_json ->> 'completedAt' ~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}T'/,
    );
  });
});
