BEGIN;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS document_family text,
  ADD COLUMN IF NOT EXISTS fixture_id text;

CREATE TABLE IF NOT EXISTS workflow_events (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'approve_and_stage', 'mark_for_later_review', 'assign_review',
    'request_clarification', 'request_clearer_document', 'prepare_email',
    'replace_document', 'retry_processing', 'download_summary'
  )),
  recipient_role text,
  status text NOT NULL CHECK (status IN ('prepared', 'staged', 'simulated')),
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_events_idempotency_idx
  ON workflow_events (run_id, action, COALESCE(recipient_role, ''));
CREATE INDEX IF NOT EXISTS workflow_events_run_created_idx
  ON workflow_events (run_id, created_at, id);

INSERT INTO schema_migrations (version)
  VALUES ('0008_document_workflow')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
