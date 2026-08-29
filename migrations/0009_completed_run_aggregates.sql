BEGIN;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE runs
SET completed_at = COALESCE(
  (
    SELECT CASE
      WHEN run_results.result_json ->> 'completedAt' ~ '^\d{4}-\d{2}-\d{2}T'
        AND pg_input_is_valid(
          run_results.result_json ->> 'completedAt',
          'timestamp with time zone'
        )
      THEN (run_results.result_json ->> 'completedAt')::timestamptz
      ELSE NULL
    END
    FROM run_results
    WHERE run_results.run_id = runs.id
  ),
  created_at
)
WHERE was_completed = true
  AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS runs_confirmed_model_cost_idx
  ON runs (completed_at, provider, model)
  WHERE was_completed = true AND provider_dispatched = true;

INSERT INTO schema_migrations (version)
  VALUES ('0009_completed_run_aggregates')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
