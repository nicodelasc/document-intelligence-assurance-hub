BEGIN;

ALTER TABLE model_budget_reservations
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

CREATE INDEX IF NOT EXISTS model_budget_reservations_stale_dispatch_idx
  ON model_budget_reservations (usage_day, status, expires_at, dispatched_at);

CREATE OR REPLACE FUNCTION mark_daily_quota_dispatched(
  p_reservation_id text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  reservation_record model_budget_reservations%ROWTYPE;
BEGIN
  SELECT * INTO reservation_record
    FROM model_budget_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF reservation_record.status <> 'pending' THEN
    RETURN jsonb_build_object('status', reservation_record.status);
  END IF;

  UPDATE model_budget_reservations
    SET dispatched_at = COALESCE(dispatched_at, now())
    WHERE id = p_reservation_id
      AND status = 'pending';
  RETURN jsonb_build_object('status', 'dispatched');
END;
$$;

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
      UPDATE model_budget_reservations
        SET status = 'released',
          actual_cost_usd = 0,
          settled_at = p_now
        WHERE usage_day = stale_day
          AND status = 'pending'
          AND dispatched_at IS NULL
          AND expires_at <= p_now;

      WITH reconciled AS (
        UPDATE model_budget_reservations
          SET status = 'settled',
            actual_cost_usd = reserved_cost_usd,
            settled_at = p_now
          WHERE usage_day = stale_day
            AND status = 'pending'
            AND dispatched_at IS NOT NULL
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

INSERT INTO schema_migrations (version)
  VALUES ('0005_provider_dispatch_budget')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
