import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("document workflow migration", () => {
  const migrationPath = "migrations/0008_document_workflow.sql";
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8")
    : "";
  const permittedActions = [
    "approve_and_stage",
    "mark_for_later_review",
    "assign_review",
    "request_clarification",
    "request_clearer_document",
    "prepare_email",
    "replace_document",
    "retry_processing",
    "download_summary",
  ];
  const permittedStatuses = ["prepared", "staged", "simulated"];

  it("reserves nullable fixture identity and idempotent workflow events", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(
      /ALTER TABLE runs\s+ADD COLUMN IF NOT EXISTS document_family text,\s+ADD COLUMN IF NOT EXISTS fixture_id text;/,
    );
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS workflow_events \(\s+id text PRIMARY KEY,\s+run_id text NOT NULL REFERENCES runs\(id\) ON DELETE CASCADE,\s+action text NOT NULL CHECK \(action IN \([\s\S]+?\)\),\s+recipient_role text,\s+status text NOT NULL CHECK \(status IN \('prepared', 'staged', 'simulated'\)\),\s+created_at timestamptz NOT NULL\s+\);/,
    );
    const actionValues = Array.from(
      migration.match(/action text NOT NULL CHECK \(action IN \(([\s\S]*?)\)\)/)?.[1]
        ?.matchAll(/'([^']+)'/g) ?? [],
      (match) => match[1],
    );
    const statusValues = Array.from(
      migration.match(/status text NOT NULL CHECK \(status IN \(([\s\S]*?)\)\)/)?.[1]
        ?.matchAll(/'([^']+)'/g) ?? [],
      (match) => match[1],
    );
    expect(actionValues).toEqual(permittedActions);
    expect(statusValues).toEqual(permittedStatuses);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS workflow_events_idempotency_idx\s+ON workflow_events \(run_id, action, COALESCE\(recipient_role, ''\)\);/,
    );
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS workflow_events_run_created_idx\s+ON workflow_events \(run_id, created_at, id\);/,
    );
    expect(migration).toMatch(/VALUES \('0008_document_workflow'\)/);
    expect(migration).toMatch(/ON CONFLICT \(version\) DO NOTHING/);
    expect(migration).toMatch(/COMMIT;\s*$/);
  });
});
