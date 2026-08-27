export const neonSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS runs (
    id text PRIMARY KEY,
    provider text NOT NULL,
    model text NOT NULL,
    prompt_version text NOT NULL,
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
  )`,
  `ALTER TABLE runs ADD COLUMN IF NOT EXISTS prompt_version text NOT NULL DEFAULT 'legacy'`,
  `CREATE INDEX IF NOT EXISTS runs_expiry_idx ON runs (expires_at) WHERE details_deleted = false`,
  `CREATE TABLE IF NOT EXISTS run_steps (
    sequence bigserial PRIMARY KEY,
    run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_json jsonb NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS run_steps_run_idx ON run_steps (run_id, sequence)`,
  `CREATE TABLE IF NOT EXISTS run_results (
    run_id text PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    result_json jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS daily_usage (
    usage_day date PRIMARY KEY,
    provider_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
    anonymous_buckets jsonb NOT NULL DEFAULT '{}'::jsonb,
    global_spend_usd numeric NOT NULL DEFAULT 0
  )`,
  `CREATE OR REPLACE FUNCTION reserve_daily_quota(
    p_day date,
    p_bucket text,
    p_custom boolean,
    p_live boolean,
    p_cost numeric,
    p_live_enabled boolean,
    p_custom_limit integer,
    p_live_limit integer,
    p_budget numeric
  ) RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    usage_record daily_usage%ROWTYPE;
    bucket_usage jsonb;
    custom_count integer;
    live_count integer;
  BEGIN
    IF p_live AND NOT p_live_enabled THEN
      RETURN 'live_disabled';
    END IF;
    IF NOT p_custom AND NOT p_live THEN
      RETURN 'allowed';
    END IF;
    INSERT INTO daily_usage (usage_day) VALUES (p_day) ON CONFLICT (usage_day) DO NOTHING;
    SELECT * INTO usage_record FROM daily_usage WHERE usage_day = p_day FOR UPDATE;
    bucket_usage := COALESCE(
      usage_record.anonymous_buckets -> p_bucket,
      '{"customUploads":0,"liveRuns":0}'::jsonb
    );
    custom_count := COALESCE((bucket_usage ->> 'customUploads')::integer, 0);
    live_count := COALESCE((bucket_usage ->> 'liveRuns')::integer, 0);
    IF p_custom AND custom_count >= p_custom_limit THEN
      RETURN 'custom_upload_limit';
    END IF;
    IF p_live AND live_count >= p_live_limit THEN
      RETURN 'live_run_limit';
    END IF;
    IF p_live AND usage_record.global_spend_usd + p_cost > p_budget THEN
      RETURN 'daily_budget';
    END IF;
    UPDATE daily_usage SET
      anonymous_buckets = jsonb_set(
        anonymous_buckets,
        ARRAY[p_bucket],
        jsonb_build_object(
          'customUploads', custom_count + CASE WHEN p_custom THEN 1 ELSE 0 END,
          'liveRuns', live_count + CASE WHEN p_live THEN 1 ELSE 0 END
        ),
        true
      ),
      global_spend_usd = global_spend_usd + CASE WHEN p_live THEN p_cost ELSE 0 END
    WHERE usage_day = p_day;
    RETURN 'allowed';
  END;
  $$`,
] as const;
