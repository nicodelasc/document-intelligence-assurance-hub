BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL DEFAULT 'legacy',
  execution_mode text NOT NULL,
  source_type text NOT NULL,
  file_metadata jsonb NOT NULL,
  document_key text,
  requested_fields jsonb NOT NULL,
  status text NOT NULL,
  outcome text,
  usage jsonb NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0}'::jsonb,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  consent boolean NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  deletion_token_hash text,
  retry_count integer NOT NULL DEFAULT 0,
  latency_ms numeric,
  step_durations jsonb NOT NULL DEFAULT '{}'::jsonb,
  details_deleted boolean NOT NULL DEFAULT false,
  was_completed boolean NOT NULL DEFAULT false,
  was_failed boolean NOT NULL DEFAULT false
);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS prompt_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS details_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS was_completed boolean NOT NULL DEFAULT false;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS was_failed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS runs_expiry_idx
  ON runs (expires_at)
  WHERE details_deleted = false;

CREATE TABLE IF NOT EXISTS run_steps (
  sequence bigserial PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_json jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS run_steps_run_idx ON run_steps (run_id, sequence);

CREATE TABLE IF NOT EXISTS run_results (
  run_id text PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  result_json jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS document_cleanup_jobs (
  run_id text PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  document_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_cleanup_jobs_retry_idx
  ON document_cleanup_jobs (next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS run_submission_claims (
  run_id text PRIMARY KEY,
  claimed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS run_submission_claims_expiry_idx
  ON run_submission_claims (expires_at);

CREATE TABLE IF NOT EXISTS daily_usage (
  usage_day date PRIMARY KEY,
  provider_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  anonymous_buckets jsonb NOT NULL DEFAULT '{}'::jsonb,
  global_custom_uploads integer NOT NULL DEFAULT 0,
  global_recorded_runs integer NOT NULL DEFAULT 0,
  global_spend_usd numeric NOT NULL DEFAULT 0
);

ALTER TABLE daily_usage
  ADD COLUMN IF NOT EXISTS global_custom_uploads integer NOT NULL DEFAULT 0;
ALTER TABLE daily_usage
  ADD COLUMN IF NOT EXISTS global_recorded_runs integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS model_budget_reservations (
  id text PRIMARY KEY,
  usage_day date NOT NULL REFERENCES daily_usage(usage_day),
  reserved_cost_usd numeric NOT NULL,
  actual_cost_usd numeric NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('pending', 'settled', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS model_budget_reservations_day_status_idx
  ON model_budget_reservations (usage_day, status);

DROP FUNCTION IF EXISTS reserve_daily_quota(
  date, text, boolean, boolean, numeric, boolean, integer, integer, numeric
);
DROP FUNCTION IF EXISTS reserve_daily_quota(
  date, text, boolean, boolean, boolean, integer, integer, numeric, text, numeric
);
DROP FUNCTION IF EXISTS reserve_daily_quota(
  date, text, boolean, boolean, boolean, boolean, integer, integer, integer,
  integer, integer, numeric, text, numeric
);

CREATE OR REPLACE FUNCTION reserve_daily_quota(
  p_day date,
  p_bucket text,
  p_custom boolean,
  p_live boolean,
  p_recorded boolean,
  p_live_enabled boolean,
  p_custom_limit integer,
  p_live_limit integer,
  p_recorded_limit integer,
  p_global_custom_limit integer,
  p_global_recorded_limit integer,
  p_budget numeric,
  p_reservation_id text,
  p_reservation_cost numeric
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  usage_record daily_usage%ROWTYPE;
  bucket_usage jsonb;
  custom_count integer;
  live_count integer;
  recorded_count integer;
  pending_cost numeric;
  available_cost numeric;
BEGIN
  IF p_live AND NOT p_live_enabled THEN
    RETURN jsonb_build_object('decision', 'live_disabled');
  END IF;

  IF NOT p_custom AND NOT p_live AND NOT p_recorded THEN
    RETURN jsonb_build_object(
      'decision', 'allowed',
      'reservationId', NULL,
      'reservedCostUsd', 0
    );
  END IF;

  INSERT INTO daily_usage (usage_day)
    VALUES (p_day)
    ON CONFLICT (usage_day) DO NOTHING;
  SELECT * INTO usage_record
    FROM daily_usage
    WHERE usage_day = p_day
    FOR UPDATE;

  bucket_usage := COALESCE(
    usage_record.anonymous_buckets -> p_bucket,
    '{"customUploads":0,"liveRuns":0,"recordedRuns":0}'::jsonb
  );
  custom_count := COALESCE((bucket_usage ->> 'customUploads')::integer, 0);
  live_count := COALESCE((bucket_usage ->> 'liveRuns')::integer, 0);
  recorded_count := COALESCE((bucket_usage ->> 'recordedRuns')::integer, 0);

  IF p_custom AND custom_count >= p_custom_limit THEN
    RETURN jsonb_build_object('decision', 'custom_upload_limit');
  END IF;
  IF p_live AND live_count >= p_live_limit THEN
    RETURN jsonb_build_object('decision', 'live_run_limit');
  END IF;
  IF p_custom AND usage_record.global_custom_uploads >= p_global_custom_limit THEN
    RETURN jsonb_build_object('decision', 'global_custom_upload_limit');
  END IF;
  IF p_recorded AND recorded_count >= p_recorded_limit THEN
    RETURN jsonb_build_object('decision', 'recorded_run_limit');
  END IF;
  IF p_recorded AND usage_record.global_recorded_runs >= p_global_recorded_limit THEN
    RETURN jsonb_build_object('decision', 'global_recorded_run_limit');
  END IF;

  SELECT COALESCE(SUM(reserved_cost_usd), 0)
    INTO pending_cost
    FROM model_budget_reservations
    WHERE usage_day = p_day AND status = 'pending';
  available_cost := GREATEST(0, p_budget - usage_record.global_spend_usd - pending_cost);
  IF p_live AND available_cost < p_reservation_cost THEN
    RETURN jsonb_build_object('decision', 'daily_budget');
  END IF;

  IF p_live THEN
    INSERT INTO model_budget_reservations (
      id,
      usage_day,
      reserved_cost_usd,
      status
    ) VALUES (
      p_reservation_id,
      p_day,
      p_reservation_cost,
      'pending'
    );
  END IF;

  UPDATE daily_usage SET
    global_custom_uploads = global_custom_uploads + CASE WHEN p_custom THEN 1 ELSE 0 END,
    global_recorded_runs = global_recorded_runs + CASE WHEN p_recorded THEN 1 ELSE 0 END,
    anonymous_buckets = jsonb_set(
      anonymous_buckets,
      ARRAY[p_bucket],
      jsonb_build_object(
        'customUploads', custom_count + CASE WHEN p_custom THEN 1 ELSE 0 END,
        'liveRuns', live_count + CASE WHEN p_live THEN 1 ELSE 0 END,
        'recordedRuns', recorded_count + CASE WHEN p_recorded THEN 1 ELSE 0 END
      ),
      true
    )
  WHERE usage_day = p_day;

  RETURN jsonb_build_object(
    'decision', 'allowed',
    'reservationId', CASE WHEN p_live THEN p_reservation_id ELSE NULL END,
    'reservedCostUsd', CASE WHEN p_live THEN p_reservation_cost ELSE 0 END
  );
END;
$$;

CREATE OR REPLACE FUNCTION settle_daily_quota(
  p_reservation_id text,
  p_actual_cost numeric,
  p_release boolean
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  reservation_record model_budget_reservations%ROWTYPE;
  usage_record daily_usage%ROWTYPE;
  settled_cost numeric;
BEGIN
  SELECT * INTO reservation_record
    FROM model_budget_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'actualCostUsd', 0);
  END IF;

  SELECT * INTO usage_record
    FROM daily_usage
    WHERE usage_day = reservation_record.usage_day
    FOR UPDATE;

  IF reservation_record.status = 'released' THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN p_release THEN 'already_released' ELSE 'released' END,
      'actualCostUsd', 0
    );
  END IF;
  IF reservation_record.status = 'settled' THEN
    RETURN jsonb_build_object(
      'status', 'already_settled',
      'actualCostUsd', reservation_record.actual_cost_usd
    );
  END IF;

  IF p_release THEN
    UPDATE model_budget_reservations
      SET status = 'released', settled_at = now()
      WHERE id = p_reservation_id;
    RETURN jsonb_build_object('status', 'released', 'actualCostUsd', 0);
  END IF;

  settled_cost := GREATEST(0, p_actual_cost);
  UPDATE model_budget_reservations
    SET status = 'settled', actual_cost_usd = settled_cost, settled_at = now()
    WHERE id = p_reservation_id;
  UPDATE daily_usage
    SET global_spend_usd = global_spend_usd + settled_cost
    WHERE usage_day = reservation_record.usage_day;

  RETURN jsonb_build_object(
    'status', CASE
      WHEN settled_cost > reservation_record.reserved_cost_usd
        THEN 'reservation_exceeded'
      ELSE 'settled'
    END,
    'actualCostUsd', settled_cost
  );
END;
$$;

INSERT INTO schema_migrations (version)
  VALUES ('0001_assurance_hub')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
