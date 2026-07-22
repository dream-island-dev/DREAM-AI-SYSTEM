-- Purge completed EZGO mail ingests after N days (default 3) — frees body_html snapshots.
-- Never deletes ingests that still have pending_review lines.

CREATE OR REPLACE FUNCTION public.purge_stale_ezgo_mail_ingest(retention_days int DEFAULT 3)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count int;
  cutoff timestamptz;
  days int;
BEGIN
  days := GREATEST(COALESCE(retention_days, 3), 1);
  days := LEAST(days, 30);
  cutoff := NOW() - (days || ' days')::interval;

  DELETE FROM public.ezgo_mail_ingest e
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.ezgo_mail_import_lines l
    WHERE l.ingest_id = e.id
      AND l.status = 'pending_review'
  )
  AND (
    -- Failed/skipped/unknown with no actionable lines
    (
      e.line_count = 0
      AND e.parse_status IN ('skipped', 'failed')
      AND e.received_at < cutoff
    )
    OR
    -- Parsed reports — all lines terminal; retention from last line activity
    (
      e.line_count > 0
      AND e.parse_status = 'parsed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.ezgo_mail_import_lines l2
        WHERE l2.ingest_id = e.id
          AND l2.status NOT IN ('applied', 'rejected', 'skipped')
      )
      AND COALESCE(
        (SELECT MAX(l3.updated_at) FROM public.ezgo_mail_import_lines l3 WHERE l3.ingest_id = e.id),
        e.updated_at,
        e.received_at
      ) < cutoff
    )
  );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_stale_ezgo_mail_ingest(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_stale_ezgo_mail_ingest(int) TO service_role;

COMMENT ON FUNCTION public.purge_stale_ezgo_mail_ingest IS
  'Deletes ezgo_mail_ingest rows (CASCADE lines) when fully handled and older than retention_days. Skips pending_review.';
