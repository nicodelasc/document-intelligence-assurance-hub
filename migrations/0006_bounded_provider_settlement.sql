BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations
      WHERE version = '0006_bounded_provider_settlement'
  ) THEN
    -- Pre-0005 rows have no dispatch evidence. Preserve the earlier
    -- conservative reconciliation policy instead of creating free capacity.
    UPDATE model_budget_reservations
      SET dispatched_at = COALESCE(dispatched_at, created_at)
      WHERE status = 'pending'
        AND dispatched_at IS NULL;
  END IF;
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
  settlement_status text := 'settled';
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

  IF p_actual_cost > reservation_record.reserved_cost_usd THEN
    settled_cost := reservation_record.reserved_cost_usd;
    settlement_status := 'reservation_exceeded';
  ELSE
    settled_cost := p_actual_cost;
  END IF;
  UPDATE model_budget_reservations
    SET status = 'settled', actual_cost_usd = settled_cost, settled_at = now()
    WHERE id = p_reservation_id;
  UPDATE daily_usage
    SET global_spend_usd = global_spend_usd + settled_cost
    WHERE usage_day = reservation_record.usage_day;

  RETURN jsonb_build_object(
    'status', settlement_status,
    'actualCostUsd', settled_cost
  );
END;
$$;

INSERT INTO schema_migrations (version)
  VALUES ('0006_bounded_provider_settlement')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
