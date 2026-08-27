BEGIN;

CREATE TABLE IF NOT EXISTS public_rate_limit_windows (
  resource text NOT NULL,
  window_start timestamptz NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global', 'bucket')),
  bucket_key text NOT NULL DEFAULT '',
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (resource, window_start, scope, bucket_key)
);

CREATE INDEX IF NOT EXISTS public_rate_limit_windows_cleanup_idx
  ON public_rate_limit_windows (window_start);

DROP FUNCTION IF EXISTS consume_public_resource_limit(
  text, timestamptz, text, integer, integer
);

CREATE OR REPLACE FUNCTION consume_public_resource_limit(
  p_resource text,
  p_window_start timestamptz,
  p_bucket text,
  p_bucket_limit integer,
  p_global_limit integer
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  global_count integer;
  bucket_count integer;
BEGIN
  IF
    p_resource IS NULL OR
    length(p_resource) < 1 OR
    length(p_resource) > 64 OR
    p_bucket IS NULL OR
    length(p_bucket) < 1 OR
    length(p_bucket) > 512 OR
    p_bucket_limit < 1 OR
    p_global_limit < 1 OR
    p_window_start IS NULL
  THEN
    RETURN false;
  END IF;

  DELETE FROM public_rate_limit_windows
    WHERE window_start < p_window_start - interval '5 minutes';

  INSERT INTO public_rate_limit_windows (
    resource,
    window_start,
    scope,
    bucket_key
  ) VALUES (
    p_resource,
    p_window_start,
    'global',
    ''
  ) ON CONFLICT DO NOTHING;

  SELECT request_count INTO global_count
    FROM public_rate_limit_windows
    WHERE
      resource = p_resource AND
      window_start = p_window_start AND
      scope = 'global' AND
      bucket_key = ''
    FOR UPDATE;

  IF global_count >= p_global_limit THEN
    RETURN false;
  END IF;

  INSERT INTO public_rate_limit_windows (
    resource,
    window_start,
    scope,
    bucket_key
  ) VALUES (
    p_resource,
    p_window_start,
    'bucket',
    p_bucket
  ) ON CONFLICT DO NOTHING;

  SELECT request_count INTO bucket_count
    FROM public_rate_limit_windows
    WHERE
      resource = p_resource AND
      window_start = p_window_start AND
      scope = 'bucket' AND
      bucket_key = p_bucket
    FOR UPDATE;

  IF global_count >= p_global_limit OR bucket_count >= p_bucket_limit THEN
    RETURN false;
  END IF;

  UPDATE public_rate_limit_windows
    SET request_count = request_count + 1
    WHERE
      resource = p_resource AND
      window_start = p_window_start AND
      scope = 'global' AND
      bucket_key = '';

  UPDATE public_rate_limit_windows
    SET request_count = request_count + 1
    WHERE
      resource = p_resource AND
      window_start = p_window_start AND
      scope = 'bucket' AND
      bucket_key = p_bucket;

  RETURN true;
END;
$$;

INSERT INTO schema_migrations (version)
  VALUES ('0003_public_resource_controls')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
