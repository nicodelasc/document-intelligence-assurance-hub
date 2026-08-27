BEGIN;

ALTER TABLE model_budget_reservations
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE model_budget_reservations
  SET expires_at = created_at + interval '15 minutes'
  WHERE expires_at IS NULL;

ALTER TABLE model_budget_reservations
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS model_budget_reservations_pending_lease_idx
  ON model_budget_reservations (usage_day, expires_at)
  WHERE status = 'pending';

DROP FUNCTION IF EXISTS reserve_daily_quota(
  date, text, boolean, boolean, boolean, boolean, integer, integer, integer,
  integer, integer, numeric, text, numeric
);
DROP FUNCTION IF EXISTS reserve_daily_quota(
  date, timestamptz, text, boolean, boolean, boolean, boolean, integer, integer,
  integer, integer, integer, numeric, text, numeric, integer
);

CREATE OR REPLACE FUNCTION reserve_daily_quota(
  p_day date,
  p_now timestamptz,
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
  p_reservation_cost numeric,
  p_lease_seconds integer
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

  UPDATE model_budget_reservations
    SET status = 'released', settled_at = p_now
    WHERE usage_day = p_day
      AND status = 'pending'
      AND expires_at <= p_now;

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

  IF p_live AND (
    p_reservation_cost <= 0 OR
    p_reservation_cost > p_budget OR
    p_lease_seconds <= 0
  ) THEN
    RETURN jsonb_build_object('decision', 'daily_budget');
  END IF;

  SELECT COALESCE(SUM(reserved_cost_usd), 0)
    INTO pending_cost
    FROM model_budget_reservations
    WHERE usage_day = p_day
      AND status = 'pending'
      AND expires_at > p_now;
  available_cost := GREATEST(0, p_budget - usage_record.global_spend_usd - pending_cost);
  IF p_live AND available_cost < p_reservation_cost THEN
    RETURN jsonb_build_object('decision', 'daily_budget');
  END IF;

  IF p_live THEN
    INSERT INTO model_budget_reservations (
      id,
      usage_day,
      reserved_cost_usd,
      status,
      created_at,
      expires_at
    ) VALUES (
      p_reservation_id,
      p_day,
      p_reservation_cost,
      'pending',
      p_now,
      p_now + make_interval(secs => p_lease_seconds)
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

INSERT INTO schema_migrations (version)
  VALUES ('0002_provider_lifecycle')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
