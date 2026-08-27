import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("conservative provider budget migration", () => {
  const migrationPath = "migrations/0004_conservative_provider_budget.sql";
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8")
    : "";

  it("records one idempotent migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/VALUES \('0004_conservative_provider_budget'\)/);
    expect(migration).toMatch(/ON CONFLICT \(version\) DO NOTHING/);
    expect(migration).toMatch(/COMMIT;\s*$/);
  });

  it("settles one reservation from the stored reserved amount", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION settle_reserved_daily_quota/,
    );
    expect(migration).toMatch(
      /actual_cost_usd = reservation_record\.reserved_cost_usd/,
    );
    expect(migration).toMatch(
      /global_spend_usd = global_spend_usd \+ reservation_record\.reserved_cost_usd/,
    );
  });

  it("reconciles every expired pending lease into daily spend", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION reconcile_stale_daily_quota/,
    );
    expect(migration).toMatch(
      /status = 'settled'[^;]*actual_cost_usd = reserved_cost_usd[\s\S]*status = 'pending'[\s\S]*expires_at <= p_now/,
    );
    expect(migration).toMatch(
      /global_spend_usd = global_spend_usd \+ day_reconciled_cost/,
    );
    expect(migration).not.toMatch(
      /status = 'released'[^;]*expires_at <= p_now/,
    );
    expect(migration).toMatch(/usage_day <= p_day/);
    expect(migration).not.toMatch(
      /WHERE usage_day = p_day\s+AND status = 'pending'\s+AND expires_at <= p_now/,
    );
  });

  it("rejects null and non-finite exact settlement costs", () => {
    expect(migration).toMatch(/p_actual_cost IS NULL/);
    expect(migration).toMatch(/'NaN', 'Infinity', '-Infinity'/);
  });
});
