import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("versioned production migration", () => {
  const migration = readFileSync("migrations/0001_assurance_hub.sql", "utf8");
  const lifecycleMigrationPath = "migrations/0002_provider_lifecycle.sql";
  const lifecycleMigration = existsSync(lifecycleMigrationPath)
    ? readFileSync(lifecycleMigrationPath, "utf8")
    : "";
  const sourceOriginMigrationPath = "migrations/0010_source_origin_status.sql";
  const sourceOriginMigration = existsSync(sourceOriginMigrationPath)
    ? readFileSync(sourceOriginMigrationPath, "utf8")
    : "";

  it("is idempotent and records its version", () => {
    expect(migration).toMatch(/BEGIN;/);
    expect(migration).toMatch(/COMMIT;/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS schema_migrations/);
    expect(migration).toMatch(/VALUES \('0001_assurance_hub'\)/);
    expect(migration).toMatch(/ON CONFLICT \(version\) DO NOTHING/);
  });

  it.each([
    "runs",
    "run_steps",
    "run_results",
    "daily_usage",
    "model_budget_reservations",
    "document_cleanup_jobs",
    "run_submission_claims",
  ])("creates the %s table", (table) => {
    expect(migration).toMatch(
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`),
    );
  });

  it("installs atomic quota reservation and settlement functions", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION reserve_daily_quota/);
    expect(migration).toMatch(/SELECT \* INTO usage_record[\s\S]*FOR UPDATE/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION settle_daily_quota/);
  });

  it("adds expiring pending leases and atomically excludes stale reservations", () => {
    expect(existsSync(lifecycleMigrationPath)).toBe(true);
    expect(lifecycleMigration).toMatch(
      /ADD COLUMN IF NOT EXISTS expires_at timestamptz/,
    );
    expect(lifecycleMigration).toMatch(
      /status = 'pending'[\s\S]*expires_at <= p_now/,
    );
    expect(lifecycleMigration).toMatch(
      /status = 'pending'[\s\S]*expires_at > p_now/,
    );
    expect(lifecycleMigration).toMatch(/VALUES \('0002_provider_lifecycle'\)/);
  });

  it("keeps routine repository and quota code free of schema DDL", () => {
    const runtime = [
      readFileSync("src/server/repositories/run-repository.ts", "utf8"),
      readFileSync("src/server/security/rate-limit.ts", "utf8"),
    ].join("\n");

    expect(runtime).not.toMatch(
      /CREATE TABLE|ALTER TABLE|CREATE OR REPLACE FUNCTION/i,
    );
  });

  it("adds an idempotent bounded source origin status migration", () => {
    expect(existsSync(sourceOriginMigrationPath)).toBe(true);
    expect(sourceOriginMigration).toMatch(/ADD COLUMN IF NOT EXISTS source_origin_status TEXT/);
    expect(sourceOriginMigration).toMatch(/runs_source_origin_status_check/);
    expect(sourceOriginMigration).toMatch(/VALUES \('0010_source_origin_status'\)/);
  });
});
