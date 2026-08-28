BEGIN;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS provider_dispatched boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version)
  VALUES ('0007_provider_dispatch_attribution')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
