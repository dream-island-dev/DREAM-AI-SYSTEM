-- 296_ezgo_api_ingest_retention.sql
-- EZGO live API sync — Stage 3 of the sync-management plan. Purges
-- ezgo_api_ingest rows once they've reached a terminal, no-further-action
-- state, mirroring purge_stale_ezgo_mail_ingest (migration 271) exactly —
-- same signature shape, same clamp, same "only delete what's truly done"
-- discipline, just simpler because ezgo_api_ingest has no child
-- pending_review lines table to check (status lives directly on the row).
--
-- Only 'parsed' and 'ignored' are purged — both mean "nothing more to do
-- here." 'failed' is deliberately excluded (still needs investigation,
-- shouldn't quietly vanish) and 'staged'/'processing' obviously never
-- qualify. Default retention is shorter than mail's 3 days (7 vs 3 there)
-- was considered but this table's volume (thousands/day) argues the other
-- way — default kept at 3 to match, Mike can raise it via the retention_days
-- argument if the shorter window turns out to be too aggressive in practice.

CREATE OR REPLACE FUNCTION public.purge_stale_ezgo_api_ingest(retention_days int DEFAULT 3)
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

  DELETE FROM public.ezgo_api_ingest
  WHERE status IN ('parsed', 'ignored')
    AND created_at < cutoff;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_stale_ezgo_api_ingest(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_stale_ezgo_api_ingest(int) TO service_role;

COMMENT ON FUNCTION public.purge_stale_ezgo_api_ingest IS
  'Deletes ezgo_api_ingest rows once status is parsed/ignored (terminal, nothing more to do) and older than retention_days. failed rows are never auto-purged — they still need investigation. Mirrors purge_stale_ezgo_mail_ingest (migration 271).';
