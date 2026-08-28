import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bounded provider settlement migration", () => {
  const migrationPath = "migrations/0006_bounded_provider_settlement.sql";
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8")
    : "";

  it("records one idempotent migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/VALUES \('0006_bounded_provider_settlement'\)/);
    expect(migration).toMatch(/ON CONFLICT \(version\) DO NOTHING/);
    expect(migration).toMatch(/COMMIT;\s*$/);
  });

  it("conservatively marks only reservations present before first application", () => {
    expect(migration).toMatch(
      /IF NOT EXISTS[\s\S]*0006_bounded_provider_settlement[\s\S]*SET dispatched_at = COALESCE\(dispatched_at, created_at\)[\s\S]*status = 'pending'/,
    );
  });

  it("caps malformed actual cost at the stored reservation", () => {
    expect(migration).toMatch(
      /p_actual_cost > reservation_record\.reserved_cost_usd[\s\S]*settled_cost := reservation_record\.reserved_cost_usd[\s\S]*settlement_status := 'reservation_exceeded'/,
    );
    expect(migration).toMatch(
      /global_spend_usd = global_spend_usd \+ settled_cost/,
    );
  });
});
