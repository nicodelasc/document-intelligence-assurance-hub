import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("provider dispatch budget migration", () => {
  const migrationPath = "migrations/0005_provider_dispatch_budget.sql";
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8")
    : "";

  it("records one idempotent migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/VALUES \('0005_provider_dispatch_budget'\)/);
    expect(migration).toMatch(/ON CONFLICT \(version\) DO NOTHING/);
    expect(migration).toMatch(/COMMIT;\s*$/);
  });

  it("persists dispatch before a reservation can represent provider spend", () => {
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS dispatched_at timestamptz/,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION mark_daily_quota_dispatched/,
    );
    expect(migration).toMatch(
      /SET dispatched_at = COALESCE\(dispatched_at, now\(\)\)[\s\S]*AND status = 'pending'/,
    );
  });

  it("releases expired undispatched leases and charges dispatched leases", () => {
    expect(migration).toMatch(
      /SET status = 'released'[\s\S]*status = 'pending'[\s\S]*dispatched_at IS NULL[\s\S]*expires_at <= p_now/,
    );
    expect(migration).toMatch(
      /SET status = 'settled'[\s\S]*actual_cost_usd = reserved_cost_usd[\s\S]*status = 'pending'[\s\S]*dispatched_at IS NOT NULL[\s\S]*expires_at <= p_now/,
    );
  });
});
