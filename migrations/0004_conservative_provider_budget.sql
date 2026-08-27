BEGIN;

CREATE OR REPLACE FUNCTION reconcile_stale_daily_quota(
  p_day date,
  p_now timestamptz
) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  day_reconciled_cost numeric := 0;
  reconciled_cost numeric := 0;
  stale_day date;
BEGIN
  FOR stale_day IN
    SELECT DISTINCT usage_day
      FROM model_budget_reservations
      WHERE usage_day <= p_day
        AND status = 'pending'
        AND expires_at <= p_now
      ORDER BY usage_day
  LOOP
    PERFORM 1
      FROM daily_usage
      WHERE usage_day = stale_day
      FOR UPDATE;
    IF FOUND THEN
      WITH reconciled AS (
        UPDATE model_budget_reservations
          SET status = 'settled',
            actual_cost_usd = reserved_cost_usd,
            settled_at = p_now
          WHERE usage_day = stale_day
            AND status = 'pending'
            AND expires_at <= p_now
          RETURNING reserved_cost_usd
      )
      SELECT COALESCE(SUM(reserved_cost_usd), 0)
        INTO day_reconciled_cost
        FROM reconciled;

      IF day_reconciled_cost > 0 THEN
        UPDATE daily_usage
          SET global_spend_usd = global_spend_usd + day_reconciled_cost
          WHERE usage_day = stale_day;
        reconciled_cost := reconciled_cost + day_reconciled_cost;
      END IF;
    END IF;
  END LOOP;
  RETURN reconciled_cost;
END;
$$;

CREATE OR REPLACE FUNCTION settle_daily_quota(
  p_reservation_id text,
  p_actual_cost numeric,
  p_release boolean
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  reservation_day date;
  reservation_record model_budget_reservations%ROWTYPE;
  settled_cost numeric;
BEGIN
  SELECT usage_day INTO reservation_day
    FROM model_budget_reservations
    WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'actualCostUsd', 0);
  END IF;

  PERFORM 1 FROM daily_usage
    WHERE usage_day = reservation_day
    FOR UPDATE;
  SELECT * INTO reservation_record
    FROM model_budget_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'actualCostUsd', 0);
  END IF;

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
  IF p_actual_cost IS NULL OR
    p_actual_cost::text IN ('NaN', 'Infinity', '-Infinity') OR
    p_actual_cost < 0 THEN
    RAISE EXCEPTION 'invalid_actual_cost';
  END IF;

  settled_cost := p_actual_cost;
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

CREATE OR REPLACE FUNCTION settle_reserved_daily_quota(
  p_reservation_id text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  reservation_day date;
  reservation_record model_budget_reservations%ROWTYPE;
BEGIN
  SELECT usage_day INTO reservation_day
    FROM model_budget_reservations
    WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'actualCostUsd', 0);
  END IF;

  PERFORM 1 FROM daily_usage
    WHERE usage_day = reservation_day
    FOR UPDATE;
  SELECT * INTO reservation_record
    FROM model_budget_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'actualCostUsd', 0);
  END IF;

  IF reservation_record.status = 'released' THEN
    RETURN jsonb_build_object('status', 'released', 'actualCostUsd', 0);
  END IF;
  IF reservation_record.status = 'settled' THEN
    RETURN jsonb_build_object(
      'status', 'already_settled',
      'actualCostUsd', reservation_record.actual_cost_usd
    );
  END IF;

  UPDATE model_budget_reservations
    SET status = 'settled',
      actual_cost_usd = reservation_record.reserved_cost_usd,
      settled_at = now()
    WHERE id = p_reservation_id;
  UPDATE daily_usage
    SET global_spend_usd = global_spend_usd + reservation_record.reserved_cost_usd
    WHERE usage_day = reservation_record.usage_day;

  RETURN jsonb_build_object(
    'status', 'settled',
    'actualCostUsd', reservation_record.reserved_cost_usd
  );
END;
$$;

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

  INSERT INTO daily_usage (usage_day)
    VALUES (p_day)
    ON CONFLICT (usage_day) DO NOTHING;
  PERFORM reconcile_stale_daily_quota(p_day, p_now);
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
      AND status = 'pending';
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
  VALUES ('0004_conservative_provider_budget')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
