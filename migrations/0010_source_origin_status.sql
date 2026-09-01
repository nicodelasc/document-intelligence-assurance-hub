BEGIN;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS source_origin_status TEXT;

ALTER TABLE runs
  ALTER COLUMN source_origin_status SET DEFAULT 'unverified';

UPDATE runs
SET source_origin_status = CASE
  WHEN source_type = 'synthetic' THEN 'server_original'
  ELSE 'unverified'
END
WHERE source_origin_status IS NULL;

ALTER TABLE runs
  ALTER COLUMN source_origin_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'runs_source_origin_status_check'
      AND conrelid = 'runs'::regclass
  ) THEN
    ALTER TABLE runs
      ADD CONSTRAINT runs_source_origin_status_check
      CHECK (source_origin_status IN ('server_original', 'recognized_copy', 'unverified'));
  END IF;
END
$$;

INSERT INTO schema_migrations (version)
  VALUES ('0010_source_origin_status')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
